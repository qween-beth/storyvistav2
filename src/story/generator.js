'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { retrieveBlocks, buildContext } = require('./retriever');
const { resolveMedia } = require('../media/index');
const { narrateStory } = require('../voice/tts');
const { saveStory } = require('../storage/generations');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

let _claude = null;
function claude() {
  if (!_claude) _claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _claude;
}

const Groq = require('groq-sdk');
let _groq = null;
function groq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// ── Output schema ─────────────────────────────────────────────────
const StorySchema = z.object({
  title: z.string(),
  tagline: z.string(),
  characters: z.array(z.object({
    name: z.string(),
    description: z.string(),
  })),
  scenes: z.array(z.object({
    sceneNumber: z.number(),
    title: z.string(),
    narrative: z.string(),
    imageHint: z.string(),   // fed to media resolver
    educationalMoment: z.string().optional(), // the fact embedded in this scene
  })),
  ending: z.string(),
  discussionQuestions: z.array(z.string()),
  factsLearned: z.array(z.string()),
  sources: z.array(z.object({
    name: z.string(),
    url: z.string(),
  })),
  ageband: z.string(),
  topic: z.string(),
});

// ── System prompt ─────────────────────────────────────────────────
const STORY_SYSTEM = `You are the Story Vista narrative engine. You create engaging, educational children's stories grounded in real, verified knowledge.

CRITICAL RULES:
- Only use facts from the provided KNOWLEDGE BLOCKS — never invent facts
- Each scene must naturally embed one educational fact or concept
- Every scene MUST have a unique, visually descriptive imageHint (e.g. 'A small seedling in a hand' vs 'A massive ancient canopy')
- Language and complexity must match the target age band exactly
- Characters should be diverse and relatable (reflect African context when region=ng)
- Stories must have a clear beginning, middle, and end with emotional resonance
- Always include the sources the facts came from

AGE BAND GUIDELINES:
- 3-5: Very short scenes, 2-3 sentences each. Simple words. Repetition is good.
- 6-8: 4-6 sentences per scene. Clear cause and effect. One new concept per scene.
- 9-12: Richer narrative, 6-10 sentences. Can handle multiple concepts. More complex emotions.

OUTPUT: Valid JSON only. No markdown fences. No preamble.`;

// ── Build story prompt ────────────────────────────────────────────
function buildStoryPrompt(request, context) {
  const { topic, ageBand, region, characterHint, settingHint, emotionalTheme, sceneCount } = request;

  return `Create a children's story about: "${topic}"
Target age band: ${ageBand}
Region/culture context: ${region || 'ng'}
${characterHint ? `Main character hint: ${characterHint}` : ''}
${settingHint ? `Setting hint: ${settingHint}` : ''}
${emotionalTheme ? `Emotional theme: ${emotionalTheme}` : ''}
Number of scenes: ${sceneCount || 4}

KNOWLEDGE BLOCKS (use ONLY these facts):
${context}

Return a JSON object with this exact structure:
{
  "title": "story title",
  "tagline": "one sentence hook",
  "characters": [{ "name": "...", "description": "..." }],
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "scene title",
      "narrative": "full scene text",
      "imageHint": "description of what the scene image should show (15-20 words)",
      "educationalMoment": "the specific fact embedded in this scene"
    }
  ],
  "ending": "closing paragraph",
  "discussionQuestions": ["question 1", "question 2", "question 3"],
  "factsLearned": ["fact 1", "fact 2", "fact 3"],
  "sources": [{ "name": "source name", "url": "source url" }],
  "ageband": "${ageBand}",
  "topic": "${topic}"
}`;
}

// ── Generate story with Claude ────────────────────────────────────
async function generateStoryText(request, context) {
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';

  const response = await claude().messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.8,   // Higher temp for creative variation
    system: STORY_SYSTEM,
    messages: [{ role: 'user', content: buildStoryPrompt(request, context) }],
  });

  const raw = response.content[0]?.text || '';

  try {
    const clean = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    logger.error(`[StoryGen] JSON parse error: ${err.message}`);
    throw new Error('Story generation returned invalid JSON');
  }
}

// ── Generate Generic Story with Groq ──────────────────────────────
async function generateGenericStoryText(request) {
  const model = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';
  
  const GENERIC_SYSTEM = `You are the Story Vista narrative engine. You create engaging, creative children's stories.
CRITICAL RULES:
- Create a fun, imaginative story about the requested topic
- Language and complexity must match the target age band exactly
- Characters should be diverse and relatable (reflect African context when region=ng)
- Stories must have a clear beginning, middle, and end with emotional resonance

AGE BAND GUIDELINES:
- 3-5: Very short scenes, 2-3 sentences each. Simple words. Repetition is good.
- 6-8: 4-6 sentences per scene. Clear cause and effect. One new concept per scene.
- 9-12: Richer narrative, 6-10 sentences. Can handle multiple concepts. More complex emotions.

OUTPUT: Valid JSON only. exact schema:
{
  "title": "story title",
  "tagline": "one sentence hook",
  "characters": [{ "name": "...", "description": "..." }],
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "scene title",
      "narrative": "full scene text",
      "imageHint": "description of what the scene image should show (15-20 words)"
    }
  ],
  "ending": "closing paragraph",
  "discussionQuestions": ["question 1", "question 2", "question 3"],
  "factsLearned": [],
  "sources": [{ "name": "AI Generated Imagination", "url": "N/A" }],
  "ageband": "...",
  "topic": "..."
}`;

  const _storyPrompt = `Create a fun children's story about: "${request.topic}"
Target age band: ${request.ageBand}
Region/culture context: ${request.region || 'ng'}
Number of scenes: ${request.sceneCount || 4}`;

  const response = await groq().chat.completions.create({
    model,
    max_tokens: 4096,
    temperature: 0.9,
    response_format: { type: "json_object" },
    messages: [
      { role: 'system', content: GENERIC_SYSTEM },
      { role: 'user', content: _storyPrompt }
    ],
  });

  const raw = response.choices[0]?.message?.content || '';

  try {
    const clean = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    logger.error(`[StoryGen] Generic JSON parse error: ${err.message}`);
    throw new Error('Generic story generation returned invalid JSON');
  }
}

/**
 * MAIN: Generate a complete story with text + images
 *
 * @param {Object} request
 * @param {string} request.topic          - story topic
 * @param {string} request.ageBand        - '3-5' | '6-8' | '9-12'
 * @param {string} [request.region]       - 'ng' | 'global'
 * @param {string} [request.characterHint]
 * @param {string} [request.settingHint]
 * @param {string} [request.emotionalTheme]
 * @param {number} [request.sceneCount]   - default 4
 * @param {boolean}[request.withImages]   - resolve images for each scene (default true)
 * @param {boolean}[request.withAudio]    - gen audio narration (default false)
 * @param {string} [request.voiceId]      - elevenlabs voice
 * @returns {Promise<Story>}
 */
async function generateStory(request) {
  const {
    topic,
    ageBand = '6-8',
    region = 'ng',
    sceneCount = 4,
    withImages = true,
    withAudio = false,
    voiceId,
    userId = null,
  } = request;

  logger.info(`[StoryGen] Generating story — topic="${topic}" age="${ageBand}" user="${userId || 'anon'}"`);

  // ── 1. Retrieve relevant knowledge blocks ─────────────────────
  const blocks = await retrieveBlocks({ topic, ageBand, limit: 6, userId });

  let story;
  
  if (blocks.length === 0) {
    logger.info(`[StoryGen] No knowledge blocks found for topic: "${topic}". Falling back to generic generative AI using Groq.`);
    story = await generateGenericStoryText({ ...request, sceneCount, region });
    story._mode = 'generic'; // Mark as generic
  } else {
    logger.info(`[StoryGen] Retrieved ${blocks.length} knowledge blocks`);
    const context = buildContext(blocks, ageBand);
    story = await generateStoryText({ ...request, sceneCount, region }, context);
    story._mode = 'rag'; // Mark as knowledge-grounded
  }

  // Validate schema
  const validation = StorySchema.safeParse(story);
  if (!validation.success) {
    logger.warn('[StoryGen] Story failed schema validation', validation.error.flatten());
  }

  // ── 4. Resolve images for each scene ─────────────────────────
  if (withImages) {
    logger.info(`[StoryGen] Resolving images for ${story.scenes?.length || 0} scenes`);
    
    // In generic mode, we use a pseudo-block based on the topic
    const imageBlock = blocks.length > 0 ? blocks[0] : { 
      id: 'gen_' + Date.now(), 
      topic: story.topic || topic, 
      content: story.tagline || topic 
    };

    const scenesWithMedia = await Promise.all(
      (story.scenes || []).map(async (scene) => {
        const media = await resolveMedia(
          imageBlock,
          'story',
          ageBand,
          region,
          scene.imageHint || scene.title
        );
        return { ...scene, media };
      })
    );

    story.scenes = scenesWithMedia;
  }

  // ── 5. Generate Narration ──────────────────────────────────────
  if (withAudio) {
    logger.info(`[StoryGen] Generating full audio narration for story: "${story.title}"`);
    const audioDir = path.join(__dirname, '../frontend/public/audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    
    // Create a unique folder for this story
    const storyId = 'story_' + Date.now();
    const storyAudioDir = path.join(audioDir, storyId);
    fs.mkdirSync(storyAudioDir);
    
    const audioResults = await narrateStory(story, voiceId, storyAudioDir, true);
    
    audioResults.forEach(res => {
      if (!res.error && res.fileName) {
        const url = `/audio/${storyId}/${res.fileName}`;
        if (res.type === 'full') {
          story.introAudioUrl = url;
          story.isFullNarration = true;
        } else if (res.type === 'intro') {
          story.introAudioUrl = url;
        } else if (res.type === 'ending') {
          story.endingAudioUrl = url;
        } else if (res.type === 'scene') {
          const scene = story.scenes.find(s => s.sceneNumber === res.sceneNumber);
          if (scene) scene.audioUrl = url;
        }
      }
    });
  }

  // ── 6. Attach metadata ────────────────────────────────────────
  story._meta = {
    generatedAt: new Date().toISOString(),
    blocksUsed: blocks.map((b) => ({ id: b.id, topic: b.topic })),
    region,
    schemaValid: StorySchema.safeParse(story).success,
    mode: story._mode,
  };

  logger.info(`[StoryGen] ✓ Story complete: "${story.title}"`);
  
  // ── 7. Save to library ────────────────────────────────────────
  const saved = await saveStory(story);
  if (saved) {
    story.id = saved.id;
    story.created_at = saved.created_at;
  }
  
  return story;
}

module.exports = { generateStory };
