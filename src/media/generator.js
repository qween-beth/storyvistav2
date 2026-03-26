'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

// ── Style presets per content type ────────────────────────────────
const STYLE_PRESETS = {
  story: {
    base: 'children\'s book illustration style, warm colours, soft lighting, friendly and inviting, high quality digital art',
    suffix: 'safe for children, no text, no letters',
  },
  lesson: {
    base: 'clean educational illustration, clear and informative, bright colours, simple design, diagram style',
    suffix: 'safe for children, no text overlays',
  },
};

// ── Age-band style adjustments ────────────────────────────────────
const AGE_STYLES = {
  '3-5': 'very simple shapes, bold colours, cartoonish, cute characters',
  '6-8': 'illustrated children\'s book style, expressive characters, clear scenes',
  '9-12': 'detailed illustration, slightly more realistic, educational feel',
};

// ── Cultural context hints ────────────────────────────────────────
const REGION_HINTS = {
  ng: 'diverse African children characters, warm African landscape tones where appropriate',
  global: 'diverse, multicultural characters',
};

/**
 * Build a fact-grounded prompt from a knowledge block
 *
 * @param {Object} block        - knowledge block
 * @param {string} contentType  - 'story' | 'lesson'
 * @param {string} ageBand      - '3-5' | '6-8' | '9-12'
 * @param {string} region       - 'ng' | 'global'
 * @param {string} [sceneHint]  - optional specific scene description
 * @returns {string}
 */
function buildImagePrompt(block, contentType = 'story', ageBand = '6-8', region = 'ng', sceneHint = null) {
  const style = STYLE_PRESETS[contentType] || STYLE_PRESETS.story;
  const ageStyle = AGE_STYLES[ageBand] || AGE_STYLES['6-8'];
  const regionHint = REGION_HINTS[region] || REGION_HINTS.global;

  // Pull story elements for richer context
  const storyElements = typeof block.story_elements === 'string'
    ? JSON.parse(block.story_elements)
    : block.story_elements || {};

  const settings = storyElements.possibleSettings?.[0] || 'natural outdoor setting';
  const themes = storyElements.emotionalThemes?.[0] || 'curiosity and wonder';

  // Use a specific scene if provided, otherwise build from block data
  const scene = sceneHint
    || `a scene about "${block.topic}" showing ${settings}, evoking ${themes}`;

  const prompt = [
    style.base,
    ageStyle,
    regionHint,
    scene,
    style.suffix,
  ].filter(Boolean).join(', ');

  return prompt;
}

/**
 * Generate an image via DALL-E 3
 *
 * @param {string} prompt
 * @param {Object} opts
 * @param {string} opts.size    - '1024x1024' | '1792x1024' | '1024x1792'
 * @param {string} opts.quality - 'standard' | 'hd'
 * @returns {Promise<GeneratedImage>}
 */
async function generateImage(prompt, opts = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for image generation');
  }

  const { size = '1792x1024', quality = 'standard' } = opts;

  logger.info(`[ImageGen] Generating image — ${prompt.slice(0, 80)}...`);

  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    {
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      quality,
      response_format: 'url',
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  const image = response.data?.data?.[0];
  if (!image?.url) throw new Error('DALL-E returned no image URL');

  return {
    url: image.url,
    revisedPrompt: image.revised_prompt,
    source: 'dalle',
    license: 'generated',
    attribution: 'AI-generated illustration by Story Vista',
    width: parseInt(size.split('x')[0], 10),
    height: parseInt(size.split('x')[1], 10),
  };
}

/**
 * Generate a block-grounded image (main entry point)
 *
 * @param {Object} block
 * @param {string} contentType
 * @param {string} ageBand
 * @param {string} region
 * @param {string} [sceneHint]
 * @returns {Promise<GeneratedImage>}
 */
async function generateBlockImage(block, contentType = 'story', ageBand = '6-8', region = 'ng', sceneHint = null) {
  const prompt = buildImagePrompt(block, contentType, ageBand, region, sceneHint);
  return generateImage(prompt, {
    size: contentType === 'story' ? '1792x1024' : '1024x1024',
    quality: 'standard',
  });
}

module.exports = { generateImage, generateBlockImage, buildImagePrompt };
