const fs = require('fs');
const path = require('path');
const { hdkey } = require('ethereumjs-wallet');
const bip39 = require('bip39');
const { paths, ensureDir } = require('./paths');
const { MNEMONICS_PER_FILE, WALLETS_PER_MNEMONIC } = require('./constants');

const chain = process.argv[2]?.toLowerCase();

if (!['eth', 'bnb'].includes(chain)) {
  console.error('Usage: node generate-wallets.js <eth|bnb>');
  console.error('  eth → writes to server/wallets_scan_eth/');
  console.error('  bnb → writes to server/wallets_scan_bnb/');
  process.exit(1);
}

const outputFolder = chain === 'eth' ? paths.WALLETS_SCAN_ETH : paths.WALLETS_SCAN_BNB;
ensureDir(outputFolder);

function generateMnemonicAndHDWallet() {
  const mnemonic = bip39.generateMnemonic(256);
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const hdWallet = hdkey.fromMasterSeed(seed);

  return { mnemonic, hdWallet };
}

function deriveAddressFromHDWallet(hdWallet, accountIndex = 0) {
  const fullPath = `m/44'/60'/0'/0/${accountIndex}`;
  const wallet = hdWallet.derivePath(fullPath).getWallet();

  return {
    keyprivate: wallet.getPrivateKey().toString('hex'),
    fromAddress: `0x${wallet.getAddress().toString('hex')}`,
    accountIndex,
  };
}

async function generateAndSaveWallets() {
  const walletsPerMnemonic = WALLETS_PER_MNEMONIC;
  const batchSize = MNEMONICS_PER_FILE;

  console.log(`Generating wallets for ${chain.toUpperCase()} → ${outputFolder}`);

  while (true) {
    const wallets = new Set();
    console.time('Generation time');

    for (let m = 0; m < batchSize; m++) {
      const { hdWallet } = generateMnemonicAndHDWallet();

      for (let accountIndex = 0; accountIndex < walletsPerMnemonic; accountIndex++) {
        const walletData = deriveAddressFromHDWallet(hdWallet, accountIndex);
        wallets.add(`${walletData.fromAddress}|${walletData.keyprivate}`);
      }
    }

    const timestamp = Date.now();
    const fileName = `${chain}_${timestamp}.txt`;
    const filePath = path.join(outputFolder, fileName);

    fs.writeFileSync(filePath, [...wallets].join('\n'), 'utf8');
    console.timeEnd('Generation time');
    console.log(
      `[${chain.toUpperCase()}] ${fileName} — ${wallets.size} wallets (${batchSize} mnemonics × ${walletsPerMnemonic} addresses)`
    );
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught error:', error);
  fs.appendFileSync(
    path.join(outputFolder, 'error.log'),
    `${new Date().toISOString()}: ${error.stack}\n`
  );
});

process.on('SIGINT', () => {
  console.log('Process stopped by user');
  process.exit(0);
});

generateAndSaveWallets();
