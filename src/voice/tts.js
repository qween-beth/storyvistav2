'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const logger = require('../utils/logger');

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// ── Default voices (ElevenLabs pre-built) ────────────────────────
// These are stable, high-quality voices suitable for children's content
const DEFAULT_VOICES = {
  storyteller_female: 'EXAVITQu4vr4xnSDxMaL',  // Sarah  — warm, engaging
  storyteller_male:   'TxGEqnHWrfWFTfGW9XjX',  // Josh   — friendly, clear
  educator_female:    'XrExE9yKIg1WjnnlVkGX',  // Matilda — professional, warm
  educator_male:      'onwK4e9ZLuTAKqWW03F9',  // Daniel — clear, authoritative
  child_friendly:     'jBpfuIE2acCO8z3wKNLl',  // Gigi   — gentle, child-friendly
};

// ── Voice settings per content type ─────────────────────────────
const VOICE_SETTINGS = {
  story: {
    stability: 0.55,          // some variation = more expressive
    similarity_boost: 0.80,
    style: 0.35,
    use_speaker_boost: true,
  },
  lesson: {
    stability: 0.75,          // more stable = clearer for learning
    similarity_boost: 0.85,
    style: 0.20,
    use_speaker_boost: true,
  },
  cloned: {
    stability: 0.65,
    similarity_boost: 0.90,   // high similarity = faithful to original voice
    style: 0.25,
    use_speaker_boost: true,
  },
};

function getHeaders() {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }
  return {
    'xi-api-key': process.env.ELEVENLABS_API_KEY.trim(),
    'Content-Type': 'application/json',
  };
}

// ── Text-to-speech: single text block → audio buffer ─────────────
/**
 * @param {string} text
 * @param {Object} opts
 * @param {string} opts.voiceId       - ElevenLabs voice ID
 * @param {string} opts.contentType   - 'story' | 'lesson'
 * @param {string} opts.modelId       - default: eleven_turbo_v2_5 (fast, quality)
 * @returns {Promise<Buffer>}
 */
async function textToSpeech(text, opts = {}) {
  const {
    voiceId = DEFAULT_VOICES.storyteller_female,
    contentType = 'story',
    modelId = 'eleven_turbo_v2_5',
  } = opts;

  const settings = VOICE_SETTINGS[contentType] || VOICE_SETTINGS.story;

  logger.info(`[Voice] TTS — ${text.length} chars, voice=${voiceId}`);

  try {
    const response = await axios.post(
      `${ELEVENLABS_API}/text-to-speech/${voiceId}`,
      {
        text,
        model_id: modelId,
        voice_settings: settings,
      },
      {
        headers: { ...getHeaders(), Accept: 'audio/mpeg' },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    );
    return Buffer.from(response.data);
  } catch (err) {
    if (err.response && err.response.data) {
      const errorBody = Buffer.from(err.response.data).toString();
      logger.error(`[Voice] TTS API Error (${err.response.status}): ${errorBody}`);
    }
    throw err;
  }
}

// ── Narrate a full story (scene by scene) ────────────────────────
/**
 * Converts each scene's narrative text to audio.
 * Returns array of { sceneNumber, audio: Buffer, duration (est.) }
 *
 * @param {Object} story        - generated story object
 * @param {string} voiceId      - voice to use (default or cloned)
 * @param {string} outputDir    - where to save .mp3 files
 * @returns {Promise<Array>}
 */
async function narrateStory(story, voiceId = null, outputDir = null, singleFile = false) {
  const voice = voiceId || DEFAULT_VOICES.storyteller_female;
  const scenes = story.scenes || [];
  const results = [];

  logger.info(`[Voice] Narrating story "${story.title}" — mode=${singleFile ? 'single-file' : 'multi-segment'}`);

  if (singleFile) {
    try {
      // Build everything into one text block with pauses
      const fullText = [
        `${story.title}.`,
        story.tagline || '',
        ...scenes.map(s => s.narrative),
        story.ending || ''
      ].filter(t => t.trim().length > 0).join('\n\n');

      const audio = await textToSpeech(fullText, { voiceId: voice, contentType: 'story' });
      const result = { type: 'full', audio, text: fullText };
      
      if (outputDir) {
        const filename = 'full_story.mp3';
        fs.writeFileSync(path.join(outputDir, filename), audio);
        result.fileName = filename;
        delete result.audio;
      }
      results.push(result);
      logger.info(`[Voice] Full story narration complete (${audio.length} bytes)`);
      return results;
    } catch (err) {
      logger.error(`[Voice] Full story narration failed: ${err.message}. Falling back to segments.`);
    }
  }

  // Fallback or multi-segment mode: Narrate Intro, Scenes, and Ending separately
  // 1. Narrate title introduction
  try {
    const intro = `${story.title}. ${story.tagline || ''}`.trim();
    const introAudio = await textToSpeech(intro, { voiceId: voice, contentType: 'story' });
    const introRes = { type: 'intro', audio: introAudio, text: intro };
    
    if (outputDir) {
      const filename = 'intro.mp3';
      fs.writeFileSync(path.join(outputDir, filename), introAudio);
      introRes.fileName = filename;
      delete introRes.audio;
    }
    results.push(introRes);
  } catch (err) {
    logger.error(`[Voice] Intro narration failed: ${err.message}`);
    results.push({ type: 'intro', error: err.message });
  }

  // 2. Narrate each scene
  for (const scene of scenes) {
    const text = scene.narrative || '';
    if (!text) continue;

    try {
      const audio = await textToSpeech(text, { voiceId: voice, contentType: 'story' });
      const result = { type: 'scene', sceneNumber: scene.sceneNumber, audio, text };

      if (outputDir) {
        const filename = `scene_${scene.sceneNumber}.mp3`;
        const filepath = path.join(outputDir, filename);
        fs.writeFileSync(filepath, audio);
        result.filePath = filepath;
        result.fileName = filename;
        delete result.audio; 
      }

      results.push(result);
      logger.info(`[Voice] Scene ${scene.sceneNumber} narrated (${audio.length} bytes)`);
      await new Promise((r) => setTimeout(r, 600)); // Longer delay for free tier stability
    } catch (err) {
      logger.error(`[Voice] Scene ${scene.sceneNumber} failed: ${err.message}`);
      results.push({ type: 'scene', sceneNumber: scene.sceneNumber, error: err.message });
    }
  }

  // 3. Narrate ending
  if (story.ending) {
    try {
      const endingAudio = await textToSpeech(story.ending, { voiceId: voice, contentType: 'story' });
      const endingRes = { type: 'ending', audio: endingAudio, text: story.ending };
      
      if (outputDir) {
        const filename = 'ending.mp3';
        fs.writeFileSync(path.join(outputDir, filename), endingAudio);
        endingRes.fileName = filename;
        delete endingRes.audio;
      }
      results.push(endingRes);
    } catch (err) {
      logger.error(`[Voice] Ending narration failed: ${err.message}`);
      results.push({ type: 'ending', error: err.message });
    }
  }

  logger.info(`[Voice] ✓ Story narration complete — ${results.length} audio segments`);
  return results;
}

// ── Narrate a lesson (section by section) ───────────────────────
async function narrateLesson(lesson, voiceId = null, outputDir = null) {
  const voice = voiceId || DEFAULT_VOICES.educator_female;
  const sections = lesson.sections || [];
  const results = [];

  logger.info(`[Voice] Narrating lesson "${lesson.title}" — ${sections.length} sections`);

  for (const section of sections) {
    const text = section.narrationScript || section.title || '';
    if (!text) continue;

    try {
      const audio = await textToSpeech(text, { voiceId: voice, contentType: 'lesson' });
      const result = { type: 'section', sectionNumber: section.sectionNumber, audio, text };

      if (outputDir) {
        const filename = `section_${section.sectionNumber}.mp3`;
        fs.writeFileSync(path.join(outputDir, filename), audio);
        result.filePath = path.join(outputDir, filename);
        delete result.audio;
      }

      results.push(result);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      logger.error(`[Voice] Section ${section.sectionNumber} failed: ${err.message}`);
      results.push({ type: 'section', sectionNumber: section.sectionNumber, error: err.message });
    }
  }

  return results;
}

// ── List available ElevenLabs voices ────────────────────────────
async function listVoices() {
  const response = await axios.get(`${ELEVENLABS_API}/voices`, {
    headers: getHeaders(),
    timeout: 10000,
  });
  return response.data?.voices || [];
}

// ── Get account usage info ───────────────────────────────────────
async function getUsage() {
  const response = await axios.get(`${ELEVENLABS_API}/user/subscription`, {
    headers: getHeaders(),
    timeout: 10000,
  });
  return response.data;
}

module.exports = {
  textToSpeech,
  narrateStory,
  narrateLesson,
  listVoices,
  getUsage,
  DEFAULT_VOICES,
  VOICE_SETTINGS,
};
