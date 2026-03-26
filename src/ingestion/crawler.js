'use strict';

const FirecrawlApp = require('@mendable/firecrawl-js').default;
const pLimit = require('p-limit');
const axios = require('axios');
const logger = require('../utils/logger');

const crawlLimit = pLimit(parseInt(process.env.CRAWL_CONCURRENCY || '3', 10));

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not set');
    _client = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
  }
  return _client;
}

/**
 * Crawl a single source and return an array of raw page objects.
 *
 * @param {Object} source  - from sources.js
 * @param {string} [topic] - optional topic hint (used as search context)
 * @returns {Promise<Array<RawPage>>}
 */
async function crawlSource(source, topic = null) {
  const client = getClient();
  const maxPages = source.crawlOpts?.maxPages || parseInt(process.env.CRAWL_MAX_PAGES || '20', 10);

  const crawlParams = {
    limit: maxPages,
    scrapeOptions: {
      formats: ['markdown', 'links'],
      onlyMainContent: true,         // strips nav / ads / footers
      removeBase64Images: true,
    },
  };

  // Add include path patterns if defined
  if (source.crawlOpts?.includePaths?.length) {
    crawlParams.includePaths = source.crawlOpts.includePaths;
  }

  logger.info(`[Crawler] Starting crawl → ${source.name} (${source.url})`, {
    sourceId: source.id,
    maxPages,
    topic,
  });

  try {
    const result = await client.crawlUrl(source.url, crawlParams);

    if (!result.success) {
      throw new Error(`Firecrawl returned failure for ${source.id}: ${result.error || 'unknown'}`);
    }

    const pages = (result.data || []).map((page) => ({
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      pageUrl: page.metadata?.url || page.url,
      title: page.metadata?.title || '',
      description: page.metadata?.description || '',
      content: page.markdown || '',
      links: page.links || [],
      crawledAt: new Date().toISOString(),
      topic: topic || null,
    }));

    logger.info(`[Crawler] Completed → ${source.name}: ${pages.length} pages`, { sourceId: source.id });
    return pages;
  } catch (err) {
    if (err.message.includes('402') || err.message.includes('credits')) {
      logger.warn(`[Crawler] Firecrawl credits exhausted. Attempting FREE fallback for ${source.id}...`);
      try {
        const fallbackPage = await scrapeFallback(source.url, source);
        return [fallbackPage];
      } catch (fErr) {
        logger.error(`[Crawler] Fallback also failed: ${fErr.message}`);
      }
    }
    logger.error(`[Crawler] Failed → ${source.name}: ${err.message}`, { sourceId: source.id });
    throw err;
  }
}

/**
 * Free fallback using Axios + basic HTML stripping
 */
async function scrapeFallback(url, sourceMeta = {}) {
  const { data } = await axios.get(url, { 
    headers: { 'User-Agent': 'Mozilla/5.0 (StoryVista/1.0)' },
    timeout: 10000 
  });
  
  // Very basic HTML -> Text extraction
  const cleanContent = data
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    sourceId: sourceMeta.id || 'manual',
    sourceName: sourceMeta.name || 'Manual',
    sourceUrl: url,
    pageUrl: url,
    title: sourceMeta.name || 'Failsafe Scrape',
    description: 'Extracted via failsafe fallback',
    content: cleanContent,
    links: [],
    crawledAt: new Date().toISOString(),
    topic: null,
  };
}

/**
 * Crawl a specific URL (for on-demand topic ingestion)
 * Uses Firecrawl's scrape (single page) instead of crawl
 *
 * @param {string} url
 * @param {Object} sourceMeta - { sourceId, sourceName }
 * @returns {Promise<RawPage>}
 */
async function scrapePage(url, sourceMeta = {}) {
  const client = getClient();

  logger.info(`[Crawler] Scraping page → ${url}`);

  const result = await client.scrapeUrl(url, {
    formats: ['markdown'],
    onlyMainContent: true,
    removeBase64Images: true,
  });

  if (!result.success) {
    throw new Error(`Firecrawl scrape failed for ${url}: ${result.error || 'unknown'}`);
  }

  return {
    sourceId: sourceMeta.sourceId || 'manual',
    sourceName: sourceMeta.sourceName || 'Manual',
    sourceUrl: url,
    pageUrl: url,
    title: result.metadata?.title || '',
    description: result.metadata?.description || '',
    content: result.markdown || '',
    links: [],
    crawledAt: new Date().toISOString(),
    topic: null,
  };
}

/**
 * Crawl multiple sources concurrently (respects CRAWL_CONCURRENCY)
 *
 * @param {Array} sources
 * @param {string} [topic]
 * @returns {Promise<Array<RawPage>>}
 */
async function crawlSources(sources, topic = null) {
  const tasks = sources.map((src) =>
    crawlLimit(() => crawlSource(src, topic).catch((err) => {
      logger.warn(`[Crawler] Skipping ${src.id} after error: ${err.message}`);
      return []; // Don't let one bad source kill the whole run
    }))
  );

  const results = await Promise.all(tasks);
  return results.flat();
}

/**
 * Filter out pages with too little content to be useful
 * @param {Array<RawPage>} pages
 * @param {number} minChars
 * @returns {Array<RawPage>}
 */
function filterPages(pages, minChars = 300) {
  return pages.filter((p) => {
    if (!p.content || p.content.trim().length < minChars) return false;
    return true;
  });
}

module.exports = { crawlSource, crawlSources, scrapePage, filterPages };
