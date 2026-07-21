const fs = require('fs');
const path = require('path');
const { paths, ensureDir } = require('../paths');
const { WALLETS_PER_FILE } = require('../constants');

const FAILED_DIRS = {
  eth: paths.WALLETS_FAILED_ETH,
  bnb: paths.WALLETS_FAILED_BNB,
};

function listFailedBatchFiles(network) {
  const dir = FAILED_DIRS[network];
  if (!dir || !fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.txt'))
    .sort();
}

function getRetryStatsForNetwork(network) {
  const files = listFailedBatchFiles(network);

  return {
    failedBatches: files.length,
    failedWallets: files.length * WALLETS_PER_FILE,
    canRetry: files.length > 0,
    failedDir: FAILED_DIRS[network],
  };
}

function getRetryStats() {
  return {
    eth: getRetryStatsForNetwork('eth'),
    bnb: getRetryStatsForNetwork('bnb'),
  };
}

function ensureFailedDirs() {
  ensureDir(paths.WALLETS_FAILED_ETH);
  ensureDir(paths.WALLETS_FAILED_BNB);
}

module.exports = {
  getRetryStats,
  getRetryStatsForNetwork,
  listFailedBatchFiles,
  ensureFailedDirs,
  FAILED_DIRS,
};
