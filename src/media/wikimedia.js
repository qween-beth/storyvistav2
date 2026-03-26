'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

// Licences we accept — CC and Public Domain only
const ALLOWED_LICENSES = [
  'cc-by', 'cc-by-sa', 'cc-zero', 'pd', 'public domain',
  'cc-by-2.0', 'cc-by-3.0', 'cc-by-4.0',
  'cc-by-sa-2.0', 'cc-by-sa-3.0', 'cc-by-sa-4.0',
];

/**
 * Search Wikimedia Commons for images matching a query
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number} opts.limit       - max results (default 5)
 * @param {string} opts.imageType   - 'photo' | 'diagram' | 'any'
 * @returns {Promise<Array<WikimediaImage>>}
 */
async function searchImages(query, opts = {}) {
  const { limit = 5 } = opts;

  logger.debug(`[Wikimedia] Searching images: "${query}"`);

  try {
    const response = await axios.get(WIKIMEDIA_API, {
      params: {
        action: 'query',
        list: 'search',
        srsearch: `${query} filetype:bitmap`,
        srnamespace: 6,   // File namespace
        srlimit: limit * 2, // fetch extra to filter down
        srprop: 'snippet|titlesnippet',
        format: 'json',
        origin: '*',
      },
      timeout: 8000,
    });

    const files = response.data?.query?.search || [];
    if (files.length === 0) return [];

    // Fetch full metadata for each file
    const titles = files.map((f) => f.title).join('|');
    const details = await getImageDetails(titles);

    return details.filter(isAcceptableImage).slice(0, limit);
  } catch (err) {
    logger.warn(`[Wikimedia] Search failed for "${query}": ${err.message}`);
    return [];
  }
}

// ── Get full image metadata including license ─────────────────────
async function getImageDetails(titles) {
  const response = await axios.get(WIKIMEDIA_API, {
    params: {
      action: 'query',
      titles,
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|size|mime',
      iiurlwidth: 800,    // request 800px wide thumbnail
      format: 'json',
      origin: '*',
    },
    timeout: 8000,
  });

  const pages = Object.values(response.data?.query?.pages || {});

  return pages.map((page) => {
    const info = page.imageinfo?.[0];
    if (!info) return null;

    const meta = info.extmetadata || {};

    return {
      title: page.title?.replace('File:', '') || '',
      url: info.thumburl || info.url,
      fullUrl: info.url,
      width: info.thumbwidth || info.width,
      height: info.thumbheight || info.height,
      mimeType: info.mime,
      license: meta.LicenseShortName?.value || meta.License?.value || 'unknown',
      licenseUrl: meta.LicenseUrl?.value || null,
      attribution: buildAttribution(meta, page.title),
      artist: meta.Artist?.value?.replace(/<[^>]*>/g, '') || null,
      description: meta.ImageDescription?.value?.replace(/<[^>]*>/g, '') || null,
      source: 'wikimedia',
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    };
  }).filter(Boolean);
}

// ── Build clean attribution string ───────────────────────────────
function buildAttribution(meta, title) {
  const artist = meta.Artist?.value?.replace(/<[^>]*>/g, '') || 'Unknown';
  const license = meta.LicenseShortName?.value || 'CC';
  const filename = title?.replace('File:', '') || '';
  return `"${filename}" by ${artist}, licensed under ${license} via Wikimedia Commons`;
}

// ── Filter — only accept safe, correctly licensed images ──────────
function isAcceptableImage(img) {
  if (!img) return false;

  // Must have a URL
  if (!img.url) return false;

  // Must be an image type
  if (!img.mimeType?.startsWith('image/')) return false;

  // Must be an allowed license
  const license = (img.license || '').toLowerCase();
  const isAllowed = ALLOWED_LICENSES.some((l) => license.includes(l));
  if (!isAllowed) {
    logger.debug(`[Wikimedia] Skipping image with license: ${img.license}`);
    return false;
  }

  // Skip SVG (rendering inconsistency) and tiny images
  if (img.mimeType === 'image/svg+xml') return false;
  if (img.width && img.width < 200) return false;

  return true;
}

/**
 * Find the best image for a given topic + age band
 * Returns null if nothing suitable found (triggers AI generation)
 *
 * @param {string} topic
 * @param {string} ageBand  - '3-5' | '6-8' | '9-12'
 * @param {string[]} keywords  - extra search terms
 * @returns {Promise<WikimediaImage|null>}
 */
async function findBestImage(topic, ageBand = '6-8', keywords = []) {
  // Build a targeted query
  const query = [topic, ...keywords].join(' ');

  const images = await searchImages(query, { limit: 8 });

  if (images.length === 0) {
    // Try a broader search
    const broadImages = await searchImages(topic, { limit: 5 });
    if (broadImages.length === 0) return null;
    return broadImages[0];
  }

  // Prefer landscape images for stories, square for lessons
  const landscape = images.find((img) => img.width > img.height);
  return landscape || images[0];
}

module.exports = { searchImages, findBestImage, getImageDetails };
