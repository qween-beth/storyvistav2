'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { retrieveBlocks, buildContext } = require('./retriever');
const { resolveMedia } = require('../media/index');
const { saveLesson } = require('../storage/generations');
const logger = require('../utils/logger');

let _claude = null;
function claude() {
  if (!_claude) _claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _claude;
}

const LESSON_SYSTEM = `You are the Story Vista lesson generation engine. You create structured, visual, narration-ready lessons for educators.

CRITICAL RULES:
- Ground every fact in the provided KNOWLEDGE BLOCKS — never invent content
- Each section must map to a learning objective
- Include visual scene descriptions for each concept (used to generate images)
- Write narration scripts as if spoken aloud by a teacher
- Discussion questions must be thought-provoking and open-ended

OUTPUT: Valid JSON only. No markdown. No preamble.`;

function buildLessonPrompt(request, context) {
  const { topic, ageBand, subject, duration, curriculumNote } = request;
  return `Create an educational lesson about: "${topic}"
Target age band: ${ageBand}
Subject area: ${subject || 'general'}
Lesson duration: ${duration || 20} minutes
${curriculumNote ? `Curriculum alignment: ${curriculumNote}` : ''}

KNOWLEDGE BLOCKS (use ONLY these facts):
${context}

Return JSON with this structure:
{
  "title": "lesson title",
  "subject": "subject area",
  "ageBand": "${ageBand}",
  "duration": ${duration || 20},
  "learningObjectives": ["By the end of this lesson, students will be able to..."],
  "sections": [
    {
      "sectionNumber": 1,
      "title": "section title",
      "type": "introduction|concept|activity|review",
      "narrationScript": "what the teacher says aloud",
      "conceptBreakdown": ["step 1", "step 2"],
      "imageHint": "description of the visual for this section (15-20 words)",
      "duration": 5
    }
  ],
  "discussionQuestions": ["question 1", "question 2", "question 3"],
  "keyVocabulary": [{ "term": "...", "definition": "..." }],
  "factsUsed": ["fact 1", "fact 2"],
  "sources": [{ "name": "...", "url": "..." }],
  "topic": "${topic}"
}`;
}

/**
 * Generate a complete lesson plan with text + images
 *
 * @param {Object} request
 * @param {string} request.topic
 * @param {string} request.ageBand
 * @param {string} [request.subject]
 * @param {number} [request.duration]     - lesson length in minutes
 * @param {string} [request.region]
 * @param {boolean}[request.withImages]
 * @returns {Promise<Lesson>}
 */
async function generateLesson(request) {
  const {
    topic,
    ageBand = '9-12',
    region = 'ng',
    withImages = true,
  } = request;

  logger.info(`[LessonGen] Generating lesson — topic="${topic}" age="${ageBand}"`);

  const blocks = await retrieveBlocks({ topic, ageBand, limit: 5 });

  if (blocks.length === 0) {
    throw new Error(`No knowledge blocks found for topic: "${topic}". Run ingestion first.`);
  }

  const context = buildContext(blocks, ageBand);

  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
  const response = await claude().messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.4,   // Lower temp for more structured output
    system: LESSON_SYSTEM,
    messages: [{ role: 'user', content: buildLessonPrompt(request, context) }],
  });

  const raw = response.content[0]?.text || '';
  let lesson;
  try {
    const clean = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    lesson = JSON.parse(clean);
  } catch (err) {
    throw new Error('Lesson generation returned invalid JSON');
  }

  // Resolve images for each section
  if (withImages && blocks.length > 0) {
    const primaryBlock = blocks[0];
    const sectionsWithMedia = await Promise.all(
      (lesson.sections || []).map(async (section) => {
        const media = await resolveMedia(primaryBlock, 'lesson', ageBand, region, section.imageHint);
        return { ...section, media };
      })
    );
    lesson.sections = sectionsWithMedia;
  }

  lesson._meta = {
    generatedAt: new Date().toISOString(),
    blocksUsed: blocks.map((b) => ({ id: b.id, topic: b.topic })),
    region,
  };

  logger.info(`[LessonGen] ✓ Lesson complete: "${lesson.title}"`);

  // ── 7. Save to library ────────────────────────────────────────
  const saved = await saveLesson(lesson);
  if (saved) {
    lesson.id = saved.id;
    lesson.created_at = saved.created_at;
  }

  return lesson;
}

module.exports = { generateLesson };
