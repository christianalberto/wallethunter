const fs = require('fs');
const path = require('path');
const { paths, ensureDir } = require('../paths');

const PROGRESS_FILE = path.join(paths.LOG_DIR, 'scan-progress.json');

function readProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return { eth: null, bnb: null };
  }

  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return {
      eth: data.eth ?? null,
      bnb: data.bnb ?? null,
    };
  } catch {
    return { eth: null, bnb: null };
  }
}

function updateProgress(network, data) {
  ensureDir(paths.LOG_DIR);
  const all = readProgress();
  all[network] = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PROGRESS_FILE, `${JSON.stringify(all)}\n`, 'utf8');
}

function clearProgress(network) {
  ensureDir(paths.LOG_DIR);
  const all = readProgress();
  all[network] = null;
  fs.writeFileSync(PROGRESS_FILE, `${JSON.stringify(all)}\n`, 'utf8');
}

module.exports = { readProgress, updateProgress, clearProgress, PROGRESS_FILE };
