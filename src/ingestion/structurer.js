'use strict';

const Groq = require('groq-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const logger = require('../utils/logger');

// ── Clients ───────────────────────────────────────────────────────
let _groq = null;
let _claude = null;

function groq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}
function claude() {
  if (!_claude) _claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _claude;
}

// ── Output Schema (validated with Zod) ────────────────────────────
const FactSchema = z.object({
  statement: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

const KnowledgeBlockSchema = z.object({
  topic: z.string(),
  summary: z.string(),
  facts: z.array(FactSchema),
  ageBands: z.object({
    '3-5': z.string().optional(),
    '6-8': z.string().optional(),
    '9-12': z.string().optional(),
  }),
  keyConcepts: z.array(z.string()),
  storyElements: z.object({
    possibleSettings: z.array(z.string()),
    possibleCharacters: z.array(z.string()),
    emotionalThemes: z.array(z.string()),
  }),
  lessonElements: z.object({
    learningObjectives: z.array(z.string()),
    conceptBreakdown: z.array(z.string()),
    discussionQuestions: z.array(z.string()),
  }),
  subjects: z.array(z.string()),
  isChildAppropriate: z.boolean(),
  qualityScore: z.number().min(0).max(1).optional(),
});

// ── Prompts ───────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a knowledge structuring engine for Story Vista, an AI platform that creates personalised stories and lessons for children aged 3-12.

Your job is to analyse raw educational content and extract structured knowledge blocks.

CRITICAL RULES:
- Only extract factual, verifiable information from the provided text
- Never invent or hallucinate facts
- Flag content as NOT child-appropriate if it contains violence, adult themes, or disturbing material
- Age-band explanations must use vocabulary appropriate for that age group
- All output must be valid JSON matching the schema exactly

OUTPUT FORMAT (JSON only, no markdown, no preamble):
{
  "topic": "string — main topic of this content",
  "summary": "string — 2-3 sentence summary of the content",
  "facts": [
    { "statement": "string — one clear, verifiable fact", "confidence": "high|medium|low" }
  ],
  "ageBands": {
    "3-5": "string — very simple explanation using basic words a 3-5 year old understands",
    "6-8": "string — clear explanation for early readers, short sentences",
    "9-12": "string — fuller explanation with proper terminology"
  },
  "keyConcepts": ["string — important terms or ideas"],
  "storyElements": {
    "possibleSettings": ["string — places this topic could be set"],
    "possibleCharacters": ["string — characters that could explain this topic"],
    "emotionalThemes": ["string — emotions or values this topic can explore"]
  },
  "lessonElements": {
    "learningObjectives": ["string — what a student should know after this lesson"],
    "conceptBreakdown": ["string — sub-concepts to explain step by step"],
    "discussionQuestions": ["string — questions a teacher could ask the class"]
  },
  "subjects": ["string — subject tags e.g. science, geography, history"],
  "isChildAppropriate": true
}`;

function buildUserPrompt(page) {
  return `SOURCE: ${page.sourceName} (${page.pageUrl})
TITLE: ${page.title}
${page.topic ? `TOPIC FOCUS: ${page.topic}` : ''}

CONTENT:
${page.content.slice(0, 6000)}

Extract a structured knowledge block from this content. Return JSON only.`;
}

// ── Groq: Fast first-pass structuring ─────────────────────────────
async function structureWithGroq(page) {
  const model = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';
  logger.debug(`[Structurer] Groq pass → ${page.pageUrl}`);

  const response = await groq().chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(page) },
    ],
  });

  const raw = response.choices[0]?.message?.content || '';
  return parseJSON(raw, 'Groq');
}

// ── Claude: Quality review for low-confidence blocks ──────────────
async function reviewWithClaude(page, groqBlock) {
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
  logger.debug(`[Structurer] Claude review pass → ${page.pageUrl}`);

  const reviewPrompt = `You are reviewing a knowledge block extracted by a fast AI model.
Improve accuracy, fix any errors, and enhance the age-band explanations.
Return the corrected JSON block only.

ORIGINAL SOURCE: ${page.sourceName} (${page.pageUrl})
CONTENT EXCERPT:
${page.content.slice(0, 4000)}

DRAFT BLOCK TO REVIEW:
${JSON.stringify(groqBlock, null, 2)}

Return improved JSON only. Preserve all fields. Fix any inaccuracies.`;

  const response = await claude().messages.create({
    model,
    max_tokens: 2048,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: reviewPrompt }],
  });

  const raw = response.content[0]?.text || '';
  return parseJSON(raw, 'Claude');
}

// ── JSON parser with cleanup ──────────────────────────────────────
function parseJSON(raw, source) {
  try {
    // Strip markdown code fences if present
    const clean = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    logger.error(`[Structurer] JSON parse error from ${source}: ${err.message}`);
    logger.debug(`[Structurer] Raw output: ${raw.slice(0, 500)}`);
    throw new Error(`${source} returned unparseable JSON`);
  }
}

// ── Validate against schema ───────────────────────────────────────
function validateBlock(block) {
  const result = KnowledgeBlockSchema.safeParse(block);
  if (!result.success) {
    logger.warn('[Structurer] Schema validation issues:', result.error.flatten());
    return { valid: false, errors: result.error.flatten(), data: block };
  }
  return { valid: true, errors: null, data: result.data };
}

// ── Calculate quality score ───────────────────────────────────────
function scoreBlock(block) {
  let score = 0;
  if (block.facts?.length >= 3) score += 0.2;
  if (block.facts?.length >= 6) score += 0.1;
  if (block.ageBands?.['6-8']) score += 0.2;
  if (block.ageBands?.['9-12']) score += 0.1;
  if (block.keyConcepts?.length >= 2) score += 0.1;
  if (block.storyElements?.possibleSettings?.length > 0) score += 0.1;
  if (block.lessonElements?.learningObjectives?.length > 0) score += 0.1;
  if (block.isChildAppropriate) score += 0.1;
  const highConfidence = (block.facts || []).filter((f) => f.confidence === 'high').length;
  score += Math.min(highConfidence * 0.02, 0.1);
  return Math.min(score, 1);
}

// ── Main: Structure a raw page into a knowledge block ─────────────
/**
 * @param {Object} page       - raw page from crawler
 * @param {Object} opts
 * @param {boolean} opts.reviewWithClaude - force Claude review regardless of score
 * @param {number}  opts.reviewThreshold  - quality score below which Claude reviews (default 0.6)
 * @returns {Promise<Object>} structured knowledge block with metadata
 */
async function structurePage(page, opts = {}) {
  const { reviewThreshold = 0.6, forceClaudeReview = false } = opts;

  // Step 1: Fast Groq pass
  let block;
  try {
    block = await structureWithGroq(page);
  } catch (err) {
    logger.error(`[Structurer] Groq pass failed for ${page.pageUrl}: ${err.message}`);
    throw err;
  }

  // Step 2: Score it
  const score = scoreBlock(block);
  block.qualityScore = score;

  logger.debug(`[Structurer] Quality score: ${score.toFixed(2)} → ${page.pageUrl}`);

  // Step 3: Claude review if score is below threshold or forced
  if (forceClaudeReview || score < reviewThreshold) {
    logger.info(`[Structurer] Quality ${score.toFixed(2)} < ${reviewThreshold} — sending to Claude review`);
    try {
      const reviewed = await reviewWithClaude(page, block);
      reviewed.qualityScore = Math.min(scoreBlock(reviewed) + 0.1, 1); // bump for human review
      block = reviewed;
    } catch (err) {
      logger.warn(`[Structurer] Claude review failed, using Groq output: ${err.message}`);
    }
  }

  // Step 4: Validate schema
  const validation = validateBlock(block);
  if (!validation.valid) {
    logger.warn(`[Structurer] Block failed schema validation for ${page.pageUrl}`);
  }

  // Step 5: Attach source metadata
  return {
    ...block,
    _meta: {
      sourceId: page.sourceId,
      sourceName: page.sourceName,
      sourceUrl: page.sourceUrl,
      pageUrl: page.pageUrl,
      pageTitle: page.title,
      crawledAt: page.crawledAt,
      structuredAt: new Date().toISOString(),
      qualityScore: block.qualityScore,
      schemaValid: validation.valid,
      claudeReviewed: forceClaudeReview || block.qualityScore < reviewThreshold,
    },
  };
}

/**
 * Structure multiple pages (sequential to respect rate limits)
 * @param {Array} pages
 * @param {Object} opts
 * @returns {Promise<Array>}
 */
async function structurePages(pages, opts = {}) {
  const results = [];
  for (const page of pages) {
    try {
      const block = await structurePage(page, opts);
      if (block.isChildAppropriate !== false) {
        results.push(block);
      } else {
        logger.warn(`[Structurer] Skipping non-child-appropriate content: ${page.pageUrl}`);
      }
    } catch (err) {
      logger.error(`[Structurer] Failed to structure ${page.pageUrl}: ${err.message}`);
      // continue with next page
    }
  }
  return results;
}

module.exports = { structurePage, structurePages, validateBlock, scoreBlock };
