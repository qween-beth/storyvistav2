'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, close } = require('../storage/db');

const email = process.argv[2] || 'admin@storyvista.com';
const password = process.argv[3] || 'admin123';

async function seed() {
  console.log(`[Seed] Creating admin user: ${email}...`);
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await query(
      `INSERT INTO users (email, password_hash, role) 
       VALUES ($1, $2, 'admin') 
       ON CONFLICT (email) DO UPDATE SET role = 'admin'`,
      [email, passwordHash]
    );
    console.log(`[Seed] ✓ Admin user created successfully.`);
    console.log(`[Seed] Email: ${email}`);
    console.log(`[Seed] Password: ${password}`);
  } catch (err) {
    console.error(`[Seed] Failed:`, err.message);
  } finally {
    await close();
  }
}

seed();
