'use strict';

const express = require('express');
const { ingestionQueue } = require('../queue/worker');
const { runIngestion } = require('../ingestion/pipeline');
const { listBlocks, getBlock, searchByTopic, saveBlock, saveEmbedding } = require('../storage/knowledge');
const { generateEmbeddings } = require('../embeddings/embedder');
const { getSources } = require('../ingestion/sources');
const { healthCheck } = require('../storage/db');
const logger = require('../utils/logger');

const router = express.Router();

// ── Admin Auth ──────────────────────────────────────────────────
const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  const secret = process.env.ADMIN_API_KEY || 'storyvista_admin_secret';
  
  if (token === secret) return next();
  res.status(403).json({ error: 'Admin access required' });
};

// ── Health ─────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const db = await healthCheck();
  res.json({ status: db ? 'ok' : 'degraded', db, ts: new Date().toISOString() });
});

// ── Sources ────────────────────────────────────────────────────────
router.get('/sources', (req, res) => {
  const { region, subjects } = req.query;
  const sources = getSources({
    region: region || 'all',
    subjects: subjects ? subjects.split(',') : undefined,
  });
  res.json({ sources });
});

// ── Trigger ingestion (ADMIN ONLY) ────────────────────────────────
router.post('/ingest', adminAuth, async (req, res) => {
  try {
    const { sourceIds, topic, subjects, region, direct = false } = req.body || {};

    // DIRECT MODE: Bypasses Redis Queue (Good for No-Redis environments)
    if (direct || process.env.QUEUE_ENABLED === 'false') {
      logger.info(`[API] Processing DIRECT ingestion for topic: "${topic}"`);
      const summary = await runIngestion({ sourceIds, topic, subjects, region, triggeredBy: 'api_direct' });
      return res.json({ status: 'completed', message: 'Direct ingestion finished', summary });
    }

    // QUEUE MODE: Requires Redis
    const job = await ingestionQueue.add(
      { sourceIds, topic, subjects, region, triggeredBy: 'api' },
      { priority: 1 }
    );

    logger.info(`[API] Ingestion job queued: ${job.id}`);
    res.status(202).json({ jobId: job.id, status: 'queued', message: 'Ingestion started' });
  } catch (err) {
    logger.error(`[API] /ingest error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Job status (ADMIN ONLY) ───────────────────────────────────────
router.get('/ingest/job/:id', adminAuth, async (req, res) => {
  try {
    const job = await ingestionQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const state = await job.getState();
    const progress = job._progress;
    res.json({ jobId: job.id, state, progress, result: job.returnvalue || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Knowledge blocks ───────────────────────────────────────────────
router.get('/knowledge', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, sourceId, minQuality, subjects, userId } = req.query;
    const result = await listBlocks({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      sourceId,
      minQuality: minQuality ? parseFloat(minQuality) : 0,
      subjects: subjects ? subjects.split(',') : [],
      userId
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/knowledge/search', async (req, res) => {
  try {
    const { q, subjects, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'q (query) is required' });

    const blocks = await searchByTopic(q, {
      subjects: subjects ? subjects.split(',') : [],
      limit: parseInt(limit || 10, 10),
    });
    res.json({ query: q, results: blocks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/knowledge/user', async (req, res) => {
  try {
    const { topic, content, userId } = req.body;
    if (!content || !userId) return res.status(400).json({ error: 'content and userId required' });

    const blockId = await saveBlock({
      userId,
      topic: topic || 'Personal Note',
      summary: content,
      qualityScore: 1.0,
      isChildSafe: true
    });

    // Smartly generate embeddings so it's searchable for RAG stories
    const embeddings = await generateEmbeddings(content);
    await saveEmbedding(blockId, embeddings);

    res.json({ success: true, id: blockId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/knowledge/:id', async (req, res) => {
  try {
    const block = await getBlock(req.params.id);
    if (!block) return res.status(404).json({ error: 'Block not found' });
    res.json(block);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
