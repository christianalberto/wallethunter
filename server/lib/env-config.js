const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

const EDITABLE_KEYS = ['HOST_EMAIL', 'PASSWORD_EMAIL', 'USER_MAIL', 'USER_RECIPIENT'];

const DEFAULT_ENV = {
  HOST_EMAIL: '',
  PASSWORD_EMAIL: '',
  USER_MAIL: '',
  USER_RECIPIENT: '',
  PORT: '3001',
};

function parseEnvFile(content) {
  const result = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }

  return result;
}

function serializeEnvFile(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

function readEnvFileValues() {
  if (!fs.existsSync(ENV_PATH)) {
    return null;
  }

  return parseEnvFile(fs.readFileSync(ENV_PATH, 'utf8'));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateEnvUpdates(updates, existingValues = null) {
  const errors = [];
  const host = String(updates.HOST_EMAIL ?? '').trim();
  const userMail = String(updates.USER_MAIL ?? '').trim();
  const recipient = String(updates.USER_RECIPIENT ?? '').trim();
  const passwordInput = String(updates.PASSWORD_EMAIL ?? '').trim();
  const password = passwordInput || existingValues?.PASSWORD_EMAIL || '';

  if (!host) {
    errors.push('HOST_EMAIL is required.');
  }

  if (!userMail) {
    errors.push('USER_MAIL is required.');
  } else if (!isValidEmail(userMail)) {
    errors.push('USER_MAIL must be a valid email.');
  }

  if (!recipient) {
    errors.push('USER_RECIPIENT is required.');
  } else if (!isValidEmail(recipient)) {
    errors.push('USER_RECIPIENT must be a valid email.');
  }

  if (!password) {
    errors.push('PASSWORD_EMAIL is required.');
  }

  return {
    errors,
    values: {
      HOST_EMAIL: host,
      USER_MAIL: userMail,
      USER_RECIPIENT: recipient,
      PASSWORD_EMAIL: password,
    },
  };
}

function readEnvConfig() {
  const fileValues = readEnvFileValues();
  const exists = fileValues !== null;
  const config = {};

  for (const key of EDITABLE_KEYS) {
    config[key] = exists ? (fileValues[key] ?? '') : '';
  }

  return {
    config,
    keys: EDITABLE_KEYS,
    envPath: ENV_PATH,
    exists,
    hasPassword: exists && Boolean(fileValues?.PASSWORD_EMAIL),
    note: exists ? '' : 'No settings file yet. Complete all fields and save.',
  };
}

function writeEnvConfig(updates) {
  const existingValues = readEnvFileValues();
  const { errors, values } = validateEnvUpdates(updates, existingValues);

  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    err.validation = errors;
    throw err;
  }

  const next = {
    ...(existingValues || {}),
    ...values,
  };

  if (!next.PORT) {
    next.PORT = String(process.env.PORT || DEFAULT_ENV.PORT);
  }

  fs.writeFileSync(ENV_PATH, serializeEnvFile(next), 'utf8');

  for (const key of EDITABLE_KEYS) {
    process.env[key] = next[key];
  }

  return {
    ...readEnvConfig(),
    note: 'Settings saved. You will receive an email when a funded wallet is found.',
  };
}

module.exports = {
  ENV_PATH,
  EDITABLE_KEYS,
  readEnvConfig,
  writeEnvConfig,
};
