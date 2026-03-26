-- Story Vista — PostgreSQL + pgvector schema
-- Run via: psql $DATABASE_URL -f src/storage/schema.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── KNOWLEDGE BLOCKS ──────────────────────────────────────────────
-- Stores structured knowledge extracted from ingested sources
CREATE TABLE IF NOT EXISTS knowledge_blocks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         TEXT,           -- NULL = Global/Verified, '...' = Private/User Content
  topic           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  subjects        TEXT[]          NOT NULL DEFAULT '{}',

  -- Age-differentiated explanations
  explanation_3_5  TEXT,
  explanation_6_8  TEXT,
  explanation_9_12 TEXT,

  -- Structured content (stored as JSONB for flexibility)
  facts           JSONB           NOT NULL DEFAULT '[]',
  key_concepts    TEXT[]          NOT NULL DEFAULT '{}',
  story_elements  JSONB           NOT NULL DEFAULT '{}',
  lesson_elements JSONB           NOT NULL DEFAULT '{}',

  -- Quality & safety
  quality_score   FLOAT           NOT NULL DEFAULT 0,
  schema_valid    BOOLEAN         NOT NULL DEFAULT FALSE,
  claude_reviewed BOOLEAN         NOT NULL DEFAULT FALSE,
  is_child_safe   BOOLEAN         NOT NULL DEFAULT TRUE,

  -- Source attribution (critical for trust layer)
  source_id       TEXT            NOT NULL,
  source_name     TEXT            NOT NULL,
  source_url      TEXT            NOT NULL,
  page_url        TEXT            NOT NULL,
  page_title      TEXT,
  crawled_at      TIMESTAMPTZ,
  structured_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── VECTOR EMBEDDINGS ─────────────────────────────────────────────
-- Separate table for embeddings (text-embedding-3-small = 1536 dims)
-- Using 768 for nomic-embed or 1536 for OpenAI
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  block_id        UUID NOT NULL REFERENCES knowledge_blocks(id) ON DELETE CASCADE,
  embedding       vector(1024),   -- Voyage AI voyage-3 (1024 dims)
  embed_model     TEXT NOT NULL DEFAULT 'voyage-3',
  age_band        TEXT,           -- NULL = general, '3-5'|'6-8'|'9-12' = age-specific
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CRAWL RUNS ────────────────────────────────────────────────────
-- Audit log of every ingestion run
CREATE TABLE IF NOT EXISTS crawl_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_ids      TEXT[]          NOT NULL,
  topic           TEXT,
  status          TEXT            NOT NULL DEFAULT 'pending',  -- pending|running|complete|failed
  pages_crawled   INT             NOT NULL DEFAULT 0,
  blocks_created  INT             NOT NULL DEFAULT 0,
  blocks_skipped  INT             NOT NULL DEFAULT 0,
  errors          JSONB           NOT NULL DEFAULT '[]',
  started_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  triggered_by    TEXT            NOT NULL DEFAULT 'system'   -- system|api|manual
);

-- ── INDEXES ───────────────────────────────────────────────────────
-- Fast topic search
CREATE INDEX IF NOT EXISTS idx_kb_topic ON knowledge_blocks USING GIN (to_tsvector('english', topic));
CREATE INDEX IF NOT EXISTS idx_kb_subjects ON knowledge_blocks USING GIN (subjects);
CREATE INDEX IF NOT EXISTS idx_kb_source ON knowledge_blocks (source_id);
CREATE INDEX IF NOT EXISTS idx_kb_quality ON knowledge_blocks (quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_kb_child_safe ON knowledge_blocks (is_child_safe);
CREATE INDEX IF NOT EXISTS idx_kb_created ON knowledge_blocks (created_at DESC);

-- Vector similarity search (HNSW for production speed)
CREATE INDEX IF NOT EXISTS idx_embed_hnsw
  ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_embed_block ON knowledge_embeddings (block_id);
CREATE INDEX IF NOT EXISTS idx_embed_age ON knowledge_embeddings (age_band);

-- ── UPDATED_AT TRIGGER ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kb_updated_at ON knowledge_blocks;
CREATE TRIGGER trg_kb_updated_at
  BEFORE UPDATE ON knowledge_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── GENERATED STORIES ──────────────────────────────────────────
-- Stores the final generated story objects (text + media pointers)
CREATE TABLE IF NOT EXISTS stories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic           TEXT NOT NULL,
  title           TEXT NOT NULL,
  age_band        TEXT NOT NULL,
  mode            TEXT NOT NULL, -- rag|generic
  content         JSONB NOT NULL, -- full story object
  has_images      BOOLEAN DEFAULT FALSE,
  has_audio       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── GENERATED LESSONS ──────────────────────────────────────────
-- Stores the final generated lesson objects
CREATE TABLE IF NOT EXISTS lessons (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic           TEXT NOT NULL,
  title           TEXT NOT NULL,
  age_band        TEXT NOT NULL,
  subject         TEXT,
  content         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stories_created ON stories (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_created ON lessons (created_at DESC);

-- ── USERS ───────────────────────────────────────────────────────
-- Stores user accounts for personalized libraries and admin roles
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user', -- user|admin
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Separate stories by user
ALTER TABLE stories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories (user_id);
