#!/usr/bin/env node
'use strict';

const puppeteer = require('puppeteer-core');

const MINUTE = 60_000;

function log(level, message, meta) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  const output = meta ? `${line} ${JSON.stringify(meta)}` : line;
  if (level === 'ERROR' || level === 'WARN') {
    console.error(output);
  } else {
    console.log(output);
  }
}

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}"`);
  }
  return value;
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

let CONFIG;
try {
  CONFIG = {
    dashboardUrl: process.env.DASHBOARD_URL || 'https://www.upwork.com/nx/find-work/',
    cdpUrl: process.env.CDP_URL || 'http://127.0.0.1:9222',
    minMinutes: readNumber('MIN_MINUTES', 4),
    maxMinutes: readNumber('MAX_MINUTES', 9),
    reloadTimeoutMs: readNumber('RELOAD_TIMEOUT_MS', 60_000),
    reconnectDelayMs: readNumber('RECONNECT_DELAY_MS', 15_000),
    maxReconnectAttempts: readNumber('MAX_RECONNECT_ATTEMPTS', 0),
    loginWaitMinutes: readNumber('LOGIN_WAIT_MINUTES', 10),
    focusTab: readBool('FOCUS_TAB', false),
  };
} catch (error) {
  log('ERROR', 'Invalid environment configuration', { error: error.message });
  process.exit(1);
}

let browser = null;
let page = null;
let stopping = false;
let sleepTimer = null;
let sleepResolve = null;
let reconnectAttempts = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepInterruptible(ms) {
  return new Promise((resolve) => {
    sleepResolve = resolve;
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      sleepResolve = null;
      resolve();
    }, ms);
  });
}

function wakeFromSleep() {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  if (sleepResolve) {
    const resolve = sleepResolve;
    sleepResolve = null;
    resolve();
  }
}

function humanIntervalMs() {
  const min = CONFIG.minMinutes * MINUTE;
  const max = CONFIG.maxMinutes * MINUTE;
  if (max <= min) return Math.round(min);

  // Average of two uniform samples gives a triangular distribution centered
  // between min and max, which avoids an obvious fixed cadence.
  const sample = (Math.random() + Math.random()) / 2;
  return Math.round(min + sample * (max - min));
}

function formatMinutes(ms) {
  return (ms / MINUTE).toFixed(1);
}

function sameDashboard(currentUrl, targetUrl) {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    const normalizePath = (path) => path.replace(/\/+$/, '') || '/';
    return (
      current.hostname === target.hostname &&
      normalizePath(current.pathname) === normalizePath(target.pathname)
    );
  } catch {
    return false;
  }
}

function looksLoggedOut(url) {
  const loginPattern = /login|signin|sign-in|account-security/i;
  return loginPattern.test(url) && !loginPattern.test(CONFIG.dashboardUrl);
}

function connectionHint(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|Failed to fetch browser webSocket URL|Could not connect|Connection closed|socket hang up/i.test(message)) {
    return null;
  }

  return [
    `Could not reach Chrome at ${CONFIG.cdpUrl}.`,
    'Start Chrome with remote debugging enabled, then log in once in that window:',
    '',
    '  macOS:',
    '    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\',
    '      --remote-debugging-port=9222 \\',
    '      --user-data-dir="$HOME/.chrome-debug-profile"',
    '',
    '  Linux:',
    '    google-chrome --remote-debugging-port=9222 \\',
    '      --user-data-dir="$HOME/.chrome-debug-profile"',
    '',
    '  Windows (PowerShell):',
    '    & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" `',
    '      --remote-debugging-port=9222 `',
    '      --user-data-dir="$env:USERPROFILE\\.chrome-debug-profile"',
    '',
    'Chrome 136+ ignores the debugging port with the default profile, so the',
    '--user-data-dir flag is required. The login session persists in that profile.',
  ].join('\n');
}

async function connectToChrome() {
  log('INFO', 'Connecting to Chrome via CDP', { cdpUrl: CONFIG.cdpUrl });
  const connected = await puppeteer.connect({
    browserURL: CONFIG.cdpUrl,
    defaultViewport: null,
  });

  connected.on('disconnected', () => {
    if (stopping) return;
    log('WARN', 'Chrome disconnected. Will attempt to reconnect.');
    browser = null;
    page = null;
  });

  const version = await connected.version().catch(() => 'unknown');
  log('INFO', 'Connected to Chrome', { browser: version });
  return connected;
}

async function findOrCreatePage() {
  const pages = await browser.pages();
  const existing = pages.find(
    (candidate) => !candidate.isClosed() && sameDashboard(candidate.url(), CONFIG.dashboardUrl)
  );

  if (existing) {
    log('INFO', 'Reusing existing dashboard tab', { url: existing.url() });
    return existing;
  }

  log('INFO', 'Opening dashboard tab', { url: CONFIG.dashboardUrl });
  const newPage = await browser.newPage();
  await newPage.goto(CONFIG.dashboardUrl, {
    waitUntil: 'domcontentloaded',
    timeout: CONFIG.reloadTimeoutMs,
  });
  return newPage;
}

async function ensureConnection() {
  if (browser && browser.connected) {
    if (!page || page.isClosed()) {
      page = await findOrCreatePage();
    }
    return;
  }

  browser = await connectToChrome();
  page = await findOrCreatePage();
  reconnectAttempts = 0;
}

async function waitForLoginIfNeeded() {
  if (!looksLoggedOut(page.url())) return;

  log('WARN', 'Login required. Log in in the Chrome window; waiting before refreshing.', {
    url: page.url(),
    waitMinutes: CONFIG.loginWaitMinutes,
  });

  const deadline = Date.now() + CONFIG.loginWaitMinutes * MINUTE;
  while (!stopping && Date.now() < deadline) {
    await sleepInterruptible(3000);
    if (stopping) return;

    if (!page || page.isClosed()) {
      page = await findOrCreatePage();
    }
    if (!looksLoggedOut(page.url())) {
      log('INFO', 'Login detected. Resuming dashboard refreshes.', { url: page.url() });
      return;
    }
  }

  if (!stopping) {
    log('WARN', 'Still on a login page. Refreshing will continue; log in when ready.');
  }
}

async function refreshDashboard() {
  if (!browser || !browser.connected) {
    throw new Error('Browser is not connected');
  }
  if (!page || page.isClosed()) {
    page = await findOrCreatePage();
  }

  if (CONFIG.focusTab) {
    await page.bringToFront().catch(() => {});
  }

  const preRefreshDelay = 500 + Math.random() * 2500;
  log('INFO', 'Waiting briefly before refresh', {
    delaySeconds: Number((preRefreshDelay / 1000).toFixed(1)),
  });
  await sleep(preRefreshDelay);
  await waitForLoginIfNeeded();
  if (stopping) return;

  const startedAt = Date.now();
  await page.reload({
    waitUntil: 'domcontentloaded',
    timeout: CONFIG.reloadTimeoutMs,
  });
  const elapsedMs = Date.now() - startedAt;
  const currentUrl = page.url();

  log('INFO', 'Dashboard refreshed', { elapsedMs, url: currentUrl });

  if (looksLoggedOut(currentUrl)) {
    log('WARN', 'The tab appears to be logged out. Log in manually in the Chrome window; refreshing will continue.');
  }
}

function validateConfig() {
  let parsedUrl;
  try {
    parsedUrl = new URL(CONFIG.dashboardUrl);
  } catch {
    throw new Error(`DASHBOARD_URL is not a valid URL: ${CONFIG.dashboardUrl}`);
  }

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error('DASHBOARD_URL must use http:// or https://');
  }
  if (!/^https?:\/\//i.test(CONFIG.cdpUrl)) {
    throw new Error('CDP_URL must be an http:// URL (for example http://127.0.0.1:9222)');
  }
  if (CONFIG.minMinutes < 1) {
    throw new Error('MIN_MINUTES must be at least 1');
  }
  if (CONFIG.maxMinutes < CONFIG.minMinutes) {
    throw new Error('MAX_MINUTES must be greater than or equal to MIN_MINUTES');
  }
  if (CONFIG.reloadTimeoutMs <= 0 || CONFIG.reconnectDelayMs <= 0) {
    throw new Error('Timeout and reconnect delay values must be positive');
  }
  if (CONFIG.maxReconnectAttempts < 0) {
    throw new Error('MAX_RECONNECT_ATTEMPTS must be 0 (unlimited) or greater');
  }
  if (CONFIG.loginWaitMinutes <= 0) {
    throw new Error('LOGIN_WAIT_MINUTES must be greater than 0');
  }
  if (CONFIG.minMinutes < 2) {
    log('WARN', 'Intervals below 2 minutes may trigger rate limits or appear abusive.');
  }
  if (CONFIG.maxMinutes === CONFIG.minMinutes) {
    log('WARN', 'MIN_MINUTES equals MAX_MINUTES; the interval will not be randomized.');
  }
}

async function run() {
  validateConfig();

  log('INFO', 'Session keep-alive starting', {
    dashboardUrl: CONFIG.dashboardUrl,
    cdpUrl: CONFIG.cdpUrl,
    intervalMinutes: `${CONFIG.minMinutes}-${CONFIG.maxMinutes}`,
  });

  while (!stopping) {
    try {
      await ensureConnection();
      await refreshDashboard();
      reconnectAttempts = 0;
    } catch (error) {
      log('ERROR', 'Refresh cycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      const hint = connectionHint(error);
      if (hint) console.error(hint);
      if (stopping) break;

      reconnectAttempts += 1;
      if (CONFIG.maxReconnectAttempts > 0 && reconnectAttempts >= CONFIG.maxReconnectAttempts) {
        throw new Error(`Giving up after ${reconnectAttempts} failed attempt(s)`);
      }

      log('INFO', `Retrying in ${(CONFIG.reconnectDelayMs / 1000).toFixed(0)}s`, {
        attempt: reconnectAttempts,
      });
      await sleepInterruptible(CONFIG.reconnectDelayMs);
      continue;
    }

    if (stopping) break;

    const delay = humanIntervalMs();
    log('INFO', `Next refresh in ${formatMinutes(delay)} min`, {
      scheduledFor: new Date(Date.now() + delay).toISOString(),
    });
    await sleepInterruptible(delay);
  }
}

async function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;

  log('INFO', `Received ${signal}. Shutting down gracefully.`);
  wakeFromSleep();

  if (browser && browser.connected) {
    try {
      await browser.disconnect();
      log('INFO', 'Disconnected from Chrome. The browser window was left open.');
    } catch (error) {
      log('WARN', 'Could not disconnect cleanly', { error: error.message });
    }
  }

  process.exit(exitCode);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      log('ERROR', 'Shutdown failed', { error: error.message });
      process.exit(1);
    });
  });
}

process.on('unhandledRejection', (reason) => {
  log('ERROR', 'Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error) => {
  log('ERROR', 'Uncaught exception', { error: error.message });
  shutdown('uncaughtException', 1);
});

run().catch((error) => {
  log('ERROR', 'Fatal error', { error: error.message });
  shutdown('fatal error', 1);
});
