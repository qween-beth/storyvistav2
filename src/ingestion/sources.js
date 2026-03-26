'use strict';

/**
 * CURATED SOURCE LIST
 * ─────────────────────────────────────────────────────────────────
 * Story Vista only ingests from pre-approved, trusted sources.
 * This is the quality gate — never crawl the open web.
 *
 * Each source has:
 *   - url:         seed URL for Firecrawl
 *   - name:        human-readable name (used in attributions)
 *   - ageBands:    which age groups this source suits
 *   - subjects:    content categories it covers
 *   - trust:       'high' | 'medium' (affects confidence scoring)
 *   - region:      'global' | 'ng' | etc (for localisation filtering)
 *   - crawlOpts:   Firecrawl-specific overrides for this source
 */
const SOURCES = [
  // ── GLOBAL ────────────────────────────────────────────────────
  {
    id: 'natgeo-kids',
    name: 'National Geographic Kids',
    url: 'https://kids.nationalgeographic.com',
    subjects: ['animals', 'science', 'geography', 'environment'],
    ageBands: ['6-8', '9-12'],
    trust: 'high',
    region: 'global',
    crawlOpts: { maxPages: 20, includePaths: ['/animals/*', '/science/*', '/explore/*'] },
  },
  {
    id: 'bbc-bitesize',
    name: 'BBC Bitesize',
    url: 'https://www.bbc.co.uk/bitesize',
    subjects: ['science', 'maths', 'english', 'history', 'geography'],
    ageBands: ['6-8', '9-12'],
    trust: 'high',
    region: 'global',
    crawlOpts: { maxPages: 30, includePaths: ['/topics/*'] },
  },
  {
    id: 'nasa-kids',
    name: 'NASA Space Place',
    url: 'https://spaceplace.nasa.gov',
    subjects: ['space', 'science', 'technology'],
    ageBands: ['6-8', '9-12'],
    trust: 'high',
    region: 'global',
    crawlOpts: { maxPages: 20 },
  },
  {
    id: 'britannica-kids',
    name: 'Britannica Kids',
    url: 'https://kids.britannica.com',
    subjects: ['history', 'science', 'geography', 'animals', 'culture'],
    ageBands: ['6-8', '9-12'],
    trust: 'high',
    region: 'global',
    crawlOpts: { maxPages: 25 },
  },
  {
    id: 'wikipedia-simple',
    name: 'Wikipedia Simple English',
    url: 'https://simple.wikipedia.org',
    subjects: ['general', 'science', 'history', 'geography', 'culture'],
    ageBands: ['6-8', '9-12'],
    trust: 'medium',
    region: 'global',
    crawlOpts: { maxPages: 40 },
  },
  {
    id: 'khan-academy',
    name: 'Khan Academy',
    url: 'https://www.khanacademy.org',
    subjects: ['maths', 'science', 'computing', 'history'],
    ageBands: ['6-8', '9-12'],
    trust: 'high',
    region: 'global',
    crawlOpts: { maxPages: 20, includePaths: ['/math/*', '/science/*', '/computing/*'] },
  },
  {
    id: 'dkfindout',
    name: 'DK Find Out',
    url: 'https://www.dkfindout.com/us',
    subjects: ['animals', 'science', 'history', 'geography', 'technology'],
    ageBands: ['3-5', '6-8'],
    trust: 'high',
    region: 'global',
    crawlOpts: { maxPages: 20 },
  },

  // ── NIGERIA / WEST AFRICA ──────────────────────────────────────
  {
    id: 'nerdc',
    name: 'NERDC Nigeria',
    url: 'https://nerdc.gov.ng',
    subjects: ['curriculum', 'education', 'general'],
    ageBands: ['6-8', '9-12'],
    trust: 'high',
    region: 'ng',
    crawlOpts: { maxPages: 15 },
  },
];

/**
 * Get sources filtered by options
 * @param {Object} opts
 * @param {string[]} [opts.subjects]  - filter by subject
 * @param {string[]} [opts.ageBands] - filter by age band
 * @param {string}   [opts.region]   - 'global' | 'ng' | 'all'
 * @param {string}   [opts.trust]    - 'high' | 'medium' | 'all'
 * @returns {Array}
 */
function getSources({ subjects, ageBands, region = 'all', trust = 'all' } = {}) {
  return SOURCES.filter((src) => {
    if (trust !== 'all' && src.trust !== trust) return false;
    if (region !== 'all' && src.region !== 'global' && src.region !== region) return false;
    if (subjects && !subjects.some((s) => src.subjects.includes(s))) return false;
    if (ageBands && !ageBands.some((a) => src.ageBands.includes(a))) return false;
    return true;
  });
}

function getSourceById(id) {
  return SOURCES.find((s) => s.id === id) || null;
}

module.exports = { SOURCES, getSources, getSourceById };
