require('../config/config');

const fs = require('fs');
const util = require('util');
const path = require('path');
const nodemailer = require('nodemailer');
const { paths, ensureDir } = require('../paths');
const { updateProgress, clearProgress } = require('./scan-progress');
const { recordFinding } = require('./findings');
const { getRotator } = require('./rpc');
const {
  getRetryStatsForNetwork,
  listFailedBatchFiles,
  ensureFailedDirs,
} = require('./retry-stats');

const SCAN_ABI = [
  {
    inputs: [
      { internalType: 'address[]', name: 'wallets', type: 'address[]' },
      { internalType: 'string[]', name: 'keys', type: 'string[]' },
    ],
    name: 'checkBalances',
    outputs: [
      {
        components: [
          { internalType: 'string', name: 'key', type: 'string' },
          { internalType: 'address', name: 'wallet', type: 'address' },
          { internalType: 'uint256', name: 'balance', type: 'uint256' },
        ],
        internalType: 'struct WalletBalanceChecker.WalletBalance[]',
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

const NETWORKS = {
  eth: {
    queueDir: paths.WALLETS_SCAN_ETH,
    failedDir: paths.WALLETS_FAILED_ETH,
    contractAddress: '0xA9bE94B2F5C9717bF004aEc140F4f1e3CA916f7a',
    currency: 'ETH',
    emailSubject: 'ETH FOUND',
    tag: 'ETH',
  },
  bnb: {
    queueDir: paths.WALLETS_SCAN_BNB,
    failedDir: paths.WALLETS_FAILED_BNB,
    contractAddress: '0xfcf6f4cef541727f6026ff2e60b44c141c9758d0',
    currency: 'BNB',
    emailSubject: 'BNB FOUND',
    tag: 'BNB',
  },
};

function setupLogging(network, mode) {
  const logDate = Date.now();
  const prefix = mode === 'retry' ? 'retry' : 'resume';
  const logFile = fs.createWriteStream(path.join(paths.LOG_DIR, `${prefix}-${network}-${logDate}.log`), {
    flags: 'w',
  });
  const errorFile = fs.createWriteStream(
    path.join(paths.LOG_ERROR_DIR, `error-${network}-${logDate}.log`),
    { flags: 'w' }
  );
  const logStdout = process.stdout;

  console.log = function logLine(d) {
    logFile.write(`${util.format(d)}\n`);
    logStdout.write(`${util.format(d)}\n`);
  };

  console.error = function logError(d) {
    errorFile.write(`${util.format(d)}\n`);
    logStdout.write(`${util.format(d)}\n`);
  };
}

async function sendEmail(message, subject) {
  console.log(message);

  const { HOST_EMAIL, PASSWORD_EMAIL, USER_MAIL, USER_RECIPIENT } = process.env;

  if (!HOST_EMAIL || !PASSWORD_EMAIL || !USER_MAIL || !USER_RECIPIENT) {
    console.error('Missing email variables in .env (HOST_EMAIL, PASSWORD_EMAIL, USER_MAIL, USER_RECIPIENT)');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: HOST_EMAIL,
    port: 587,
    secure: false,
    auth: { user: USER_MAIL, pass: PASSWORD_EMAIL },
    tls: { ciphers: 'SSLv3' },
  });

  try {
    await transporter.sendMail({
      from: `"MONEY FOUND" <${USER_MAIL}>`,
      to: USER_RECIPIENT,
      subject,
      html: message,
    });
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

function readWalletBatch(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  const wallets = [];
  const pk = [];

  for (const line of lines) {
    const [fromAddress, keyprivate] = line.split('|');
    wallets.push(fromAddress);
    pk.push(keyprivate);
  }

  return { wallets, pk };
}

function moveBatchToFailed(tag, file, sourcePath, failedDir) {
  ensureDir(failedDir);
  const destPath = path.join(failedDir, file);

  try {
    fs.renameSync(sourcePath, destPath);
    console.error(`[${tag}] Moved ${file} to ${path.basename(failedDir)}/`);
    return true;
  } catch (error) {
    console.error(`[${tag}] Could not move ${file} to failed folder:`, error.message);
    return false;
  }
}

function createScanner(network) {
  const config = NETWORKS[network];
  const rotator = getRotator(network);

  async function getBalances(wallets, pk, file) {
    await rotator.call(async (web3) => {
      const contract = new web3.eth.Contract(SCAN_ABI, config.contractAddress);
      const result = await contract.methods.checkBalances(wallets, pk).call();

      for (const walletBalance of result) {
        if (walletBalance.balance > 0) {
          const balanceFormatted = `${web3.utils.fromWei(walletBalance.balance, 'ether')} ${config.currency}`;
          recordFinding({
            network,
            address: walletBalance.wallet,
            privateKey: walletBalance.key,
            balance: walletBalance.balance,
            balanceFormatted,
            file,
          });
          const message = `PK : ${walletBalance.key} | Address : ${walletBalance.wallet} | Balance ${balanceFormatted}`;
          await sendEmail(message, config.emailSubject);
        }
      }
    });
  }

  async function scanBatchFile(
    file,
    { sourceDir, remainingAfter = 0, scannedThisRun = 0, mode = 'scan' } = {}
  ) {
    const filePath = path.join(sourceDir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return { ok: false, reason: 'missing' };
    }

    const { wallets, pk } = readWalletBatch(filePath);

    updateProgress(network, {
      currentFile: file,
      currentWallets: wallets.length,
      remainingFiles: remainingAfter,
      scannedThisRun,
      mode,
    });

    const actionLabel = mode === 'retry' ? 'RETRY' : 'SCAN';
    console.log(
      `[${config.tag} ${actionLabel}] ${file} — ${wallets.length.toLocaleString('en-US')} wallets | ${remainingAfter} batches remaining`
    );

    try {
      await getBalances(wallets, pk, file);
    } catch (error) {
      console.error(`[${config.tag} ${actionLabel}] Failed ${file}:`, error.message);
      if (mode === 'scan' && sourceDir === config.queueDir) {
        moveBatchToFailed(config.tag, file, filePath, config.failedDir);
      }
      return { ok: false, reason: 'rpc', error };
    }

    try {
      fs.renameSync(filePath, path.join(paths.WALLETS_SCANNED, file));
    } catch (error) {
      console.error(`Failed to move ${file} to wallets_scanned:`, error.message);
      if (mode === 'scan' && sourceDir === config.queueDir) {
        moveBatchToFailed(config.tag, file, filePath, config.failedDir);
      }
      return { ok: false, reason: 'move', error };
    }

    return { ok: true };
  }

  async function runScan() {
    rotator.markScanStart();
    const files = fs.readdirSync(config.queueDir).filter((file) => file.endsWith('.txt'));
    let fileCount = 0;

    try {
      for (const file of files) {
        if (fileCount >= 10000) break;

        const remainingAfter = Math.max(files.length - fileCount - 1, 0);
        const result = await scanBatchFile(file, {
          sourceDir: config.queueDir,
          remainingAfter,
          scannedThisRun: fileCount,
          mode: 'scan',
        });

        if (result.ok) {
          fileCount += 1;
        }
      }
    } finally {
      clearProgress(network);
      rotator.markScanEnd();
    }
  }

  async function runRetry() {
    const stats = getRetryStatsForNetwork(network);
    const files = listFailedBatchFiles(network);

    console.log(
      `[${config.tag} RETRY] ${files.length} failed batch(es) in wallets_failed_${network}/ (${stats.failedWallets.toLocaleString('en-US')} wallets)`
    );

    if (files.length === 0) {
      console.log(`[${config.tag} RETRY] Nothing to retry. Failed batches appear in wallets_failed_${network}/ after scan errors.`);
      return;
    }

    rotator.markScanStart();
    let successCount = 0;
    let failCount = 0;

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const remainingAfter = Math.max(files.length - index - 1, 0);

        const result = await scanBatchFile(file, {
          sourceDir: config.failedDir,
          remainingAfter,
          scannedThisRun: successCount,
          mode: 'retry',
        });

        if (result.ok) {
          successCount += 1;
          console.log(`[${config.tag} RETRY] OK ${file}`);
        } else {
          failCount += 1;
        }
      }
    } finally {
      clearProgress(network);
      rotator.markScanEnd();
    }

    console.log(
      `[${config.tag} RETRY] Finished — ${successCount} succeeded, ${failCount} still in wallets_failed_${network}/`
    );
  }

  return { runScan, runRetry };
}

function runScan(network) {
  if (!NETWORKS[network]) {
    throw new Error(`Unknown network: ${network}`);
  }

  ensureDir(paths.WALLETS_SCANNED);
  ensureFailedDirs();
  setupLogging(network, 'scan');
  return createScanner(network).runScan();
}

function runRetry(network) {
  if (!NETWORKS[network]) {
    throw new Error(`Unknown network: ${network}`);
  }

  ensureDir(paths.WALLETS_SCANNED);
  ensureFailedDirs();
  setupLogging(network, 'retry');
  return createScanner(network).runRetry();
}

module.exports = {
  runScan,
  runRetry,
  NETWORKS,
};
