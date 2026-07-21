const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..');
const PROJECT_ROOT = path.join(SERVER_DIR, '..');
const MAX_HISTORY = 2000;

const JOBS = {
  'generate-eth': { script: 'generate-wallets.js', args: ['eth'], label: 'Generate ETH' },
  'generate-bnb': { script: 'generate-wallets.js', args: ['bnb'], label: 'Generate BNB' },
  'scan-eth': { script: 'scan-eth.js', args: [], label: 'Scan ETH' },
  'scan-bnb': { script: 'scan-bnb.js', args: [], label: 'Scan BNB' },
  'retry-eth': { script: 'retry-eth.js', args: [], label: 'Retry ETH' },
  'retry-bnb': { script: 'retry-bnb.js', args: [], label: 'Retry BNB' },
};

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map();
    this.history = new Map();
    this.lineBuffers = new Map();
    this.setMaxListeners(50);

    for (const jobKey of Object.keys(JOBS)) {
      this.history.set(jobKey, []);
    }
  }

  getJobKeys() {
    return Object.keys(JOBS);
  }

  getJobMeta(jobKey) {
    return JOBS[jobKey] || null;
  }

  isRunning(jobKey) {
    const proc = this.processes.get(jobKey);
    return Boolean(proc && proc.exitCode === null && !proc.killed);
  }

  getStatus() {
    const status = {};

    for (const jobKey of Object.keys(JOBS)) {
      const proc = this.processes.get(jobKey);
      status[jobKey] = {
        label: JOBS[jobKey].label,
        running: this.isRunning(jobKey),
        pid: proc?.pid ?? null,
        startedAt: proc?.startedAt ?? null,
        exitCode: proc?.exitCode ?? null,
      };
    }

    return status;
  }

  getHistory(jobKey, limit = 500) {
    const lines = this.history.get(jobKey) || [];
    if (limit > 0) {
      return lines.slice(-limit);
    }
    return lines;
  }

  pushHistory(jobKey, entry) {
    const lines = this.history.get(jobKey) || [];
    lines.push(entry);
    if (lines.length > MAX_HISTORY) {
      lines.splice(0, lines.length - MAX_HISTORY);
    }
    this.history.set(jobKey, lines);
  }

  start(jobKey) {
    if (!JOBS[jobKey]) {
      throw new Error(`Unknown job: ${jobKey}`);
    }

    if (this.isRunning(jobKey)) {
      throw new Error(`Job "${jobKey}" is already running`);
    }

    const { script, args } = JOBS[jobKey];
    const scriptPath = path.join(SERVER_DIR, script);

    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.startedAt = new Date().toISOString();
    child.jobKey = jobKey;

    this.processes.set(jobKey, child);
    this.lineBuffers.set(jobKey, '');

    this.pushHistory(jobKey, {
      ts: new Date().toISOString(),
      stream: 'system',
      line: `[START] ${JOBS[jobKey].label} (PID ${child.pid})`,
    });

    this.emit('line', {
      jobKey,
      stream: 'system',
      line: `[START] ${JOBS[jobKey].label} (PID ${child.pid})`,
      ts: new Date().toISOString(),
    });

    const handleData = (stream) => (chunk) => {
      let buffer = (this.lineBuffers.get(jobKey) || '') + chunk.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || '';
      this.lineBuffers.set(jobKey, buffer);

      for (const line of parts) {
        const entry = {
          ts: new Date().toISOString(),
          stream,
          line,
        };

        this.pushHistory(jobKey, entry);
        this.emit('line', { jobKey, ...entry });
      }
    };

    child.stdout.on('data', handleData('stdout'));
    child.stderr.on('data', handleData('stderr'));

    child.on('close', (code, signal) => {
      const remainder = this.lineBuffers.get(jobKey);
      if (remainder) {
        const entry = { ts: new Date().toISOString(), stream: 'stdout', line: remainder };
        this.pushHistory(jobKey, entry);
        this.emit('line', { jobKey, ...entry });
      }
      this.lineBuffers.delete(jobKey);

      const msg = signal
        ? `[END] ${JOBS[jobKey].label} stopped by signal ${signal}`
        : `[END] ${JOBS[jobKey].label} finished (exit code ${code})`;

      const entry = { ts: new Date().toISOString(), stream: 'system', line: msg };
      this.pushHistory(jobKey, entry);
      this.emit('line', { jobKey, ...entry });
      this.emit('exit', { jobKey, code, signal });
    });

    child.on('error', (err) => {
      const entry = {
        ts: new Date().toISOString(),
        stream: 'stderr',
        line: `[ERROR] ${err.message}`,
      };
      this.pushHistory(jobKey, entry);
      this.emit('line', { jobKey, ...entry });
    });

    return { jobKey, pid: child.pid, startedAt: child.startedAt };
  }

  stop(jobKey) {
    if (!JOBS[jobKey]) {
      throw new Error(`Unknown job: ${jobKey}`);
    }

    const child = this.processes.get(jobKey);
    if (!child || !this.isRunning(jobKey)) {
      throw new Error(`Job "${jobKey}" is not running`);
    }

    child.kill('SIGINT');

    setTimeout(() => {
      if (this.isRunning(jobKey)) {
        child.kill('SIGTERM');
      }
    }, 3000);

    const entry = {
      ts: new Date().toISOString(),
      stream: 'system',
      line: `[STOP] Stop requested for ${JOBS[jobKey].label}`,
    };
    this.pushHistory(jobKey, entry);
    this.emit('line', { jobKey, ...entry });

    return { jobKey, stopping: true };
  }
}

module.exports = new ProcessManager();
