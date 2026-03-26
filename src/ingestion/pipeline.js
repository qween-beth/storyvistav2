'use strict';

require('dotenv').config();

const { getSources } = require('./sources');
const { crawlSources, filterPages } = require('./crawler');
const { structurePages } = require('./structurer');
const { saveBlock, createCrawlRun, completeCrawlRun, failCrawlRun, updateCrawlRun } = require('../storage/knowledge');
const logger = require('../utils/logger');

/**
 * Run the full ingestion pipeline for a set of sources.
 *
 * @param {Object} opts
 * @param {string[]} [opts.sourceIds]  - specific source IDs (default: all)
 * @param {string}   [opts.topic]      - optional topic focus
 * @param {string[]} [opts.subjects]   - filter sources by subject
 * @param {string}   [opts.region]     - filter sources by region ('global'|'ng'|'all')
 * @param {string}   [opts.triggeredBy] - 'system'|'api'|'manual'
 * @returns {Promise<Object>} run summary
 */
async function runIngestion(opts = {}) {
  const {
    sourceIds,
    topic,
    subjects,
    region = 'all',
    triggeredBy = 'system',
  } = opts;

  // ── 1. Resolve sources ────────────────────────────────────────
  let sources;
  if (sourceIds?.length) {
    const { getSourceById } = require('./sources');
    sources = sourceIds.map(getSourceById).filter(Boolean);
  } else {
    sources = getSources({ subjects, region });
  }

  if (sources.length === 0) {
    logger.warn('[Pipeline] No sources matched the given filters');
    return { status: 'skipped', reason: 'no_sources' };
  }

  logger.info(`[Pipeline] Starting ingestion: ${sources.length} sources, topic="${topic || 'all'}"`);

  // ── 2. Create audit run ───────────────────────────────────────
  const runId = await createCrawlRun({
    sourceIds: sources.map((s) => s.id),
    topic,
    triggeredBy,
  });

  await updateCrawlRun(runId, { status: 'running' });

  const errors = [];
  let blocksCreated = 0;
  let blocksSkipped = 0;

  try {
    // ── 3. Crawl ────────────────────────────────────────────────
    logger.info('[Pipeline] Phase 1: Crawling sources...');
    const rawPages = await crawlSources(sources, topic);

    await updateCrawlRun(runId, { pages_crawled: rawPages.length });
    logger.info(`[Pipeline] Crawled ${rawPages.length} raw pages`);

    // ── 4. Filter ───────────────────────────────────────────────
    const filteredPages = filterPages(rawPages, 300);
    blocksSkipped += rawPages.length - filteredPages.length;
    logger.info(`[Pipeline] Filtered to ${filteredPages.length} pages (${blocksSkipped} too short)`);

    // ── 5. Structure ─────────────────────────────────────────────
    logger.info('[Pipeline] Phase 2: Structuring with Groq + Claude...');
    const blocks = await structurePages(filteredPages, {
      reviewThreshold: 0.6,
    });

    blocksSkipped += filteredPages.length - blocks.length;
    logger.info(`[Pipeline] Structured ${blocks.length} knowledge blocks`);

    // ── 6. Persist ───────────────────────────────────────────────
    logger.info('[Pipeline] Phase 3: Saving to database...');
    for (const block of blocks) {
      try {
        await saveBlock(block);
        blocksCreated++;
      } catch (err) {
        logger.error(`[Pipeline] Failed to save block "${block.topic}": ${err.message}`);
        errors.push({ topic: block.topic, error: err.message });
        blocksSkipped++;
      }
    }

    // ── 7. Complete ──────────────────────────────────────────────
    await completeCrawlRun(runId, { blocksCreated, blocksSkipped, errors });

    const summary = {
      runId,
      status: 'complete',
      sources: sources.length,
      pagesCrawled: rawPages.length,
      blocksCreated,
      blocksSkipped,
      errors: errors.length,
    };

    logger.info('[Pipeline] ✓ Ingestion complete', summary);
    return summary;

  } catch (err) {
    logger.error(`[Pipeline] Fatal error: ${err.message}`);
    await failCrawlRun(runId, err.message);
    throw err;
  }
}

// ── Run directly (npm run ingest) ─────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const topic = args.find((a) => a.startsWith('--topic='))?.split('=')[1];
  const region = args.find((a) => a.startsWith('--region='))?.split('=')[1] || 'all';
  const sources = args.find((a) => a.startsWith('--sources='))?.split('=')[1]?.split(',');

  runIngestion({ topic, region, sourceIds: sources, triggeredBy: 'manual' })
    .then((summary) => {
      console.log('\n[Pipeline] Run summary:', JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[Pipeline] Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { runIngestion };
