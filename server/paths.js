const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const paths = {
  WALLETS_SCAN_ETH: path.join(ROOT, 'wallets_scan_eth'),
  WALLETS_SCAN_BNB: path.join(ROOT, 'wallets_scan_bnb'),
  WALLETS_FAILED_ETH: path.join(ROOT, 'wallets_failed_eth'),
  WALLETS_FAILED_BNB: path.join(ROOT, 'wallets_failed_bnb'),
  WALLETS_SCANNED: path.join(ROOT, 'wallets_scanned'),
  LOG_DIR: path.join(ROOT, 'log'),
  LOG_ERROR_DIR: path.join(ROOT, 'log', 'error'),
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureWorkspace() {
  Object.values(paths).forEach(ensureDir);
}

module.exports = { paths, ensureDir, ensureWorkspace };
