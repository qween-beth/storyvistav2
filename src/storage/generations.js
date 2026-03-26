'use strict';

const { query } = require('./db');
const logger = require('../utils/logger');

/**
 * Save a generated story to the database
 */
async function saveStory(story) {
  const sql = `
    INSERT INTO stories (topic, title, age_band, mode, has_images, has_audio, content)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, created_at
  `;

  const hasImages = (story.scenes || []).some(s => s.media?.url);
  const hasAudio = !!(story.introAudioUrl || (story.scenes?.[0]?.audioUrl));

  const params = [
    story.topic || 'Unknown',
    story.title || 'Untitled Story',
    story.ageband || '6-8',
    story._meta?.mode || 'rag',
    hasImages,
    hasAudio,
    JSON.stringify(story)
  ];

  try {
    const result = await query(sql, params);
    const saved = result.rows[0];
    logger.info(`[Storage] Saved story to library: ${saved.id}`);
    return saved;
  } catch (err) {
    logger.error(`[Storage] Failed to save story: ${err.message}`);
    // Don't throw, just log. Library saving is a secondary concern.
    return null;
  }
}

/**
 * Save a generated lesson to the database
 */
async function saveLesson(lesson) {
  const sql = `
    INSERT INTO lessons (topic, title, age_band, subject, content)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, created_at
  `;

  const params = [
    lesson.topic || 'Unknown',
    lesson.title || 'Untitled Lesson',
    lesson.ageBand || '9-12',
    lesson.subject || null,
    JSON.stringify(lesson)
  ];

  try {
    const result = await query(sql, params);
    const saved = result.rows[0];
    logger.info(`[Storage] Saved lesson to library: ${saved.id}`);
    return saved;
  } catch (err) {
    logger.error(`[Storage] Failed to save lesson: ${err.message}`);
    return null;
  }
}

/**
 * List recent generations
 */
async function listLibrary({ limit = 20, offset = 0 } = {}) {
  const sql = `
    SELECT id, topic, title, age_band, mode, has_images, has_audio, created_at, 'story' as type
    FROM stories
    UNION ALL
    SELECT id, topic, title, age_band, null as mode, true as has_images, false as has_audio, created_at, 'lesson' as type
    FROM lessons
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;

  const result = await query(sql, [limit, offset]);
  return result.rows;
}

/**
 * Get a specific story from the library
 */
async function getStory(id) {
  const result = await query('SELECT content FROM stories WHERE id = $1', [id]);
  return result.rows[0]?.content || null;
}

/**
 * Get a specific lesson from the library
 */
async function getLesson(id) {
  const result = await query('SELECT content FROM lessons WHERE id = $1', [id]);
  return result.rows[0]?.content || null;
}

/**
 * Delete a specific story from the library
 */
async function deleteStory(id) {
  await query('DELETE FROM stories WHERE id = $1', [id]);
  return true;
}

/**
 * Delete a specific lesson from the library
 */
async function deleteLesson(id) {
  await query('DELETE FROM lessons WHERE id = $1', [id]);
  return true;
}

module.exports = {
  saveStory,
  saveLesson,
  listLibrary,
  getStory,
  getLesson,
  deleteStory,
  deleteLesson
};
