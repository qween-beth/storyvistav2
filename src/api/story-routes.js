'use strict';

const express = require('express');
const { generateStory } = require('../story/generator');
const { generateLesson } = require('../story/lesson');
const { listLibrary, getStory, getLesson, deleteStory, deleteLesson } = require('../storage/generations');
const { resolveMedia } = require('../media/index');
const { searchImages } = require('../media/wikimedia');
const { embedPendingBlocks } = require('../embeddings/embedder');
const logger = require('../utils/logger');

const router = express.Router();

// ── Story generation ───────────────────────────────────────────────
/**
 * POST /api/v1/story/generate
 * Body: { topic, ageBand, region, characterHint, settingHint, sceneCount, withImages }
 */
router.post('/story/generate', async (req, res) => {
  try {
    const {
      topic,
      ageBand = '6-8',
      region = 'ng',
      characterHint,
      settingHint,
      emotionalTheme,
      sceneCount = 4,
      withImages = true,
      withAudio = false,
      voiceId,
    } = req.body;

    if (!topic) return res.status(400).json({ error: '"topic" is required' });

    const validAgeBands = ['3-5', '6-8', '9-12'];
    if (!validAgeBands.includes(ageBand)) {
      return res.status(400).json({ error: `ageBand must be one of: ${validAgeBands.join(', ')}` });
    }

    logger.info(`[API] Story request: "${topic}" age=${ageBand}`);

    const story = await generateStory({
      topic, ageBand, region,
      characterHint, settingHint, emotionalTheme,
      sceneCount, withImages, withAudio, voiceId
    });

    res.json(story);
  } catch (err) {
    logger.error(`[API] Story generation error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Lesson generation ──────────────────────────────────────────────
/**
 * POST /api/v1/lesson/generate
 * Body: { topic, ageBand, subject, duration, region, curriculumNote, withImages }
 */
router.post('/lesson/generate', async (req, res) => {
  try {
    const {
      topic,
      ageBand = '9-12',
      subject,
      duration = 20,
      region = 'ng',
      curriculumNote,
      withImages = true,
    } = req.body;

    if (!topic) return res.status(400).json({ error: '"topic" is required' });

    const lesson = await generateLesson({
      topic, ageBand, subject, duration,
      region, curriculumNote, withImages,
    });

    res.json(lesson);
  } catch (err) {
    logger.error(`[API] Lesson generation error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Media endpoints ────────────────────────────────────────────────
/**
 * GET /api/v1/media/search?q=photosynthesis&limit=5
 */
router.get('/media/search', async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q) return res.status(400).json({ error: '"q" (query) is required' });

    const images = await searchImages(q, { limit: parseInt(limit, 10) });
    res.json({ query: q, count: images.length, images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Embedding trigger ──────────────────────────────────────────────
/**
 * POST /api/v1/embed
 * Embeds all un-embedded knowledge blocks (run after ingestion)
 */
router.post('/embed', async (req, res) => {
  try {
    const { limit = 50 } = req.body || {};
    // Run in background
    embedPendingBlocks(limit)
      .then((result) => logger.info('[API] Embedding complete', result))
      .catch((err) => logger.error('[API] Embedding error:', err.message));

    res.status(202).json({ message: 'Embedding started in background', limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Library ────────────────────────────────────────────────────────
router.get('/library', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const history = (await listLibrary({ 
      limit: parseInt(limit, 10), 
      offset: parseInt(offset, 10) 
    })) || [];
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/library/item/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    let content;
    if (type === 'story') content = await getStory(id);
    else if (type === 'lesson') content = await getLesson(id);
    else return res.status(400).json({ error: 'Invalid type' });

    if (!content) return res.status(404).json({ error: 'Item not found' });
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/library/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === 'story') await deleteStory(id);
    else if (type === 'lesson') await deleteLesson(id);
    else return res.status(400).json({ error: 'Invalid type' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { packageStoryVideo } = require('../media/packager');

// ── Admin: Media override ─────────────────────────────────────────
/**
 * PATCH /api/v1/library/story/:id/scene/:sceneIdx/media
 * Body: { url }
 */
router.patch('/library/story/:id/scene/:sceneIdx/media', async (req, res) => {
  try {
    const { id, sceneIdx } = req.params;
    const { url } = req.get ? req.body.url : req.body;
    const finalUrl = typeof url === 'string' ? url : req.body.url;
    
    if (!finalUrl) return res.status(400).json({ error: '"url" is required' });

    const { getStory } = require('../storage/generations');
    const { query } = require('../storage/db');

    const story = await getStory(id);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const idx = parseInt(sceneIdx, 10);
    if (!story.scenes || !story.scenes[idx]) return res.status(400).json({ error: 'Invalid scene index' });

    // Update scene media
    if (!story.scenes[idx].media) story.scenes[idx].media = {};
    story.scenes[idx].media.url = finalUrl;
    story.scenes[idx].media.source = 'admin-override';

    // Update main has_images flag if needed
    const hasImages = (story.scenes || []).some(s => s.media?.url);

    // Save back to DB
    const sql = 'UPDATE stories SET content = $1, has_images = $2 WHERE id = $3';
    await query(sql, [JSON.stringify(story), hasImages, id]);

    res.json({ success: true, url: finalUrl });
  } catch (err) {
    logger.error(`[Admin] Media override error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Story Video Export ──────────────────────────────────────────
/**
 * POST /api/v1/story/export/video
 * Body: { id }
 */
router.post('/story/export/video', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: '"id" is required' });

    const story = await getStory(id);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    logger.info(`[API] Packaging video for story: "${story.title}"`);
    const videoPath = await packageStoryVideo(story);

    res.download(videoPath, `${story.title.replace(/\s+/g, '_')}.mp4`, (err) => {
      if (err) logger.error(`[API] Video download failed: ${err.message}`);
      
      // Cleanup temp directory after download
      const dir = require('path').dirname(videoPath);
      require('fs').rm(dir, { recursive: true, force: true }, () => {});
    });
  } catch (err) {
    logger.error(`[API] Video export error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
