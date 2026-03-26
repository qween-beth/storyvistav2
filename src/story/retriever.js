'use strict';

const { similarBlocks, searchByTopic } = require('../storage/knowledge');
const { embedQuery } = require('../embeddings/embedder');
const logger = require('../utils/logger');

/**
 * Retrieve the most relevant knowledge blocks for a story/lesson request.
 * Uses vector similarity if embeddings are available, falls back to full-text.
 *
 * @param {Object} request
 * @param {string} request.topic      - what the story/lesson is about
 * @param {string} request.ageBand    - '3-5' | '6-8' | '9-12'
 * @param {string[]} request.subjects - subject filters
 * @param {number} request.limit      - max blocks to retrieve (default 5)
 * @returns {Promise<Array<KnowledgeBlock>>}
 */
async function retrieveBlocks(request) {
  const { topic, ageBand = '6-8', subjects = [], limit = 5 } = request;

  logger.info(`[Retriever] Retrieving blocks for topic="${topic}" age="${ageBand}"`);

  // ── Try vector search first ───────────────────────────────────
  try {
    const queryEmbedding = await embedQuery(topic);
    const blocks = await similarBlocks(queryEmbedding, {
      limit,
      ageBand,
      subjects,
      minQuality: 0.4,
    });

    if (blocks.length > 0) {
      logger.info(`[Retriever] Vector search: ${blocks.length} blocks found`);
      return blocks.map(normaliseBlock);
    }
  } catch (err) {
    logger.warn(`[Retriever] Vector search unavailable: ${err.message} — falling back to text search`);
  }

  // ── Fall back to full-text search ─────────────────────────────
  const blocks = await searchByTopic(topic, { subjects, limit });
  logger.info(`[Retriever] Text search: ${blocks.length} blocks found`);
  return blocks.map(normaliseBlock);
}

// ── Normalise DB row to consistent block shape ────────────────────
function normaliseBlock(row) {
  return {
    id: row.id,
    topic: row.topic,
    summary: row.summary,
    subjects: row.subjects || [],
    qualityScore: row.quality_score || row.qualityScore,
    ageBands: {
      '3-5': row.explanation_3_5 || null,
      '6-8': row.explanation_6_8 || null,
      '9-12': row.explanation_9_12 || null,
    },
    facts: typeof row.facts === 'string' ? JSON.parse(row.facts) : (row.facts || []),
    keyConcepts: row.key_concepts || [],
    storyElements: typeof row.story_elements === 'string'
      ? JSON.parse(row.story_elements) : (row.story_elements || {}),
    lessonElements: typeof row.lesson_elements === 'string'
      ? JSON.parse(row.lesson_elements) : (row.lesson_elements || {}),
    source: {
      name: row.source_name,
      url: row.source_url,
      pageUrl: row.page_url,
      pageTitle: row.page_title,
    },
  };
}

/**
 * Build a context string from retrieved blocks for injection into LLM prompts.
 * Includes source attribution so the LLM can ground its output.
 *
 * @param {Array} blocks
 * @param {string} ageBand
 * @returns {string}
 */
function buildContext(blocks, ageBand = '6-8') {
  return blocks.map((block, i) => {
    const explanation = block.ageBands?.[ageBand] || block.summary;
    const facts = block.facts
      .filter((f) => f.confidence !== 'low')
      .slice(0, 4)
      .map((f) => `  • ${f.statement}`)
      .join('\n');

    return `[KNOWLEDGE BLOCK ${i + 1}]
Topic: ${block.topic}
Source: ${block.source.name} (${block.source.pageUrl})
Explanation (age ${ageBand}): ${explanation}
Key Facts:
${facts}
Key Concepts: ${(block.keyConcepts || []).slice(0, 4).join(', ')}`;
  }).join('\n\n');
}

module.exports = { retrieveBlocks, buildContext, normaliseBlock };
