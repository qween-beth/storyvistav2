'use strict';

const axios = require('axios');
const { query } = require('../storage/db');
const { saveEmbedding } = require('../storage/knowledge');
const logger = require('../utils/logger');

// ── Voyage AI config ──────────────────────────────────────────────
// voyage-3       → 1024 dims, best quality,     free tier: 100M tokens/month
// voyage-3-lite  → 512 dims,  fastest/lightest, free tier: 100M tokens/month
//
// We use voyage-3 for knowledge blocks (quality matters for retrieval accuracy)
// and voyage-3-lite for query embedding (speed matters at search time)

const VOYAGE_API = 'https://api.voyageai.com/v1/embeddings';
const BLOCK_MODEL = process.env.VOYAGE_BLOCK_MODEL || 'voyage-3';        // 1024 dims
const QUERY_MODEL = process.env.VOYAGE_QUERY_MODEL || 'voyage-3-lite';   // 512 dims — fast queries

// Voyage AI supports input_type hints for better retrieval quality:
// 'document' → used when embedding content to store
// 'query'    → used when embedding a search query
const INPUT_TYPE_DOCUMENT = 'document';
const INPUT_TYPE_QUERY    = 'query';

// ── Core Voyage API call ──────────────────────────────────────────
async function voyageEmbed(texts, model, inputType) {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is not set. Get a free key at voyageai.com');
  }

  // Voyage accepts up to 128 texts per batch — we batch for efficiency
  const input = Array.isArray(texts) ? texts : [texts];

  const response = await axios.post(
    VOYAGE_API,
    {
      model,
      input,
      input_type: inputType,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const embeddings = response.data?.data?.map((d) => d.embedding);
  if (!embeddings?.length) throw new Error('Voyage AI returned no embeddings');

  // Return single embedding if single input, array if batch
  return Array.isArray(texts) ? embeddings : embeddings[0];
}

// ── Batch embed with rate limit awareness ─────────────────────────
// Voyage free tier: 300 RPM — we batch up to 32 texts per request
async function batchEmbed(texts, model, inputType, batchSize = 32) {
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await voyageEmbed(batch, model, inputType);
    results.push(...embeddings);
    // Respect rate limit with a small delay between batches
    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return results;
}

// ── Build embedding text for a knowledge block ────────────────────
// Separate text per age band for precise age-targeted retrieval
function buildEmbedText(block, ageBand = null) {
  const parts = [block.topic, block.summary];

  if (ageBand) {
    const key = `explanation_${ageBand.replace('-', '_')}`;
    if (block[key]) parts.push(block[key]);
  }

  if (block.key_concepts?.length) parts.push(block.key_concepts.join(', '));
  if (block.subjects?.length) parts.push(block.subjects.join(', '));

  const facts = typeof block.facts === 'string' ? JSON.parse(block.facts) : block.facts || [];
  facts.slice(0, 5).forEach((f) => parts.push(f.statement));

  return parts.filter(Boolean).join('. ');
}

// ── Embed a single knowledge block (all age bands) ────────────────
async function embedBlock(blockId) {
  const result = await query('SELECT * FROM knowledge_blocks WHERE id = $1', [blockId]);
  const block = result.rows[0];
  if (!block) throw new Error(`Block not found: ${blockId}`);

  // Skip if already embedded
  const existing = await query(
    'SELECT COUNT(*) FROM knowledge_embeddings WHERE block_id = $1',
    [blockId]
  );
  if (parseInt(existing.rows[0].count, 10) > 0) {
    logger.debug(`[Embeddings] Block ${blockId} already embedded — skipping`);
    return parseInt(existing.rows[0].count, 10);
  }

  const ageBands = ['3-5', '6-8', '9-12'];

  // Build all 4 texts (general + 3 age bands) and batch them in one API call
  const texts = [
    buildEmbedText(block),           // general — no age band
    buildEmbedText(block, '3-5'),
    buildEmbedText(block, '6-8'),
    buildEmbedText(block, '9-12'),
  ];

  logger.debug(`[Embeddings] Batching 4 embeddings for block ${blockId} via Voyage AI`);
  const embeddings = await batchEmbed(texts, BLOCK_MODEL, INPUT_TYPE_DOCUMENT);

  // Save: general first, then age-band specific
  await saveEmbedding(blockId, embeddings[0], null, BLOCK_MODEL);
  for (let i = 0; i < ageBands.length; i++) {
    await saveEmbedding(blockId, embeddings[i + 1], ageBands[i], BLOCK_MODEL);
  }

  logger.info(`[Embeddings] ✓ Block ${blockId} embedded (4 vectors, model: ${BLOCK_MODEL})`);
  return 4;
}

// ── Embed all un-embedded blocks ──────────────────────────────────
async function embedPendingBlocks(limit = 50) {
  const result = await query(`
    SELECT kb.id FROM knowledge_blocks kb
    LEFT JOIN knowledge_embeddings ke ON ke.block_id = kb.id
    WHERE ke.id IS NULL AND kb.is_child_safe = TRUE
    LIMIT $1
  `, [limit]);

  const blockIds = result.rows.map((r) => r.id);
  logger.info(`[Embeddings] ${blockIds.length} blocks pending embedding`);

  let success = 0;
  let failed = 0;

  for (const id of blockIds) {
    try {
      await embedBlock(id);
      success++;
    } catch (err) {
      logger.error(`[Embeddings] Failed to embed ${id}: ${err.message}`);
      failed++;
    }
  }

  const summary = { success, failed, total: blockIds.length, model: BLOCK_MODEL };
  logger.info('[Embeddings] Batch complete', summary);
  return summary;
}

// ── Embed a query string (uses voyage-3-lite for speed) ───────────
async function embedQuery(text) {
  logger.debug(`[Embeddings] Embedding query: "${text.slice(0, 60)}..."`);
  return voyageEmbed(text, QUERY_MODEL, INPUT_TYPE_QUERY);
}

module.exports = { embedBlock, embedPendingBlocks, embedQuery, buildEmbedText };
