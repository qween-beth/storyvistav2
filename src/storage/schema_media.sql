-- Media cache table (append to schema.sql or run separately)
CREATE TABLE IF NOT EXISTS media_cache (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key   TEXT UNIQUE NOT NULL,
  source      TEXT NOT NULL,   -- 'wikimedia' | 'dalle' | 'none'
  url         TEXT,
  attribution TEXT,
  license     TEXT,
  source_url  TEXT,
  width       INT,
  height      INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_cache_key ON media_cache (cache_key);
CREATE INDEX IF NOT EXISTS idx_media_source ON media_cache (source);
