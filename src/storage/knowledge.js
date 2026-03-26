'use strict';

const { query, transaction } = require('./db');
const logger = require('../utils/logger');

// ── Save a structured knowledge block ─────────────────────────────
async function saveBlock(block) {
  const meta = block._meta || {};

  const sql = `
    INSERT INTO knowledge_blocks (
      user_id, topic, summary, subjects,
      explanation_3_5, explanation_6_8, explanation_9_12,
      facts, key_concepts, story_elements, lesson_elements,
      quality_score, schema_valid, claude_reviewed, is_child_safe,
      source_id, source_name, source_url, page_url, page_title,
      crawled_at, structured_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14, $15,
      $16, $17, $18, $19, $20,
      $21, $22
    )
    RETURNING id
  `;

  const params = [
    block.userId || null,
    block.topic,
    block.summary,
    block.subjects || [],

    block.ageBands?.['3-5'] || null,
    block.ageBands?.['6-8'] || null,
    block.ageBands?.['9-12'] || null,

    JSON.stringify(block.facts || []),
    block.keyConcepts || [],
    JSON.stringify(block.storyElements || {}),
    JSON.stringify(block.lessonElements || {}),

    block.qualityScore || 0,
    meta.schemaValid || false,
    meta.claudeReviewed || false,
    block.isChildAppropriate !== false,

    meta.sourceId || 'system',
    meta.sourceName || 'Corpus',
    meta.sourceUrl || '',
    meta.pageUrl || '',
    meta.pageTitle || null,

    meta.crawledAt ? new Date(meta.crawledAt) : null,
    meta.structuredAt ? new Date(meta.structuredAt) : new Date(),
  ];

  const result = await query(sql, params);
  const id = result.rows[0].id;
  logger.info(`[Storage] Saved knowledge block: ${id} — "${block.topic}"`);
  return id;
}

// ── Save embedding for a block ────────────────────────────────────
async function saveEmbedding(blockId, embedding, ageBand = null, model = 'text-embedding-3-small') {
  const sql = `
    INSERT INTO knowledge_embeddings (block_id, embedding, age_band, embed_model)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `;

  // pgvector expects array format
  const vectorStr = `[${embedding.join(',')}]`;

  const result = await query(sql, [blockId, vectorStr, ageBand, model]);
  return result.rows[0].id;
}

// ── Vector similarity search ──────────────────────────────────────
/**
 * Find the most similar knowledge blocks to a query embedding
 *
 * @param {number[]} queryEmbedding
 * @param {Object}   opts
 * @param {number}   opts.limit       - number of results (default 5)
 * @param {string}   opts.ageBand     - filter by age band
 * @param {string[]} opts.subjects    - filter by subjects
 * @param {number}   opts.minQuality  - minimum quality score
 * @returns {Promise<Array>}
 */
async function similarBlocks(queryEmbedding, opts = {}) {
  const { limit = 5, ageBand = null, subjects = [], minQuality = 0.4 } = opts;

  const vectorStr = `[${queryEmbedding.join(',')}]`;

  let sql = `
    SELECT
      kb.id,
      kb.topic,
      kb.summary,
      kb.subjects,
      kb.explanation_3_5,
      kb.explanation_6_8,
      kb.explanation_9_12,
      kb.facts,
      kb.key_concepts,
      kb.story_elements,
      kb.lesson_elements,
      kb.quality_score,
      kb.source_name,
      kb.source_url,
      kb.page_url,
      kb.page_title,
      ke.embedding <=> $1 AS distance
    FROM knowledge_embeddings ke
    JOIN knowledge_blocks kb ON kb.id = ke.block_id
    WHERE kb.is_child_safe = TRUE
      AND kb.quality_score >= $2
  `;

  const params = [vectorStr, minQuality];
  let paramIdx = 3;

  if (opts.userId) {
    sql += ` AND (kb.user_id IS NULL OR kb.user_id = $${paramIdx})`;
    params.push(opts.userId);
    paramIdx++;
  } else {
    sql += ` AND kb.user_id IS NULL`;
  }

  if (ageBand) {
    sql += ` AND (ke.age_band IS NULL OR ke.age_band = $${paramIdx})`;
    params.push(ageBand);
    paramIdx++;
  }

  if (subjects.length > 0) {
    sql += ` AND kb.subjects && $${paramIdx}`;
    params.push(subjects);
    paramIdx++;
  }

  sql += ` ORDER BY distance ASC LIMIT $${paramIdx}`;
  params.push(limit);

  const result = await query(sql, params);
  return result.rows;
}

// ── Full-text topic search (fallback when no embedding) ───────────
async function searchByTopic(topicQuery, opts = {}) {
  const { limit = 10, subjects = [], minQuality = 0.3 } = opts;

  let sql = `
    SELECT id, topic, summary, subjects, quality_score,
           source_name, source_url, page_url,
           ts_rank(to_tsvector('english', topic || ' ' || summary), plainto_tsquery('english', $1)) AS rank
    FROM knowledge_blocks
    WHERE is_child_safe = TRUE
      AND quality_score >= $2
      AND to_tsvector('english', topic || ' ' || summary) @@ plainto_tsquery('english', $1)
  `;

  const params = [topicQuery, minQuality];

  if (subjects.length > 0) {
    sql += ` AND subjects && $3`;
    params.push(subjects);
  }

  sql += ` ORDER BY rank DESC LIMIT ${limit}`;

  const result = await query(sql, params);
  return result.rows;
}

// ── Get block by ID ───────────────────────────────────────────────
async function getBlock(id) {
  const result = await query(
    'SELECT * FROM knowledge_blocks WHERE id = $1 AND is_child_safe = TRUE',
    [id]
  );
  return result.rows[0] || null;
}

// ── List blocks with filters ──────────────────────────────────────
async function listBlocks({ page = 1, pageSize = 20, sourceId, minQuality = 0, subjects = [], userId = null } = {}) {
  const offset = (page - 1) * pageSize;
  const where = ['is_child_safe = TRUE'];
  const params = [];

  // $1: minQuality
  params.push(minQuality);
  where.push(`quality_score >= $${params.length}`);

  if (userId) {
    params.push(userId);
    where.push(`(user_id IS NULL OR user_id = $${params.length})`);
  } else {
    where.push(`user_id IS NULL`);
  }

  if (sourceId) {
    params.push(sourceId);
    where.push(`source_id = $${params.length}`);
  }

  if (subjects.length > 0) {
    params.push(subjects);
    where.push(`subjects && $${params.length}`);
  }

  const conditions = where.join(' AND ');
  const filterParams = [...params]; // Params for the COUNT query

  params.push(pageSize);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const sql = `
    SELECT id, topic, summary, subjects, quality_score, source_name,
           source_url, structured_at, claude_reviewed, user_id
    FROM knowledge_blocks
    WHERE ${conditions}
    ORDER BY quality_score DESC, structured_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countSql = `SELECT COUNT(*) FROM knowledge_blocks WHERE ${conditions}`;

  const [rows, count] = await Promise.all([
    query(sql, params),
    query(countSql, filterParams),
  ]);

  return {
    blocks: rows.rows,
    total: parseInt(count.rows[0].count, 10),
    page,
    pageSize,
  };
}

// ── Crawl run management ──────────────────────────────────────────
async function createCrawlRun({ sourceIds, topic, triggeredBy = 'system' }) {
  const result = await query(
    `INSERT INTO crawl_runs (source_ids, topic, triggered_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [sourceIds, topic || null, triggeredBy]
  );
  return result.rows[0].id;
}

async function updateCrawlRun(id, updates) {
  const fields = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

  await query(
    `UPDATE crawl_runs SET ${setClause} WHERE id = $1`,
    [id, ...values]
  );
}

async function completeCrawlRun(id, { blocksCreated, blocksSkipped, errors = [] }) {
  await query(
    `UPDATE crawl_runs
     SET status = 'complete', completed_at = NOW(),
         blocks_created = $2, blocks_skipped = $3, errors = $4
     WHERE id = $1`,
    [id, blocksCreated, blocksSkipped, JSON.stringify(errors)]
  );
}

async function failCrawlRun(id, error) {
  await query(
    `UPDATE crawl_runs SET status = 'failed', completed_at = NOW(), errors = $2 WHERE id = $1`,
    [id, JSON.stringify([{ message: error }])]
  );
}

module.exports = {
  saveBlock,
  saveEmbedding,
  similarBlocks,
  searchByTopic,
  getBlock,
  listBlocks,
  createCrawlRun,
  updateCrawlRun,
  completeCrawlRun,
  failCrawlRun,
};
