'use strict';

require('dotenv').config();

const express = require('express');
const routes = require('./api/routes');
const logger = require('./utils/logger');
const { healthCheck, close } = require('./storage/db');
const fs = require('fs');

// Ensure logs directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

const app = express();
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Routes
const storyRoutes = require('./api/story-routes');
const voiceRoutes = require('./api/voice-routes');
const mediaRoutes = require('./api/media-routes');
const { router: authRouter } = require('./api/auth');
app.use('/api/v1', routes);
app.use('/api/v1', storyRoutes);
app.use('/api/v1', voiceRoutes);
app.use('/api/v1', mediaRoutes);
app.use('/api/v1/auth', authRouter);

// Serve frontend
const path = require('path');
app.use(express.static(path.join(__dirname, 'frontend/public')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'frontend/public/index.html'));
  }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Startup
const PORT = process.env.PORT || 3000;

async function start() {
  const dbOk = await healthCheck();
  if (!dbOk) {
    logger.error('[Server] Cannot connect to database. Run: npm run migrate');
    logger.warn('[Server] Starting anyway — DB-dependent routes will fail');
  } else {
    logger.info('[Server] Database connection OK');
  }

  app.listen(PORT, () => {
    logger.info(`[Server] Story Vista Ingestion API running on port ${PORT}`);
    logger.info(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('[Server] SIGTERM received — shutting down');
  await close();
  process.exit(0);
});

start();
