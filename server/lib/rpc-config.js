const fs = require('fs');
const path = require('path');

const RPC_CONFIG_PATH = path.join(__dirname, '..', '..', 'rpc-config.json');
const RPC_DEFAULTS_PATH = path.join(__dirname, '..', 'config', 'rpc-defaults.json');

const BUILTIN_DEFAULTS = {
  eth: [
    'https://eth.llamarpc.com',
    'https://cloudflare-eth.com/',
    'https://ethereum.publicnode.com',
    'https://eth-mainnet.public.blastapi.io',
    'https://rpc.ankr.com/eth',
  ],
  bnb: [
    'https://bsc-dataseed.bnbchain.org',
    'https://bsc-dataseed.nariox.org',
    'https://bsc-dataseed.defibit.io',
    'https://bsc-dataseed.ninicoin.io',
    'https://bsc-dataseed-public.bnbchain.org',
  ],
};

function loadDefaults() {
  if (!fs.existsSync(RPC_DEFAULTS_PATH)) {
    return BUILTIN_DEFAULTS;
  }

  try {
    return JSON.parse(fs.readFileSync(RPC_DEFAULTS_PATH, 'utf8'));
  } catch {
    return BUILTIN_DEFAULTS;
  }
}

function normalizeUrlList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function validateRpcList(urls, label) {
  const errors = [];
  const valid = [];

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push(`${label}: unsupported protocol in ${url}`);
        continue;
      }
      valid.push(url);
    } catch {
      errors.push(`${label}: invalid URL ${url}`);
    }
  }

  if (valid.length === 0) {
    errors.push(`${label}: at least one RPC URL is required.`);
  }

  return { errors, urls: valid };
}

function readCustomConfig() {
  if (!fs.existsSync(RPC_CONFIG_PATH)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(RPC_CONFIG_PATH, 'utf8'));
    return {
      eth: normalizeUrlList(data.eth),
      bnb: normalizeUrlList(data.bnb),
    };
  } catch {
    return null;
  }
}

function getRpcUrls(network) {
  const custom = readCustomConfig();

  if (custom && Array.isArray(custom[network]) && custom[network].length) {
    return custom[network];
  }

  const defaults = loadDefaults();
  return defaults[network] || [];
}

function readRpcConfig() {
  const defaults = loadDefaults();
  const custom = readCustomConfig();
  const exists = custom !== null;

  return {
    eth: exists ? custom.eth : defaults.eth,
    bnb: exists ? custom.bnb : defaults.bnb,
    exists,
    usingDefaults: !exists,
    configPath: RPC_CONFIG_PATH,
    note: exists
      ? 'Using your private rpc-config.json (local only, not committed to Git).'
      : 'Using public RPC lists from the repo. Save here to create rpc-config.json with your own endpoints.',
  };
}

function writeRpcConfig(updates) {
  const ethList = normalizeUrlList(updates.eth);
  const bnbList = normalizeUrlList(updates.bnb);
  const ethVal = validateRpcList(ethList, 'ETH');
  const bnbVal = validateRpcList(bnbList, 'BNB');
  const errors = [...ethVal.errors, ...bnbVal.errors];

  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    err.validation = errors;
    throw err;
  }

  const payload = {
    eth: ethVal.urls,
    bnb: bnbVal.urls,
  };

  fs.writeFileSync(RPC_CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return {
    ...readRpcConfig(),
    note: 'RPC lists saved. New scan jobs will use these endpoints.',
  };
}

module.exports = {
  RPC_CONFIG_PATH,
  RPC_DEFAULTS_PATH,
  getRpcUrls,
  readRpcConfig,
  writeRpcConfig,
};
