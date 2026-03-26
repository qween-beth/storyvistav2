'use strict';

const { Pool } = require('pg');
const logger = require('../utils/logger');

let _pool = null;

function getPool() {
  if (!_pool) {
    const useSsl = process.env.DATABASE_URL?.includes('supabase') || 
                   process.env.DATABASE_URL?.includes('render') ||
                   process.env.DB_SSL === 'true';

    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    });

    _pool.on('error', (err) => {
      logger.error('[DB] Unexpected pool error:', err.message);
    });

    _pool.on('connect', () => {
      logger.debug('[DB] New client connected');
    });
  }
  return _pool;
}

async function query(sql, params = []) {
  const pool = getPool();
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    logger.debug(`[DB] Query completed in ${Date.now() - start}ms`);
    return result;
  } catch (err) {
    logger.error(`[DB] Query error: ${err.message || err.code || 'Unknown Error'}`);
    if (err.detail) logger.error(`[DB] Detail: ${err.detail}`);
    if (err.hint) logger.error(`[DB] Hint: ${err.hint}`);
    if (err.where) logger.error(`[DB] Where: ${err.where}`);
    throw err;
  }
}

async function transaction(fn) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function close() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    logger.info('[DB] Pool closed');
  }
}

module.exports = { query, transaction, healthCheck, close, getPool };
