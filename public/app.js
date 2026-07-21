(() => {
  const GENERATE_JOBS = ['generate-eth', 'generate-bnb'];
  const SCAN_JOBS = ['scan-eth', 'scan-bnb', 'retry-eth', 'retry-bnb'];

  const consoleGenerate = document.getElementById('console-generate');
  const consoleScanEth = document.getElementById('console-scan-eth');
  const consoleScanBnb = document.getElementById('console-scan-bnb');
  const findingsBody = document.getElementById('findings-body');
  const wsStatus = document.getElementById('ws-status');
  const CELEBRATION_KEY = 'wallet-hunter-finding-celebrations';

  let pendingCelebrationFindings = [];

  const MAX_CONSOLE_LINES = 800;
  let ws = null;
  let reconnectTimer = null;
  let statsRefreshTimer = null;

  const WALLETS_PER_FILE = 1100;

  function formatFilesWallets(files, perFile = WALLETS_PER_FILE) {
    const f = Number(files) || 0;
    const rate = Number(perFile) > 0 ? Number(perFile) : WALLETS_PER_FILE;
    const w = f * rate;
    return `${f.toLocaleString('en-US')} files (${w.toLocaleString('en-US')} wallets)`;
  }

  function scheduleStatsRefresh() {
    clearTimeout(statsRefreshTimer);
    statsRefreshTimer = setTimeout(refreshStats, 400);
  }

  function jobConsoleTarget(jobKey) {
    if (GENERATE_JOBS.includes(jobKey)) return consoleGenerate;
    if (jobKey === 'scan-eth' || jobKey === 'retry-eth') return consoleScanEth;
    if (jobKey === 'scan-bnb' || jobKey === 'retry-bnb') return consoleScanBnb;
    return consoleScanEth;
  }

  function statusElementId(jobKey) {
    return `status-${jobKey}`;
  }

  function appendConsoleLine(container, line, stream) {
    if (!container) return;

    const span = document.createElement('span');
    span.className = `line-${stream || 'stdout'}`;
    span.textContent = line + '\n';
    container.appendChild(span);

    while (container.childNodes.length > MAX_CONSOLE_LINES) {
      container.removeChild(container.firstChild);
    }

    container.scrollTop = container.scrollHeight;
  }

  let lastStats = null;
  let lastJobStatus = {};

  function formatRetryStat(retry) {
    if (!retry || retry.failedBatches === 0) {
      return 'Nothing to retry';
    }

    return `${retry.failedBatches} file${retry.failedBatches === 1 ? '' : 's'} waiting in failed folder`;
  }

  function updateRetryStats(stats, statusMap = lastJobStatus) {
    ['eth', 'bnb'].forEach((network) => {
      const retry = stats.retry?.[network];
      const meta = document.getElementById(`retry-stat-${network}`);
      const failedEl = document.getElementById(`retry-failed-${network}`);
      const failedBox = document.getElementById(`retry-box-${network}`);

      if (failedEl) {
        failedEl.textContent = formatFilesWallets(retry?.failedBatches || 0, stats.wallets_per_file);
      }
      if (failedBox) {
        failedBox.classList.toggle('has-failed', Boolean(retry?.canRetry));
      }
      if (meta) meta.textContent = formatRetryStat(retry);

      const jobKey = `retry-${network}`;
      const running = Boolean(statusMap?.[jobKey]?.running);
      const canRetry = Boolean(retry?.canRetry);
      const active = running || canRetry;
      const startBtn = document.querySelector(`[data-start="${jobKey}"]`);
      const stopBtn = document.querySelector(`[data-stop="${jobKey}"]`);
      const row = document.getElementById(`retry-row-${network}`);

      if (startBtn) {
        startBtn.disabled = !active || running;
        startBtn.title = canRetry
          ? 'Process failed batches from wallets_failed folder'
          : 'No failed batches in failed folder';
      }
      if (stopBtn) {
        stopBtn.disabled = !running;
      }
      if (row) {
        row.classList.toggle('retry-row--inactive', !active);
      }
    });
  }

  function updateJobButtons(jobKey, running) {
    if (jobKey.startsWith('retry-')) return;

    const startBtn = document.querySelector(`[data-start="${jobKey}"]`);
    const stopBtn = document.querySelector(`[data-stop="${jobKey}"]`);
    if (startBtn) startBtn.disabled = Boolean(running);
    if (stopBtn) stopBtn.disabled = !running;
  }

  function updateJobStatus(statusMap) {
    lastJobStatus = statusMap;

    for (const [jobKey, info] of Object.entries(statusMap)) {
      const el = document.getElementById(statusElementId(jobKey));
      if (el) {
        el.textContent = info.running ? 'Running' : 'Stopped';
        el.classList.toggle('running', info.running);
      }
      updateJobButtons(jobKey, info.running);
    }

    if (lastStats) {
      updateRetryStats(lastStats, statusMap);
      updateRpcStats(lastStats, statusMap);
    }
  }

  function updateNetworkScanPanel(network, stats) {
    const queueKey = network === 'eth' ? 'wallets_scan_eth' : 'wallets_scan_bnb';
    const queue = document.getElementById(`scan-stat-${network}-queue`);
    const active = document.getElementById(`scan-stat-${network}-active`);
    const remaining = document.getElementById(`scan-stat-${network}-remaining`);
    const progress = stats.scan_progress || {};

    if (queue) {
      queue.textContent = `${formatFilesWallets(stats[queueKey], stats.wallets_per_file)} waiting`;
    }

    if (active) {
      const item = progress[network];
      if (item) {
        active.classList.add('is-active');
        active.innerHTML = `
          <div class="scan-now-file">${item.currentFile}</div>
          <div class="scan-now-meta">${Number(item.currentWallets).toLocaleString('en-US')} wallets</div>
        `;
      } else {
        active.classList.remove('is-active');
        active.innerHTML = '<span class="scan-now-idle">—</span>';
      }
    }

    if (remaining) {
      const item = progress[network];
      remaining.textContent = item
        ? `${item.remainingFiles} files left to scan`
        : '';
    }
  }

  function updateScanStats(stats) {
    updateNetworkScanPanel('eth', stats);
    updateNetworkScanPanel('bnb', stats);
    updateRpcStats(stats, lastJobStatus);
  }

  function formatRpcStatus(rpc, network, statusMap) {
    const urls = statsRpcLists?.[network] || [];
    const scanRunning = Boolean(statusMap?.[`scan-${network}`]?.running);
    const retryRunning = Boolean(statusMap?.[`retry-${network}`]?.running);
    const total = rpc?.totalRpcs || urls.length || 0;
    const hasHistory = Boolean(rpc?.currentRpc);
    const activeUrl = rpc?.currentRpc || urls[0] || '';
    const index = hasHistory && typeof rpc.currentIndex === 'number'
      ? rpc.currentIndex + 1
      : activeUrl && urls.length > 0
        ? urls.indexOf(activeUrl) + 1 || 1
        : 1;
    const position = total > 0 ? `${index}/${total}` : '';

    if (!activeUrl) {
      return {
        badge: 'Unavailable',
        badgeClass: 'error',
        url: 'No RPC configured',
        detail: 'Add endpoints in Config → RPC',
      };
    }

    const urlLine = activeUrl;
    const isLive = scanRunning || retryRunning;

    if (isLive && rpc?.status === 'error') {
      return {
        badge: 'Rotating',
        badgeClass: 'error',
        url: `${urlLine} · ${position}`,
        detail: rpc.lastError || 'Trying next endpoint',
      };
    }

    if (isLive) {
      return {
        badge: 'Active',
        badgeClass: 'active',
        url: `${urlLine} · ${position}`,
        detail: '',
      };
    }

    if (hasHistory) {
      return {
        badge: 'Idle',
        badgeClass: 'idle',
        url: `${urlLine} · ${position}`,
        detail: '',
      };
    }

    return {
      badge: 'Idle',
      badgeClass: 'idle',
      url: '—',
      detail: '',
    };
  }

  let statsRpcLists = null;

  function updateRpcStats(stats, statusMap = lastJobStatus) {
    statsRpcLists = stats.rpc_lists || statsRpcLists;
    ['eth', 'bnb'].forEach((network) => {
      const rpc = stats.rpc?.[network];
      const badgeEl = document.getElementById(`rpc-${network}-badge`);
      const urlEl = document.getElementById(`rpc-${network}-url`);
      const detailEl = document.getElementById(`rpc-${network}-detail`);
      const cardEl = document.getElementById(`rpc-${network}-card`);
      const formatted = formatRpcStatus(rpc, network, statusMap);

      if (badgeEl) {
        badgeEl.textContent = formatted.badge;
        badgeEl.className = `rpc-badge ${formatted.badgeClass}`;
      }
      if (urlEl) urlEl.textContent = formatted.url;
      if (detailEl) detailEl.textContent = formatted.detail;
      if (cardEl) {
        cardEl.dataset.state = formatted.badgeClass;
      }
    });
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
    return data;
  }

  async function startJob(jobKey) {
    try {
      await api('/api/jobs/start', {
        method: 'POST',
        body: JSON.stringify({ jobKey }),
      });
      await refreshStatus();
    } catch (err) {
      appendConsoleLine(jobConsoleTarget(jobKey), `[ERROR] ${err.message}`, 'stderr');
    }
  }

  async function stopJob(jobKey) {
    try {
      await api('/api/jobs/stop', {
        method: 'POST',
        body: JSON.stringify({ jobKey }),
      });
      await refreshStatus();
    } catch (err) {
      appendConsoleLine(jobConsoleTarget(jobKey), `[ERROR] ${err.message}`, 'stderr');
    }
  }

  async function refreshStatus() {
    const status = await api('/api/jobs/status');
    updateJobStatus(status);
    return status;
  }

  async function loadHistory(jobKey) {
    const data = await api(`/api/jobs/history/${jobKey}?limit=300`);
    const target = jobConsoleTarget(jobKey);
    for (const entry of data.history || []) {
      if (entry.line !== undefined) {
        appendConsoleLine(target, entry.line, entry.stream);
      }
    }
  }

  async function refreshStats() {
    try {
      lastStats = await api('/api/stats');
      document.getElementById('stat-eth').textContent = formatFilesWallets(
        lastStats.wallets_scan_eth,
        lastStats.wallets_per_file
      );
      document.getElementById('stat-bnb').textContent = formatFilesWallets(
        lastStats.wallets_scan_bnb,
        lastStats.wallets_per_file
      );
      document.getElementById('stat-scanned').textContent = formatFilesWallets(
        lastStats.wallets_scanned,
        lastStats.wallets_per_file
      );
      document.getElementById('stat-findings').textContent = lastStats.findings ?? '0';

      const genEth = document.getElementById('gen-stat-eth');
      const genBnb = document.getElementById('gen-stat-bnb');
      if (genEth) {
        genEth.textContent = `ETH wallets ${formatFilesWallets(lastStats.wallets_scan_eth, lastStats.wallets_per_file)}`;
      }
      if (genBnb) {
        genBnb.textContent = `BNB wallets ${formatFilesWallets(lastStats.wallets_scan_bnb, lastStats.wallets_per_file)}`;
      }

      updateScanStats(lastStats);
      updateRetryStats(lastStats, lastJobStatus);
    } catch {
      // ignore transient errors
    }
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-US');
    } catch {
      return iso;
    }
  }

  function formatBalanceDisplay(balanceFormatted) {
    if (!balanceFormatted) return 'balance > 0';

    const trimmed = String(balanceFormatted).trim();
    const match = trimmed.match(/^([0-9.eE+-]+)\s+([A-Za-z]+)$/);
    if (!match) return trimmed;

    const num = Number(match[1]);
    if (!Number.isFinite(num)) return trimmed;

    const rounded = Math.round(num * 1e5) / 1e5;
    const formatted = rounded.toFixed(5).replace(/\.?0+$/, '');
    return `${formatted} ${match[2]}`;
  }

  function networkBadge(network) {
    const n = (network || '').toLowerCase();
    const cls = n === 'bnb' ? 'badge-bnb' : 'badge-eth';
    const label = n === 'bnb' ? 'BNB' : 'ETH';
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function renderFindings(findings, highlightFirst = false) {
    if (!findings.length) {
      findingsBody.innerHTML =
        '<tr class="empty-row"><td colspan="6">No funded wallets found yet.</td></tr>';
      return;
    }

    findingsBody.innerHTML = findings
      .map((f, i) => {
        const rowClass = highlightFirst && i === 0 ? 'new-finding' : '';
        return `<tr class="${rowClass}">
          <td>${formatDate(f.timestamp)}</td>
          <td>${networkBadge(f.network)}</td>
          <td class="addr-cell" title="${f.address}">${f.address}</td>
          <td class="balance-cell">${formatBalanceDisplay(f.balanceFormatted)}</td>
          <td>${f.file || '—'}</td>
          <td class="pk-cell" title="Click to copy">${f.privateKey}</td>
        </tr>`;
      })
      .join('');
  }

  async function loadFindings() {
    try {
      const data = await api('/api/findings');
      const findings = data.findings || [];
      renderFindings(findings);
      return findings;
    } catch {
      findingsBody.innerHTML =
        '<tr class="empty-row"><td colspan="6">Failed to load findings.</td></tr>';
      return [];
    }
  }

  function findingFingerprint(finding) {
    return `${finding.timestamp}|${finding.address}|${finding.network || ''}`;
  }

  function getCelebratedSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(CELEBRATION_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function markFindingsCelebrated(findings) {
    const celebrated = getCelebratedSet();
    findings.forEach((finding) => celebrated.add(findingFingerprint(finding)));
    localStorage.setItem(CELEBRATION_KEY, JSON.stringify([...celebrated].slice(-200)));
  }

  function getUncelebratedFindings(findings) {
    const celebrated = getCelebratedSet();
    return findings.filter((finding) => !celebrated.has(findingFingerprint(finding)));
  }

  function isFindingsTabActive() {
    return document.getElementById('panel-findings')?.classList.contains('active');
  }

  function restartCelebrationLogoAnimation() {
    const coin = document.querySelector('.finding-coin');
    if (!coin) return;
    coin.classList.remove('is-flipping');
    void coin.offsetWidth;
    coin.classList.add('is-flipping');
  }

  function showFindingCelebration(findings) {
    const modal = document.getElementById('finding-celebration-modal');
    const textEl = document.getElementById('finding-celebration-text');
    const metaEl = document.getElementById('finding-celebration-meta');
    if (!modal || !findings.length) return;

    pendingCelebrationFindings = findings.slice();
    const latest = findings[0];
    const count = findings.length;

    if (textEl) {
      textEl.textContent =
        count === 1
          ? 'A funded wallet was detected during scanning.'
          : `${count} funded wallets were detected during scanning.`;
    }

    if (metaEl && latest) {
      const network = (latest.network || 'eth').toUpperCase();
      metaEl.textContent =
        count === 1
          ? `${network} · ${formatBalanceDisplay(latest.balanceFormatted)}`
          : `Latest: ${network} · ${formatBalanceDisplay(latest.balanceFormatted)}`;
    }

    const startFlip = () => restartCelebrationLogoAnimation();
    const logoImg = document.querySelector('.finding-celebration-logo');

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    if (logoImg && !logoImg.complete) {
      logoImg.addEventListener('load', startFlip, { once: true });
      logoImg.addEventListener('error', startFlip, { once: true });
    } else {
      startFlip();
    }
  }

  function maybeShowFindingCelebration(findings) {
    const uncelebrated = getUncelebratedFindings(findings);
    if (uncelebrated.length) {
      showFindingCelebration(uncelebrated);
    }
  }

  function closeFindingCelebration() {
    const modal = document.getElementById('finding-celebration-modal');
    if (!modal || modal.hidden) return;

    if (pendingCelebrationFindings.length) {
      markFindingsCelebrated(pendingCelebrationFindings);
      pendingCelebrationFindings = [];
    }

    modal.hidden = true;
    document.body.style.overflow = '';
    document.querySelector('.finding-coin')?.classList.remove('is-flipping');
  }

  function initFindingCelebrationModal() {
    const modal = document.getElementById('finding-celebration-modal');
    const closeBtn = document.getElementById('close-finding-celebration');
    if (!modal) return;

    closeBtn?.addEventListener('click', closeFindingCelebration);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeFindingCelebration();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeFindingCelebration();
    });
  }

  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.addEventListener('open', () => {
      wsStatus.className = 'connection connected';
      wsStatus.querySelector('span:last-child').textContent = 'Connected';
    });

    ws.addEventListener('close', () => {
      wsStatus.className = 'connection disconnected';
      wsStatus.querySelector('span:last-child').textContent = 'Disconnected';
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'line') {
        const target = jobConsoleTarget(msg.jobKey);
        appendConsoleLine(target, msg.line, msg.stream);
        if (GENERATE_JOBS.includes(msg.jobKey) || SCAN_JOBS.includes(msg.jobKey)) {
          scheduleStatsRefresh();
        }
        if (/\[(ETH|BNB) RPC\]/i.test(msg.line || '')) {
          scheduleStatsRefresh();
        }
      }

      if (msg.type === 'status') {
        updateJobStatus(msg.status);
      }

      if (msg.type === 'finding' && msg.finding) {
        prependFinding(msg.finding);
        scheduleStatsRefresh();
      }

      if (msg.type === 'exit') {
        refreshStatus();
        scheduleStatsRefresh();
      }
    });
  }

  function prependFinding(finding) {
    const empty = findingsBody.querySelector('.empty-row');
    if (empty) empty.remove();

    const tr = document.createElement('tr');
    tr.className = 'new-finding';
    tr.innerHTML = `
      <td>${formatDate(finding.timestamp)}</td>
      <td>${networkBadge(finding.network)}</td>
      <td class="addr-cell" title="${finding.address}">${finding.address}</td>
      <td class="balance-cell">${formatBalanceDisplay(finding.balanceFormatted)}</td>
      <td>${finding.file || '—'}</td>
      <td class="pk-cell" title="Click to copy">${finding.privateKey}</td>
    `;
    findingsBody.prepend(tr);

    if (isFindingsTabActive()) {
      maybeShowFindingCelebration([finding]);
    }
  }

  // Tabs
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

      if (tab.dataset.tab === 'findings') {
        const findings = await loadFindings();
        maybeShowFindingCelebration(findings);
      }
    });
  });

  // Job buttons
  document.querySelectorAll('[data-start]').forEach((btn) => {
    btn.addEventListener('click', () => startJob(btn.dataset.start));
  });

  document.querySelectorAll('[data-stop]').forEach((btn) => {
    btn.addEventListener('click', () => stopJob(btn.dataset.stop));
  });

  document.getElementById('clear-generate').addEventListener('click', () => {
    consoleGenerate.textContent = '';
  });

  document.getElementById('clear-scan-eth').addEventListener('click', () => {
    consoleScanEth.textContent = '';
  });

  document.getElementById('clear-scan-bnb').addEventListener('click', () => {
    consoleScanBnb.textContent = '';
  });

  document.getElementById('refresh-findings').addEventListener('click', loadFindings);

  findingsBody.addEventListener('click', (e) => {
    const cell = e.target.closest('.pk-cell');
    if (!cell) return;
    navigator.clipboard.writeText(cell.textContent.trim()).then(() => {
      const prev = cell.title;
      cell.title = 'Copied!';
      setTimeout(() => {
        cell.title = prev;
      }, 1500);
    });
  });

  const THEME_KEY = 'wallet-hunter-theme';

  function applyTheme(theme) {
    const next = theme === 'classic' ? 'classic' : 'modern';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);

    document.querySelectorAll('.theme-segment-btn').forEach((btn) => {
      const active = btn.dataset.themeValue === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'modern';
    applyTheme(saved);

    document.querySelectorAll('.theme-segment-btn').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.themeValue));
    });
  }

  function initConfigModal() {
    const modal = document.getElementById('config-modal');
    const form = document.getElementById('config-form');
    const statusEl = document.getElementById('config-status');
    const openBtn = document.getElementById('open-config');
    const closeBtn = document.getElementById('close-config');
    const cancelBtn = document.getElementById('cancel-config');
    const configTabs = modal?.querySelectorAll('.config-tab');
    const configPanels = modal?.querySelectorAll('.config-panel');

    if (!modal || !form) return;

    const fields = ['HOST_EMAIL', 'USER_MAIL', 'USER_RECIPIENT'];
    let activeConfigTab = 'email';

    function setStatus(message, type) {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.className = 'config-status' + (type ? ` ${type}` : '');
    }

    function isValidEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    }

    function validateEmailPayload(payload, hasPassword = false) {
      const errors = [];

      if (!String(payload.HOST_EMAIL || '').trim()) {
        errors.push('HOST_EMAIL is required.');
      }

      if (!String(payload.USER_MAIL || '').trim()) {
        errors.push('USER_MAIL is required.');
      } else if (!isValidEmail(payload.USER_MAIL)) {
        errors.push('USER_MAIL must be a valid email.');
      }

      if (!String(payload.USER_RECIPIENT || '').trim()) {
        errors.push('USER_RECIPIENT is required.');
      } else if (!isValidEmail(payload.USER_RECIPIENT)) {
        errors.push('USER_RECIPIENT must be a valid email.');
      }

      if (!String(payload.PASSWORD_EMAIL || '').trim() && !hasPassword) {
        errors.push('PASSWORD_EMAIL is required.');
      }

      return errors;
    }

    function validateRpcPayload(payload) {
      const errors = [];
      const ethLines = String(payload.eth || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const bnbLines = String(payload.bnb || '').split('\n').map((line) => line.trim()).filter(Boolean);

      if (!ethLines.length) errors.push('ETH: at least one RPC URL is required.');
      if (!bnbLines.length) errors.push('BNB: at least one RPC URL is required.');

      for (const url of [...ethLines, ...bnbLines]) {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            errors.push(`Invalid protocol in ${url}`);
          }
        } catch {
          errors.push(`Invalid URL ${url}`);
        }
      }

      return errors;
    }

    function updatePasswordPlaceholder(hasPassword) {
      const passwordInput = document.getElementById('cfg-PASSWORD_EMAIL');
      if (!passwordInput) return;
      passwordInput.placeholder = hasPassword
        ? 'Leave blank to keep current'
        : 'Required';
    }

    function activateConfigTab(tabId) {
      activeConfigTab = tabId;

      configTabs?.forEach((tab) => {
        const active = tab.dataset.configTab === tabId;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      configPanels?.forEach((panel) => {
        const active = panel.id === `config-panel-${tabId}`;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });

      setStatus('');
    }

    async function loadEmailConfig() {
      const res = await fetch('/api/config/env');
      if (!res.ok) throw new Error('Could not load email settings');
      const data = await res.json();

      for (const key of fields) {
        const input = document.getElementById(`cfg-${key}`);
        if (input) input.value = data.config?.[key] ?? '';
      }

      const passwordInput = document.getElementById('cfg-PASSWORD_EMAIL');
      if (passwordInput) {
        passwordInput.value = data.config?.PASSWORD_EMAIL ?? '';
        passwordInput.dataset.hasPassword = data.hasPassword ? 'true' : 'false';
      }

      updatePasswordPlaceholder(Boolean(data.hasPassword));

      if (activeConfigTab === 'email' && data.note) {
        setStatus(data.note);
      }

      return data;
    }

    async function loadRpcConfig() {
      const res = await fetch('/api/config/rpc');
      if (!res.ok) throw new Error('Could not load RPC settings');
      const data = await res.json();

      const ethInput = document.getElementById('cfg-rpc-eth');
      const bnbInput = document.getElementById('cfg-rpc-bnb');
      if (ethInput) ethInput.value = (data.eth || []).join('\n');
      if (bnbInput) bnbInput.value = (data.bnb || []).join('\n');

      if (activeConfigTab === 'rpc' && data.note) {
        setStatus(data.note);
      }

      return data;
    }

    async function loadConfig() {
      try {
        await Promise.all([loadEmailConfig(), loadRpcConfig()]);
      } catch (err) {
        setStatus(err.message || 'Load failed', 'err');
      }
    }

    function openModal() {
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      activateConfigTab('email');
      loadConfig();
    }

    function closeModal() {
      modal.hidden = true;
      document.body.style.overflow = '';
      setStatus('');
    }

    configTabs?.forEach((tab) => {
      tab.addEventListener('click', async () => {
        activateConfigTab(tab.dataset.configTab);
        try {
          if (tab.dataset.configTab === 'email') {
            await loadEmailConfig();
          } else {
            await loadRpcConfig();
          }
        } catch (err) {
          setStatus(err.message || 'Load failed', 'err');
        }
      });
    });

    openBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('Saving…');

      try {
        if (activeConfigTab === 'email') {
          const payload = {};
          for (const key of [...fields, 'PASSWORD_EMAIL']) {
            const input = document.getElementById(`cfg-${key}`);
            if (input) payload[key] = input.value;
          }

          const clientErrors = validateEmailPayload(
            payload,
            document.getElementById('cfg-PASSWORD_EMAIL')?.dataset.hasPassword === 'true'
          );
          if (clientErrors.length) {
            setStatus(clientErrors.join(' '), 'err');
            return;
          }

          const res = await fetch('/api/config/env', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Save failed');

          setStatus(data.note || 'Settings saved.', 'ok');
          updatePasswordPlaceholder(Boolean(data.hasPassword));

          const passwordInput = document.getElementById('cfg-PASSWORD_EMAIL');
          if (passwordInput) {
            passwordInput.value = data.config?.PASSWORD_EMAIL ?? passwordInput.value;
            passwordInput.dataset.hasPassword = data.hasPassword ? 'true' : 'false';
          }
          return;
        }

        const eth = document.getElementById('cfg-rpc-eth')?.value || '';
        const bnb = document.getElementById('cfg-rpc-bnb')?.value || '';
        const clientErrors = validateRpcPayload({ eth, bnb });
        if (clientErrors.length) {
          setStatus(clientErrors.join(' '), 'err');
          return;
        }

        const res = await fetch('/api/config/rpc', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eth, bnb }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        setStatus(data.note || 'RPC settings saved.', 'ok');
        await refreshStats();
      } catch (err) {
        setStatus(err.message || 'Save failed', 'err');
      }
    });
  }

  function initGuideModal() {
    const modal = document.getElementById('guide-modal');
    const openBtn = document.getElementById('open-guide');
    const closeBtn = document.getElementById('close-guide');
    const closeBottomBtn = document.getElementById('close-guide-bottom');
    const docTabs = modal?.querySelectorAll('.doc-tab');
    const docPanels = modal?.querySelectorAll('.doc-panel');

    if (!modal) return;

    function activateDocTab(tabId) {
      docTabs?.forEach((tab) => {
        const active = tab.dataset.docTab === tabId;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      docPanels?.forEach((panel) => {
        const active = panel.id === `doc-panel-${tabId}`;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
    }

    function openModal() {
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      activateDocTab('overview');
    }

    function closeModal() {
      modal.hidden = true;
      document.body.style.overflow = '';
    }

    docTabs?.forEach((tab) => {
      tab.addEventListener('click', () => {
        activateDocTab(tab.dataset.docTab);
      });
    });

    openBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    closeBottomBtn?.addEventListener('click', closeModal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  async function init() {
    initTheme();
    initGuideModal();
    initConfigModal();
    initFindingCelebrationModal();
    connectWebSocket();
    await refreshStatus();
    await refreshStats();
    await loadFindings();

    for (const jobKey of [...GENERATE_JOBS, ...SCAN_JOBS]) {
      await loadHistory(jobKey);
    }

    setInterval(refreshStats, 5000);
  }

  init();
})();
