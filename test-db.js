require('dotenv').config();
const { healthCheck } = require('./src/storage/db');

async function test() {
  console.log('Testing DB connection...');
  const ok = await healthCheck();
  if (ok) {
    console.log('DB CONNECTION OK');
  } else {
    console.error('DB CONNECTION FAILED');
    process.exit(1);
  }
}

test();
