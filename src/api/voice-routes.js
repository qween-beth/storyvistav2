'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { textToSpeech, narrateStory, narrateLesson, listVoices, getUsage, DEFAULT_VOICES } = require('../voice/tts');
const { cloneVoice, deleteClonedVoice, getUserVoices, getDefaultVoice } = require('../voice/cloning');
const logger = require('../utils/logger');

const router = express.Router();

// Multer config — audio uploads only, 50MB max
const upload = multer({
  dest: '/tmp/storyvista-uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.ogg', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error(`Invalid file type: ${ext}. Allowed: ${allowed.join(', ')}`));
  },
});

// ── TTS: single text block ─────────────────────────────────────
/**
 * POST /api/v1/voice/speak
 * Body: { text, voiceId, contentType }
 * Returns: audio/mpeg stream
 */
router.post('/voice/speak', async (req, res) => {
  try {
    const { text, voiceId, contentType = 'story' } = req.body;
    if (!text) return res.status(400).json({ error: '"text" is required' });

    const audio = await textToSpeech(text, { voiceId, contentType });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audio.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(audio);
  } catch (err) {
    logger.error(`[API] /voice/speak error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Narrate a full story ───────────────────────────────────────
/**
 * POST /api/v1/voice/narrate/story
 * Body: { story, voiceId }
 * Returns: { segments: [{ sceneNumber, audioUrl, text }] }
 *
 * Saves audio files to disk and returns paths/URLs
 */
router.post('/voice/narrate/story', async (req, res) => {
  try {
    const { story, voiceId } = req.body;
    if (!story) return res.status(400).json({ error: '"story" is required' });

    const outputDir = `/tmp/storyvista-audio/${Date.now()}`;
    fs.mkdirSync(outputDir, { recursive: true });

    const segments = await narrateStory(story, voiceId, outputDir);

    // Return segment metadata (not raw audio buffers)
    const response = segments.map((s) => ({
      type: s.type,
      sceneNumber: s.sceneNumber,
      text: s.text,
      fileName: s.fileName,
      error: s.error || null,
    }));

    res.json({ segments: response, outputDir });
  } catch (err) {
    logger.error(`[API] /voice/narrate/story error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Narrate a lesson ───────────────────────────────────────────
router.post('/voice/narrate/lesson', async (req, res) => {
  try {
    const { lesson, voiceId } = req.body;
    if (!lesson) return res.status(400).json({ error: '"lesson" is required' });

    const outputDir = `/tmp/storyvista-audio/${Date.now()}`;
    fs.mkdirSync(outputDir, { recursive: true });

    const segments = await narrateLesson(lesson, voiceId, outputDir);
    res.json({ segments, outputDir });
  } catch (err) {
    logger.error(`[API] /voice/narrate/lesson error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── List default voices ────────────────────────────────────────
router.get('/voice/defaults', (req, res) => {
  res.json({ voices: DEFAULT_VOICES });
});

router.get('/voice/list', async (req, res) => {
  try {
    const voices = await listVoices();
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/voice/usage', async (req, res) => {
  try {
    const usage = await getUsage();
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Voice cloning ──────────────────────────────────────────────
/**
 * POST /api/v1/voice/clone
 * Multipart form: name, voiceType, userId + audio files
 */
router.post('/voice/clone', upload.array('samples', 5), async (req, res) => {
  const uploadedFiles = req.files || [];
  try {
    const { name, voiceType = 'parent', userId, description } = req.body;
    if (!name) return res.status(400).json({ error: '"name" is required' });
    if (!userId) return res.status(400).json({ error: '"userId" is required' });
    if (!uploadedFiles.length) return res.status(400).json({ error: 'At least one audio sample is required' });

    const samplePaths = uploadedFiles.map((f) => f.path);
    const result = await cloneVoice({ name, samplePaths, description, userId, voiceType });

    res.status(201).json({ message: 'Voice cloned successfully', ...result });
  } catch (err) {
    logger.error(`[API] /voice/clone error: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up temp files
    uploadedFiles.forEach((f) => fs.unlink(f.path, () => {}));
  }
});

router.get('/voice/cloned/:userId', async (req, res) => {
  try {
    const voices = await getUserVoices(req.params.userId);
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/voice/cloned/:voiceId', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: '"userId" is required' });
    await deleteClonedVoice(req.params.voiceId, userId);
    res.json({ message: 'Voice deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
