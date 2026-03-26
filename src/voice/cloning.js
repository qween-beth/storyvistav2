'use strict';

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { query } = require('../storage/db');
const logger = require('../utils/logger');

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

function getHeaders() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set');
  return { 'xi-api-key': process.env.ELEVENLABS_API_KEY };
}

// ── Clone a voice from audio samples ────────────────────────────
/**
 * Creates an ElevenLabs Instant Voice Clone from uploaded audio files.
 * Requires at least 1 sample, works best with 2-5 minutes of clear speech.
 *
 * @param {Object} opts
 * @param {string}   opts.name          - display name e.g. "Mum's voice"
 * @param {string[]} opts.samplePaths   - local file paths to audio samples (.mp3/.wav)
 * @param {string}   opts.description   - optional description
 * @param {string}   opts.userId        - story vista user ID
 * @param {string}   opts.voiceType     - 'parent' | 'teacher'
 * @returns {Promise<ClonedVoice>}
 */
async function cloneVoice({ name, samplePaths, description = '', userId, voiceType = 'parent' }) {
  if (!samplePaths?.length) throw new Error('At least one audio sample is required');

  logger.info(`[VoiceClone] Cloning voice "${name}" for user ${userId}`);

  const form = new FormData();
  form.append('name', name);
  form.append('description', description || `${voiceType} voice for Story Vista`);

  // Attach audio samples
  for (const filePath of samplePaths) {
    if (!fs.existsSync(filePath)) throw new Error(`Sample file not found: ${filePath}`);
    form.append('files', fs.createReadStream(filePath), {
      filename: filePath.split('/').pop(),
      contentType: 'audio/mpeg',
    });
  }

  const response = await axios.post(
    `${ELEVENLABS_API}/voices/add`,
    form,
    {
      headers: { ...getHeaders(), ...form.getHeaders() },
      timeout: 120000,
      maxBodyLength: Infinity,
    }
  );

  const voiceId = response.data?.voice_id;
  if (!voiceId) throw new Error('ElevenLabs did not return a voice_id');

  // Save to DB
  await saveClonedVoice({
    userId,
    voiceId,
    name,
    description,
    voiceType,
    sampleCount: samplePaths.length,
  });

  logger.info(`[VoiceClone] ✓ Voice cloned: ${voiceId} — "${name}"`);

  return { voiceId, name, voiceType, userId };
}

// ── Delete a cloned voice ────────────────────────────────────────
async function deleteClonedVoice(voiceId, userId) {
  // Verify ownership
  const result = await query(
    'SELECT id FROM cloned_voices WHERE voice_id = $1 AND user_id = $2',
    [voiceId, userId]
  );
  if (!result.rows.length) throw new Error('Voice not found or not owned by this user');

  // Delete from ElevenLabs
  await axios.delete(`${ELEVENLABS_API}/voices/${voiceId}`, {
    headers: getHeaders(),
    timeout: 15000,
  });

  // Remove from DB
  await query('DELETE FROM cloned_voices WHERE voice_id = $1', [voiceId]);
  logger.info(`[VoiceClone] Deleted voice ${voiceId}`);
}

// ── Get all cloned voices for a user ────────────────────────────
async function getUserVoices(userId) {
  const result = await query(
    `SELECT voice_id, name, voice_type, sample_count, created_at
     FROM cloned_voices WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// ── Get a user's default voice for a content type ───────────────
async function getDefaultVoice(userId, voiceType = 'parent') {
  const result = await query(
    `SELECT voice_id FROM cloned_voices
     WHERE user_id = $1 AND voice_type = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, voiceType]
  );
  return result.rows[0]?.voice_id || null;
}

// ── Storage helpers ──────────────────────────────────────────────
async function saveClonedVoice({ userId, voiceId, name, description, voiceType, sampleCount }) {
  await query(
    `INSERT INTO cloned_voices (user_id, voice_id, name, description, voice_type, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (voice_id) DO UPDATE SET name=$3, updated_at=NOW()`,
    [userId, voiceId, name, description, voiceType, sampleCount]
  );
}

module.exports = { cloneVoice, deleteClonedVoice, getUserVoices, getDefaultVoice };
