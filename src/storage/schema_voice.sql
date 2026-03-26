-- Cloned voices table
CREATE TABLE IF NOT EXISTS cloned_voices (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      TEXT NOT NULL,
  voice_id     TEXT UNIQUE NOT NULL,  -- ElevenLabs voice ID
  name         TEXT NOT NULL,
  description  TEXT,
  voice_type   TEXT NOT NULL DEFAULT 'parent',  -- 'parent' | 'teacher'
  sample_count INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloned_user ON cloned_voices (user_id);
CREATE INDEX IF NOT EXISTS idx_cloned_type ON cloned_voices (voice_type);
