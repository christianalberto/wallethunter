<p align="center">
  <img src="assets/logo-banner.png" alt="WalletHunter mascot" width="360">
</p>

<p align="center">
  <pre style="display:inline-block;text-align:left;font-family:monospace;font-size:11px;line-height:1.15;margin:0;">
__        __    _ _      _   _   _             _
\ \      / /_ _| | | ___| |_| | | |_   _ _ __ | |_ ___ _ __
 \ \ /\ / / _` | | |/ _ \ __| |_| | | | | '_ \| __/ _ \ '__|
  \ V  V / (_| | | |  __/ |_|  _  | |_| | | | | ||  __/ |
   \_/\_/ \__,_|_|_|\___|\__|_| |_|\__,_|_| |_|\__\___|_|
  </pre>
</p>

<p align="center"><em>Hunt funded wallets · Ethereum &amp; BSC</em></p>

**Demonstrative** Node.js tool to generate random Ethereum/BSC wallet batches, scan on-chain balances in bulk via a smart contract, and alert by email when a funded address is found.

> **Important:** This project is for learning and experimentation — not financial advice. The probability of finding a funded random wallet is negligible.

---

## What this project really is

WalletHunter has two ways to run, but **one core**:

| Layer | Role |
|-------|------|
| **Node scripts** (`server/*.js`) | **Core business logic** — generation, scanning, retry, email, RPC rotation, findings |
| **Web dashboard** (`npm run dashboard`) | **Optional control panel** — starts/stops the same scripts, shows live logs and stats |

You can use the tool **without ever opening the browser**: run the scripts from the terminal, watch folders and log files, and everything works the same. The dashboard is convenience, not the engine.

Both modes share the same folders, the same `.env`, the same `rpc-config.json`, and the same output files.

---

## Core pipeline

```mermaid
flowchart LR
    GEN[generate-wallets.js] --> Q[scan queue]
    Q --> SCAN[scan-eth / scan-bnb]
    SCAN -->|OK| ARCH[wallets_scanned/]
    SCAN -->|fail| FAIL[wallets_failed_*/]
    FAIL --> RETRY[retry-eth / retry-bnb]
    RETRY --> ARCH
    SCAN -->|balance > 0| FIND[findings.jsonl + email]
```

**Stages:**

1. **Generate** — Create `.txt` batch files (1,100 wallets each) into the network scan queue.
2. **Scan** — Read batches from the queue, call `WalletBalanceChecker.checkBalances()` on-chain, rotate RPCs on failure.
3. **Alert** — Append funded wallets to `findings.jsonl` and send SMTP email (if configured).
4. **Archive** — Move successful batches to `wallets_scanned/`.
5. **Retry** — Re-process batches that failed during scan from `wallets_failed_eth/` or `wallets_failed_bnb/`.

ETH and BNB run **in parallel** as separate queues and scripts. Scanned batches from both networks share one archive folder.

---

## Concepts

| Term | Meaning |
|------|---------|
| **Batch / file** | One `.txt` file with 1,100 wallets (`100` mnemonics × `11` derived addresses). |
| **Scan queue** | `wallets_scan_eth/` or `wallets_scan_bnb/` — batches waiting to be scanned. |
| **Failed folder** | `wallets_failed_eth/` or `wallets_failed_bnb/` — batch moved here when a scan errors (RPC, contract, I/O, etc.). |
| **Scanned archive** | `wallets_scanned/` — batches that finished scanning successfully (ETH + BNB). |
| **Finding** | A wallet with balance > 0, stored in `server/log/findings.jsonl`. |
| **RPC rotation** | On RPC failure, the scan engine tries the next URL in your list automatically. |
| **Job** | A running instance of a script (generate, scan, or retry). The dashboard spawns them as child processes; CLI runs them directly in your terminal. |

---

## Requirements

- **Node.js 18+**
- **SMTP account** (optional — only needed for email alerts)
- **Your own RPC endpoints** (recommended for production use; public defaults ship with the repo)

---

## Installation

```bash
git clone https://github.com/christianalberto/wallethunter.git
cd wallethunter
npm install
```

---

## Configuration

### Email (`.env`)

Copy the template and fill in your SMTP settings:

```bash
cp .env.example .env
```

```env
HOST_EMAIL=smtp.example.com
PASSWORD_EMAIL=your_smtp_password
USER_MAIL=sender@example.com
USER_RECIPIENT=alerts@example.com
PORT=3001
```

| Variable | Purpose |
|----------|---------|
| `HOST_EMAIL` | SMTP server hostname |
| `PASSWORD_EMAIL` | SMTP password |
| `USER_MAIL` | Sender address |
| `USER_RECIPIENT` | Where balance alerts are sent |
| `PORT` | Dashboard HTTP port (default `3001`) |

**Do not commit `.env`.** The dashboard can edit email settings via **Config → Email**; values are written to `.env` on save.

### RPC endpoints (`rpc-config.json`)

Scan scripts need JSON-RPC URLs. **Use your own keys — do not rely on someone else's private endpoints.**

| File | In Git? | Purpose |
|------|---------|---------|
| `server/config/rpc-defaults.json` | Yes | Public RPC list used when no local config exists |
| `rpc-config.example.json` | Yes | Template showing the expected JSON shape |
| `rpc-config.json` | **No** (`.gitignore`) | **Your private RPC lists** |

Create your local file:

```bash
cp rpc-config.example.json rpc-config.json
```

Edit `rpc-config.json`:

```json
{
  "eth": [
    "https://mainnet.infura.io/v3/YOUR_PROJECT_ID",
    "https://eth.llamarpc.com"
  ],
  "bnb": [
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc-dataseed.nariox.org"
  ]
}
```

URLs are tried **in order** with automatic failover. You can also edit lists from the dashboard: **Config → RPC** (one URL per line).

If `rpc-config.json` is missing, the app falls back to `rpc-defaults.json` (public endpoints only).

---

## Manual usage (CLI) — core workflow

This is the primary way to run WalletHunter. Each command maps to a Node script under `server/`.

### npm scripts

```bash
# Generation (runs until Ctrl+C)
npm run generate:eth
npm run generate:bnb

# Scan queues
npm run scan:eth
npm run scan:bnb

# Retry failed batches
npm run retry:eth
npm run retry:bnb
```

### Direct node commands

```bash
node server/generate-wallets.js eth
node server/generate-wallets.js bnb
node server/scan-eth.js
node server/scan-bnb.js
node server/retry-eth.js
node server/retry-bnb.js
```

### Typical manual session

Open **separate terminals** (or run steps sequentially):

```bash
# Terminal 1 — generate ETH batches into the queue
npm run generate:eth

# Terminal 2 — scan the ETH queue when files exist
npm run scan:eth

# Terminal 3 (optional) — same for BNB
npm run generate:bnb
npm run scan:bnb

# If scan errors moved files to wallets_failed_*:
npm run retry:eth
npm run retry:bnb
```

**Monitor progress without the dashboard:**

- Watch queue sizes: count files in `server/wallets_scan_eth/` and `server/wallets_scan_bnb/`
- Read findings: `server/log/findings.jsonl`
- Read scan progress: `server/log/scan-progress.json`
- Read RPC status: `server/log/rpc-status.json`
- Console output goes to stdout in each terminal

---

## Web dashboard — optional UI

The dashboard **does not replace** the scripts. It **spawns and monitors** them via `server/lib/process-manager.js` and streams stdout over WebSocket.

```bash
npm run dashboard
```

Open [http://localhost:3001](http://localhost:3001) (or your `PORT`).

| Tab | Under the hood |
|-----|----------------|
| **Generation** | `generate-wallets.js eth` / `bnb` |
| **Scan ETH** | `scan-eth.js` + `retry-eth.js` |
| **Scan BNB** | `scan-bnb.js` + `retry-bnb.js` |
| **Findings** | Reads `server/log/findings.jsonl` |

**Footer controls:**

- **Config → Email** — edit `.env` alert settings
- **Config → RPC** — edit `rpc-config.json`
- **Help** — in-app documentation
- **Modern / Classic** — UI theme

The dashboard exposes REST (`/api/*`) and WebSocket for live console lines, job status, and queue counters. You can run CLI jobs and dashboard jobs **at the same time** — they operate on the same folders (avoid starting duplicate scan jobs on the same network).

---

## Wallet batch format

Each line in a `.txt` batch file:

```
0xPublicAddress|privateKeyHex
```

File naming: `eth_{timestamp}.txt` or `bnb_{timestamp}.txt`.

Each file contains **1,100 wallets** (100 BIP39 mnemonics, 11 addresses per mnemonic, derivation path `m/44'/60'/0'/0/{index}`).

---

## On-chain scanning

Scan scripts call a deployed **`WalletBalanceChecker`** contract that reads native balances in batch:

| Network | Contract |
|---------|----------|
| Ethereum | `0xA9bE94B2F5C9717bF004aEc140F4f1e3CA916f7a` |
| BSC | `0xfcf6f4cef541727f6026ff2e60b44c141c9758d0` |

Source: `smart_contract/WalletBalanceChecker.sol`

When `balance > 0`, the script records the finding and sends email (if SMTP is configured).

---

## Folder reference

| Folder / file | Purpose |
|---------------|---------|
| `server/wallets_scan_eth/` | ETH batches waiting to scan |
| `server/wallets_scan_bnb/` | BNB batches waiting to scan |
| `server/wallets_failed_eth/` | ETH batches that failed during scan |
| `server/wallets_failed_bnb/` | BNB batches that failed during scan |
| `server/wallets_scanned/` | Successfully processed batches (both networks) |
| `server/log/findings.jsonl` | JSON-lines registry of funded wallets |
| `server/log/scan-progress.json` | Current file being scanned (dashboard + API) |
| `server/log/rpc-status.json` | Active RPC endpoint per network |
| `server/log/error/` | Detailed error logs |

All wallet `.txt` files and logs are **gitignored** — never commit them.

---

## Scripts reference

### `generate-wallets.js`

```bash
node server/generate-wallets.js eth   # → wallets_scan_eth/
node server/generate-wallets.js bnb   # → wallets_scan_bnb/
```

Infinite loop until `Ctrl+C`. Writes one batch file per iteration.

### `scan-eth.js` / `scan-bnb.js`

Thin wrappers around `server/lib/scan-runner.js`:

- Read all `.txt` files from the network queue
- Batch-call the balance checker contract via Web3
- Rotate through RPC URLs on failure
- On success → move file to `wallets_scanned/`
- On failure → move file to `wallets_failed_*/`
- On funded wallet → append to `findings.jsonl` + email

### `retry-eth.js` / `retry-bnb.js`

Same scan engine, but input folder is `wallets_failed_*` instead of the scan queue. Successful retries archive to `wallets_scanned/`.

---

## Project structure

```
wallet-hunter/
├── .env.example                 # SMTP + PORT template
├── rpc-config.example.json      # RPC template (copy → rpc-config.json)
├── package.json                 # npm scripts
├── public/                      # Dashboard static UI
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── server/
│   ├── config/
│   │   ├── config.js            # Loads .env
│   │   └── rpc-defaults.json    # Public RPC fallback (committed)
│   ├── generate-wallets.js      # ★ Generate
│   ├── scan-eth.js              # ★ Scan ETH
│   ├── scan-bnb.js              # ★ Scan BNB
│   ├── retry-eth.js             # ★ Retry ETH
│   ├── retry-bnb.js             # ★ Retry BNB
│   ├── web-server.js            # Dashboard HTTP + WebSocket
│   ├── paths.js                 # Directory paths
│   ├── constants.js             # Wallets per file (1100)
│   └── lib/
│       ├── scan-runner.js       # ★ Shared scan/retry engine
│       ├── rpc.js               # RPC rotation
│       ├── rpc-config.js        # Read/write rpc-config.json
│       ├── env-config.js        # Read/write .env from dashboard
│       ├── findings.js          # findings.jsonl
│       ├── process-manager.js   # Spawns CLI jobs for dashboard
│       ├── scan-progress.js     # Progress file for UI
│       └── retry-stats.js       # Failed-folder stats
└── smart_contract/
    └── WalletBalanceChecker.sol
```

★ = core business logic

---

## Dependencies

| Package | Use |
|---------|-----|
| `web3` | RPC + smart contract calls |
| `ethereumjs-wallet` | HD wallet derivation |
| `bip39` | Mnemonic generation |
| `nodemailer` | Email alerts |
| `dotenv` | `.env` loading |
| `express` | Dashboard HTTP API |
| `ws` | Live console WebSocket |

---

## Security

- `.txt` wallet files contain **private keys** — treat as secrets.
- Never commit `.env`, `rpc-config.json`, wallet batches, or findings.
- Configure **your own** RPC URLs with **your own** API keys.
- If this repo was ever pushed with private RPC keys in source history, rotate those keys.
- Verify on-chain contract addresses before use.

---

## Screens

Dashboard previews from the web UI (`npm run dashboard`).

### Generation

<p align="center">
  <img src="assets/screens/imagen1.png" alt="Generation tab — Classic theme" width="720">
</p>

<p align="center"><em>Classic theme — wallet generation with live console output.</em></p>

<p align="center">
  <img src="assets/screens/imagen5.png" alt="Generation tab — Modern theme" width="720">
</p>

<p align="center"><em>Modern theme — generation controls, stats, and footer links.</em></p>

### Scan ETH

<p align="center">
  <img src="assets/screens/imagen2.png" alt="Scan ETH tab" width="720">
</p>

<p align="center"><em>Scan ETH — active RPC endpoint, current batch, and scan console.</em></p>

### Config &amp; Help

<p align="center">
  <img src="assets/screens/imagen3.png" alt="Config modal — Email" width="640">
</p>

<p align="center"><em>Config modal — email alerts (SMTP sender and recipient).</em></p>

<p align="center">
  <img src="assets/screens/imagen4.png" alt="Help modal — Overview" width="640">
</p>

<p align="center"><em>Help modal — overview and quick start guide.</em></p>

---

## Author

**Christian Alberto** — [github.com/christianalberto](https://github.com/christianalberto)

- Repository: [github.com/christianalberto/wallethunter](https://github.com/christianalberto/wallethunter)
- Sponsors: [github.com/sponsors/christianalberto](https://github.com/sponsors/christianalberto)

If this project helped you, a star on GitHub is appreciated.

---

## License

MIT — see [LICENSE](LICENSE).
