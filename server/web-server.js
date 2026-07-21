require('./config/config');

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const processManager = require('./lib/process-manager');
const { readFindings, FINDINGS_FILE } = require('./lib/findings');
const { readProgress } = require('./lib/scan-progress');
const { getRetryStats } = require('./lib/retry-stats');
const { readRpcStatus, getRpcLists, resetRotators } = require('./lib/rpc');
const { paths, ensureWorkspace } = require('./paths');
const { WALLETS_PER_FILE } = require('./constants');
const { readEnvConfig, writeEnvConfig } = require('./lib/env-config');
const { readRpcConfig, writeRpcConfig } = require('./lib/rpc-config');

ensureWorkspace();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const REPO_ASSETS_DIR = path.join(__dirname, '..', 'assets');
const PORT = Number(process.env.PORT) || 3000;

function getPidOnPort(port) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (/^\d+$/.test(out)) return out;
    } catch {
      // fall through to netstat
    }

    try {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of out.split('\n')) {
        if (!/LISTENING/i.test(line)) continue;
        const pid = line.trim().split(/\s+/).pop();
        if (/^\d+$/.test(pid)) return pid;
      }
    } catch {
      return null;
    }
  } else {
    try {
      const out = execSync(`lsof -t -iTCP:${port} -sTCP:LISTEN`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const pid = out.split('\n')[0];
      if (/^\d+$/.test(pid)) return pid;
    } catch {
      return null;
    }
  }

  return null;
}

function printPortInUseHelp(port) {
  const pid = getPidOnPort(port);

  if (process.platform === 'win32') {
    if (pid) {
      console.error(`\nPort ${port} is in use. Kill it:\n\ntaskkill /PID ${pid} /F\n`);
    } else {
      console.error(`\nPort ${port} is in use. Could not detect PID. Try:\n\nnetstat -ano | findstr :${port}\n`);
    }
    return;
  }

  if (pid) {
    console.error(`\nPort ${port} is in use. Kill it:\n\nkill -9 ${pid}\n`);
  } else {
    console.error(`\nPort ${port} is in use. Could not detect PID. Try:\n\nlsof -i :${port}\n`);
  }
}

function handleListenError(err) {
  if (err.code === 'EADDRINUSE') {
    printPortInUseHelp(PORT);
    process.exit(1);
  }

  console.error('Server error:', err);
  process.exit(1);
}

let listenErrorHandled = false;

function handleListenErrorOnce(err) {
  if (listenErrorHandled) return;
  listenErrorHandled = true;
  handleListenError(err);
}

server.on('error', handleListenErrorOnce);
wss.on('error', handleListenErrorOnce);

app.use(express.json());

app.get('/assets/logo-banner.png', (req, res, next) => {
  const file = path.join(REPO_ASSETS_DIR, 'logo-banner.png');
  if (!fs.existsSync(file)) return next();
  return res.sendFile(file);
});

app.get('/assets/logo-transparent.png', (req, res, next) => {
  const file = path.join(REPO_ASSETS_DIR, 'logo-transparent.png');
  if (!fs.existsSync(file)) return next();
  return res.sendFile(file);
});

app.use(express.static(PUBLIC_DIR));

function countTxtFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  return fs.readdirSync(dirPath).filter((f) => f.endsWith('.txt')).length;
}

function queueStats(dirPath) {
  const files = countTxtFiles(dirPath);
  return {
    files,
    wallets: files * WALLETS_PER_FILE,
  };
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

processManager.on('line', (event) => {
  broadcast({ type: 'line', ...event });
});

processManager.on('exit', (event) => {
  broadcast({ type: 'exit', ...event });
});

let findingsWatchReady = false;

function broadcastFinding(entry) {
  broadcast({ type: 'finding', finding: entry });
}

function watchFindingsFile() {
  if (findingsWatchReady || !fs.existsSync(FINDINGS_FILE)) return;

  let lastSize = fs.statSync(FINDINGS_FILE).size;

  fs.watch(FINDINGS_FILE, (eventType) => {
    if (eventType !== 'change') return;

    try {
      const stat = fs.statSync(FINDINGS_FILE);
      if (stat.size <= lastSize) return;

      const stream = fs.createReadStream(FINDINGS_FILE, {
        start: lastSize,
        encoding: 'utf8',
      });

      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            broadcastFinding(JSON.parse(line));
          } catch {
            // ignore malformed
          }
        }
      });

      stream.on('end', () => {
        lastSize = stat.size;
      });
    } catch {
      // file may be temporarily unavailable
    }
  });

  findingsWatchReady = true;
}

watchFindingsFile();

app.post('/api/jobs/start', (req, res) => {
  const { jobKey } = req.body || {};

  if (!jobKey) {
    return res.status(400).json({ error: 'jobKey is required' });
  }

  try {
    const result = processManager.start(jobKey);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/api/jobs/stop', (req, res) => {
  const { jobKey } = req.body || {};

  if (!jobKey) {
    return res.status(400).json({ error: 'jobKey is required' });
  }

  try {
    const result = processManager.stop(jobKey);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/jobs/status', (_req, res) => {
  res.json(processManager.getStatus());
});

app.get('/api/jobs/history/:jobKey', (req, res) => {
  const { jobKey } = req.params;
  const limit = parseInt(req.query.limit, 10) || 500;

  if (!processManager.getJobMeta(jobKey)) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobKey,
    history: processManager.getHistory(jobKey, limit),
  });
});

app.get('/api/findings', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 0;
  res.json({ findings: readFindings(limit || undefined) });
});

app.get('/api/config/env', (_req, res) => {
  res.json(readEnvConfig());
});

app.put('/api/config/env', (req, res) => {
  try {
    const result = writeEnvConfig(req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'Failed to save .env',
      validation: err.validation || undefined,
    });
  }
});

app.get('/api/config/rpc', (_req, res) => {
  res.json(readRpcConfig());
});

app.put('/api/config/rpc', (req, res) => {
  try {
    const result = writeRpcConfig(req.body || {});
    resetRotators();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'Failed to save RPC config',
      validation: err.validation || undefined,
    });
  }
});

app.get('/api/stats', (_req, res) => {
  const eth = queueStats(paths.WALLETS_SCAN_ETH);
  const bnb = queueStats(paths.WALLETS_SCAN_BNB);
  const scanned = queueStats(paths.WALLETS_SCANNED);

  res.json({
    wallets_scan_eth: eth.files,
    wallets_scan_eth_wallets: eth.wallets,
    wallets_scan_bnb: bnb.files,
    wallets_scan_bnb_wallets: bnb.wallets,
    wallets_scanned: scanned.files,
    wallets_scanned_wallets: scanned.wallets,
    wallets_per_file: WALLETS_PER_FILE,
    findings: readFindings().length,
    scan_progress: readProgress(),
    retry: getRetryStats(),
    rpc: readRpcStatus(),
    rpc_lists: getRpcLists(),
  });
});

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      type: 'connected',
      message: 'Connected to WalletHunter dashboard',
    })
  );

  ws.send(
    JSON.stringify({
      type: 'status',
      status: processManager.getStatus(),
    })
  );
});

server.listen(PORT, () => {
  console.log(`Dashboard available at http://localhost:${PORT}`);
});
