'use strict';

const { findBestImage } = require('./wikimedia');
const { generateBlockImage } = require('./generator');
const { query } = require('../storage/db');
const logger = require('../utils/logger');

// ── Media cache schema (add to schema.sql if not present) ─────────
// CREATE TABLE IF NOT EXISTS media_cache (
//   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//   cache_key TEXT UNIQUE NOT NULL,
//   source TEXT NOT NULL,  -- 'wikimedia' | 'dalle'
//   url TEXT NOT NULL,
//   attribution TEXT,
//   license TEXT,
//   source_url TEXT,
//   width INT, height INT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );

/**
 * THE DECISION TREE
 * ─────────────────────────────────────────────────────────────────
 * 1. Check media cache (avoid regenerating the same image)
 * 2. Search Wikimedia Commons for a CC-licensed image
 * 3. If nothing found → generate with DALL-E
 * 4. Cache the result
 *
 * @param {Object} block         - knowledge block
 * @param {string} contentType   - 'story' | 'lesson'
 * @param {string} ageBand       - '3-5' | '6-8' | '9-12'
 * @param {string} region        - 'ng' | 'global'
 * @param {string} [sceneHint]   - specific scene description for AI gen
 * @returns {Promise<MediaResult>}
 */
async function resolveMedia(block, contentType = 'story', ageBand = '6-8', region = 'ng', sceneHint = null) {
  const cacheKey = buildCacheKey(block, contentType, ageBand, sceneHint);

  // ── Step 1: Cache check ────────────────────────────────────────
  const cached = await getCached(cacheKey);
  if (cached) {
    logger.debug(`[Media] Cache hit: ${cacheKey}`);
    return { ...cached, fromCache: true };
  }

  // Use sceneHint for specific search, fallback to block topic
  const searchQuery = (sceneHint || block.topic || '').trim();
  if (!searchQuery || searchQuery === 'undefined') {
     logger.warn(`[Media] Invalid search query, skipping Wikimedia search.`);
     return null; 
  }

  // ── Step 2: Wikimedia Commons search ──
  // ONLY use Wikimedia for GENERAL topics. If we have a specific narrative sceneHint,
  // we SHOULD use DALL-E directly for better relevance.
  if (!sceneHint) {
    logger.info(`[Media] Searching Wikimedia Commons for: "${searchQuery}"`);

    const keyConcepts = Array.isArray(block.key_concepts)
      ? block.key_concepts
      : (block.key_concepts || '').split(',').map((k) => k.trim());

    const wikimediaImage = await findBestImage(
      searchQuery,
      ageBand,
      keyConcepts.slice(0, 2)
    );

    if (wikimediaImage) {
      logger.info(`[Media] ✓ Found Wikimedia image for "${searchQuery}"`);
      const result = {
        url: wikimediaImage.url,
        fullUrl: wikimediaImage.fullUrl,
        source: 'wikimedia',
        attribution: wikimediaImage.attribution,
        license: wikimediaImage.license,
        licenseUrl: wikimediaImage.licenseUrl,
        sourceUrl: wikimediaImage.sourceUrl,
        width: wikimediaImage.width,
        height: wikimediaImage.height,
        fromCache: false,
      };
      await setCache(cacheKey, result);
      return result;
    }
  }

  // ── Step 3: DALL-E fallback ────────────────────────────────────
  logger.info(`[Media] No Wikimedia result — generating with DALL-E for "${block.topic}"`);

  try {
    const generated = await generateBlockImage(block, contentType, ageBand, region, sceneHint);
    const result = {
      url: generated.url,
      source: 'dalle',
      attribution: generated.attribution,
      license: 'ai-generated',
      licenseUrl: null,
      sourceUrl: null,
      width: generated.width,
      height: generated.height,
      revisedPrompt: generated.revisedPrompt,
      fromCache: false,
    };
    await setCache(cacheKey, result);
    return result;
  } catch (err) {
    try {
      logger.info(`[Media] DALL-E generation failed. Attempting FREE dynamic fallback for "${sceneHint || block.topic}"...`);
      
      // Use LoremFlickr with a very high random lock to ensure variations
      const uniqueLock = Math.floor(Math.random() * 999999);
      const keywords = `${block.topic},${(sceneHint || '').split(' ').slice(0, 3).join(',')}`.replace(/\s+/g, '');
      const fallbackUrl = `https://loremflickr.com/1280/720/${keywords}?lock=${uniqueLock}`;

      return {
        url: fallbackUrl,
        source: 'dynamic-fallback',
        attribution: 'Dynamic Placeholder',
        license: 'free-to-use',
        fromCache: false,
      };
    } catch (fErr) {
      return {
        url: null,
        source: 'none',
        error: err.message,
        fromCache: false,
      };
    }
  }
}

/**
 * Resolve multiple images for a story (one per scene)
 *
 * @param {Object} block
 * @param {Array<string>} scenes   - array of scene hint strings
 * @param {string} ageBand
 * @param {string} region
 * @returns {Promise<Array<MediaResult>>}
 */
async function resolveStoryMedia(block, scenes = [], ageBand = '6-8', region = 'ng') {
  const results = [];

  for (const scene of scenes) {
    const media = await resolveMedia(block, 'story', ageBand, region, scene);
    results.push({ scene, media });
    // Small delay between generations
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

// ── Cache helpers ─────────────────────────────────────────────────
function buildCacheKey(block, contentType, ageBand, sceneHint = null) {
  // Use a hash-like string of the combined inputs to guarantee uniqueness
  // ALWAYS include the block topic and scene hint to prevent collisions
  const safeTopic = (block.topic || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
  const safeHint = (sceneHint || 'default').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 100);
  
  // Combine into a long unique string. Postgres handles long TEXT keys fine.
  return `${safeTopic}:${safeHint}:${contentType}:${ageBand}`;
}

async function getCached(cacheKey) {
  try {
    const result = await query(
      'SELECT * FROM media_cache WHERE cache_key = $1',
      [cacheKey]
    );
    return result.rows[0] || null;
  } catch {
    return null; // table may not exist yet
  }
}

async function setCache(cacheKey, data) {
  try {
    await query(`
      INSERT INTO media_cache (cache_key, source, url, attribution, license, source_url, width, height)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (cache_key) DO NOTHING
    `, [
      cacheKey, data.source, data.url, data.attribution,
      data.license, data.sourceUrl, data.width, data.height,
    ]);
  } catch {
    // Non-fatal — cache is best-effort
  }
}

module.exports = { resolveMedia, resolveStoryMedia };
