const fs = require('fs');
const path = require('path');
const { paths, ensureDir } = require('../paths');

const FINDINGS_FILE = path.join(paths.LOG_DIR, 'findings.jsonl');

function ensureFindingsFile() {
  ensureDir(paths.LOG_DIR);
  if (!fs.existsSync(FINDINGS_FILE)) {
    fs.writeFileSync(FINDINGS_FILE, '', 'utf8');
  }
}

function recordFinding(finding) {
  ensureFindingsFile();

  const entry = {
    timestamp: new Date().toISOString(),
    network: finding.network,
    address: finding.address,
    privateKey: finding.privateKey,
    balance: String(finding.balance),
    balanceFormatted: finding.balanceFormatted,
    file: finding.file || null,
  };

  fs.appendFileSync(FINDINGS_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

function readFindings(limit) {
  ensureFindingsFile();

  const content = fs.readFileSync(FINDINGS_FILE, 'utf8').trim();
  if (!content) return [];

  const lines = content.split('\n').filter(Boolean);
  const parsed = [];

  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  parsed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (typeof limit === 'number' && limit > 0) {
    return parsed.slice(0, limit);
  }

  return parsed;
}

module.exports = { recordFinding, readFindings, FINDINGS_FILE };
