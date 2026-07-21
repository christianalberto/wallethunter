const fs = require('fs');
const path = require('path');
const Web3 = require('web3');
const { paths, ensureDir } = require('../paths');
const { getRpcUrls } = require('./rpc-config');

const STATUS_FILE = path.join(paths.LOG_DIR, 'rpc-status.json');
const rotators = {};

function getRpcLists() {
  return {
    eth: getRpcUrls('eth'),
    bnb: getRpcUrls('bnb'),
  };
}

function readRpcStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    return { eth: null, bnb: null };
  }

  try {
    const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    return {
      eth: data.eth ?? null,
      bnb: data.bnb ?? null,
    };
  } catch {
    return { eth: null, bnb: null };
  }
}

function updateRpcStatus(network, patch) {
  ensureDir(paths.LOG_DIR);
  const all = readRpcStatus();
  all[network] = {
    ...(all[network] || {}),
    ...patch,
    network,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify(all)}\n`, 'utf8');
  return all[network];
}

function initRpcStatus(network) {
  const urls = getRpcUrls(network);
  return updateRpcStatus(network, {
    currentRpc: urls[0] || null,
    currentIndex: 0,
    totalRpcs: urls.length,
    status: urls.length ? 'ready' : 'error',
    lastError: urls.length ? null : 'No RPC configured',
    scanning: true,
  });
}

function clearRpcScanning(network) {
  const current = readRpcStatus()[network];
  if (!current) return;
  updateRpcStatus(network, {
    ...current,
    scanning: false,
    status: current.status === 'connected' ? 'idle' : current.status,
  });
}

function formatRpcLabel(url, index, total) {
  return `${url} (${index + 1}/${total})`;
}

function resetRotators() {
  for (const key of Object.keys(rotators)) {
    delete rotators[key];
  }
}

function createRotator(network) {
  const urls = getRpcUrls(network);
  let currentIndex = 0;

  return {
    urls,
    getCurrentIndex: () => currentIndex,
    getCurrentUrl: () => urls[currentIndex],

    markScanStart() {
      initRpcStatus(network);
    },

    markScanEnd() {
      clearRpcScanning(network);
    },

    async call(fn) {
      if (!urls.length) {
        throw new Error('No RPC configured');
      }

      let lastError = null;

      for (let attempt = 0; attempt < urls.length; attempt += 1) {
        const index = (currentIndex + attempt) % urls.length;
        const url = urls[index];
        const web3 = new Web3(new Web3.providers.HttpProvider(url));

        try {
          const result = await fn(web3, url, index);
          currentIndex = index;
          updateRpcStatus(network, {
            currentRpc: url,
            currentIndex: index,
            totalRpcs: urls.length,
            status: 'connected',
            lastError: null,
            scanning: true,
          });
          return result;
        } catch (error) {
          lastError = error;
          console.error(
            `[${network.toUpperCase()} RPC] ${index + 1}/${urls.length} failed — ${error.message}`
          );
          updateRpcStatus(network, {
            currentRpc: url,
            currentIndex: index,
            totalRpcs: urls.length,
            status: 'error',
            lastError: error.message,
            scanning: true,
          });
        }
      }

      throw lastError || new Error('All RPC endpoints failed');
    },
  };
}

function getRotator(network) {
  if (!rotators[network]) {
    rotators[network] = createRotator(network);
  }
  return rotators[network];
}

module.exports = {
  getRpcLists,
  readRpcStatus,
  updateRpcStatus,
  initRpcStatus,
  clearRpcScanning,
  getRotator,
  resetRotators,
  formatRpcLabel,
  STATUS_FILE,
};
