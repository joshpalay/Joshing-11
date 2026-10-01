// Where a QA run keeps its browser profiles, screenshots and logs. Outside the
// repo on purpose: profiles hold live session cookies for the test accounts.
// Override with QA_DIR (e.g. the session scratchpad).
const os = require('os');
const path = require('path');
const fs = require('fs');

const QA_DIR = process.env.QA_DIR || path.join(os.tmpdir(), 'joshing-qa');
fs.mkdirSync(path.join(QA_DIR, 'shots'), { recursive: true });

module.exports = {
  QA_DIR,
  BASE: process.env.QA_BASE || 'https://joshing-11.vercel.app',
  PORTS: { A: 9401, B: 9402, C: 9403 },
  et: () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }),
};
