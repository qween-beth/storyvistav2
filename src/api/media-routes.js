'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const router = express.Router();

// ── Mullter Storage configuration ──────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../frontend/public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'user_upload_' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (JPEG, PNG, WEBP) are allowed'));
  }
});

/**
 * POST /api/v1/media/upload
 * Returns the public URL of the uploaded image
 */
router.post('/media/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    
    // Public path (for browser display)
    const url = `/uploads/${req.file.filename}`;
    
    logger.info(`[Media] File uploaded: ${url}`);
    res.json({ success: true, url });
    
  } catch (err) {
    logger.error(`[Media] Upload error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
