'use strict';

require('dotenv').config();

const Bull = require('bull');
const { runIngestion } = require('../ingestion/pipeline');
const logger = require('../utils/logger');

const ingestionQueue = new Bull('ingestion', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,  // keep last 50 completed jobs
    removeOnFail: 100,
  },
});

// ── Process jobs ──────────────────────────────────────────────────
ingestionQueue.process(1, async (job) => {  // concurrency = 1 (crawl is already parallel internally)
  const { sourceIds, topic, subjects, region, triggeredBy } = job.data;

  logger.info(`[Worker] Processing job ${job.id} — topic="${topic || 'all'}"`, job.data);

  await job.progress(5);

  const summary = await runIngestion({ sourceIds, topic, subjects, region, triggeredBy });

  await job.progress(100);
  return summary;
});

// ── Events ────────────────────────────────────────────────────────
ingestionQueue.on('completed', (job, result) => {
  logger.info(`[Worker] Job ${job.id} completed`, result);
});

ingestionQueue.on('failed', (job, err) => {
  logger.error(`[Worker] Job ${job.id} failed: ${err.message}`);
});

ingestionQueue.on('stalled', (job) => {
  logger.warn(`[Worker] Job ${job.id} stalled`);
});

ingestionQueue.on('error', (err) => {
  logger.error(`[Worker] Queue error: ${err.message}`);
});

logger.info('[Worker] Ingestion worker started, waiting for jobs...');

module.exports = { ingestionQueue };
