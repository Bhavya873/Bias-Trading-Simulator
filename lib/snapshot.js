'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Write a JSON snapshot on every round end. Failures are logged, not thrown. */
function writeSnapshot(state) {
  try {
    ensureDataDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(DATA_DIR, `game-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    return file;
  } catch (err) {
    console.error('snapshot write failed:', err.message || err);
    return null;
  }
}

module.exports = { writeSnapshot, DATA_DIR };
