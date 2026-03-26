'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, close } = require('./db');

async function migrate() {
  const argFile = process.argv[2];
  const schemaPath = argFile ? path.resolve(argFile) : path.join(__dirname, 'schema.sql');
  
  console.log(`[Migrate] Running schema migration for: ${path.basename(schemaPath)}...`);
  
  if (!fs.existsSync(schemaPath)) {
    console.error(`[Migrate] ✗ Schema file not found: ${schemaPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  try {
    await query(sql);
    console.log(`[Migrate] ✓ Schema ${path.basename(schemaPath)} applied successfully`);
  } catch (err) {
    console.error(`[Migrate] ✗ Migration failed for ${path.basename(schemaPath)}:`, err.message);
    process.exit(1);
  } finally {
    await close();
  }
}

migrate();
