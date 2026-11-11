'use strict';

const ALARM_NAME = 'dashboard-keepalive';
const DASHBOARD_URL = 'https://www.upwork.com/nx/find-work/';

const DEFAULT_STATE = {
  active: false,
  tabId: null,
  minMinutes: 2,
  maxMinutes: 5,
  lastReload: null,
  nextReload: null,
  status: 'Stopped',
};

async function getState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...stored };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
  return getState();
}

function randomMinutes(minMinutes, maxMinutes) {
  const min = Math.max(1, Number(minMinutes) || 2);
  const max = Math.max(min, Number(maxMinutes) || 5);
  const sample = (Math.random() + Math.random()) / 2;
  return min + sample * (max - min);
}

function looksLoggedOut(url) {
  return /login|signin|sign-in|account-security/i.test(url || '');
}

function isUpwork(url) {
  return /^https:\/\/([a-z0-9-]+\.)*upwork\.com\//i.test(url || '');
}

async function scheduleNext(minutes) {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: minutes });
}

async function findDashboardTab() {
  const dashboardTabs = await chrome.tabs.query({
    url: ['https://www.upwork.com/nx/find-work/*'],
  });
  const dashboard = dashboardTabs.find(
    (tab) => tab.id != null && !looksLoggedOut(tab.url)
  );
  if (dashboard) return dashboard;

  const tabs = await chrome.tabs.query({
    url: ['https://www.upwork.com/*', 'https://*.upwork.com/*'],
  });
  return tabs.find((tab) => tab.id != null && !looksLoggedOut(tab.url)) || tabs[0] || null;
}

async function startOnTab(tabId, minMinutes, maxMinutes) {
  const tab = await chrome.tabs.get(tabId);
  const loggedOut = looksLoggedOut(tab.url);
  const next = loggedOut ? 1 : randomMinutes(minMinutes, maxMinutes);

  await setState({
    active: true,
    tabId: tab.id,
    minMinutes,
    maxMinutes,
    status: loggedOut ? 'Waiting for login' : 'Running',
    lastReload: null,
    nextReload: Date.now() + next * 60_000,
  });
  await scheduleNext(next);
  return tab;
}

async function autoStart() {
  const state = await getState();
  if (state.active) return;

  const existing = await findDashboardTab();
  if (existing) {
    await startOnTab(existing.id, state.minMinutes, state.maxMinutes);
    return;
  }

  const tab = await chrome.tabs.create({ url: DASHBOARD_URL, active: true });
  await startOnTab(tab.id, state.minMinutes, state.maxMinutes);
}

async function runCycle() {
  let state = await getState();
  if (!state.active) return;

  let tab = null;
  try {
    tab = await chrome.tabs.get(state.tabId);
  } catch {
    tab = null;
  }

  if (!tab || !isUpwork(tab.url)) {
    const replacement = await findDashboardTab();
    if (replacement) {
      tab = replacement;
      state = await setState({ tabId: tab.id });
    } else {
      try {
        tab = await chrome.tabs.create({ url: DASHBOARD_URL, active: false });
        state = await setState({ tabId: tab.id, status: 'Running' });
      } catch (error) {
        await chrome.alarms.clear(ALARM_NAME);
        await setState({
          active: false,
          status: `Stopped: ${error.message || error}`,
          nextReload: null,
        });
        return;
      }
    }
  }

  if (looksLoggedOut(tab.url)) {
    await setState({
      status: 'Waiting for login',
      nextReload: Date.now() + 60_000,
    });
    await scheduleNext(1);
    return;
  }

  try {
    await new Promise((resolve, reject) => {
      chrome.tabs.reload(tab.id, { bypassCache: false }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve();
        }
      });
    });
    await setState({ lastReload: Date.now(), status: 'Running' });
  } catch (error) {
    await setState({ status: `Reload failed: ${error.message || error}` });
  }

  const minutes = randomMinutes(state.minMinutes, state.maxMinutes);
  await setState({ nextReload: Date.now() + minutes * 60_000 });
  await scheduleNext(minutes);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  runCycle().catch(async (error) => {
    await setState({ status: `Error: ${error.message || error}` });
    await scheduleNext(1);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'status') {
    getState().then(sendResponse);
    return true;
  }

  if (message.type === 'start') {
    (async () => {
      const min = Math.max(1, Math.min(60, Number(message.minMinutes) || 2));
      const max = Math.max(min, Math.min(60, Number(message.maxMinutes) || 5));
      await startOnTab(message.tabId, min, max);
      sendResponse({ ok: true });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }

  if (message.type === 'stop') {
    (async () => {
      await chrome.alarms.clear(ALARM_NAME);
      await setState({ active: false, status: 'Stopped', nextReload: null });
      sendResponse({ ok: true });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }

  return false;
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (!state.active) return;

  const minutes = randomMinutes(state.minMinutes, state.maxMinutes);
  await setState({ nextReload: Date.now() + minutes * 60_000 });
  await scheduleNext(minutes);
});

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['active', 'minMinutes', 'maxMinutes']);
  if (existing.active === undefined) {
    await chrome.storage.local.set(DEFAULT_STATE);
  } else if (existing.minMinutes === 4 && existing.maxMinutes === 9) {
    await chrome.storage.local.set({ minMinutes: 2, maxMinutes: 5 });
  }
  await autoStart();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (!state.active || state.tabId !== tabId) return;

  const replacement = await findDashboardTab();
  if (replacement) {
    await setState({ tabId: replacement.id, status: 'Running' });
    return;
  }

  try {
    const newTab = await chrome.tabs.create({ url: DASHBOARD_URL, active: false });
    await setState({ tabId: newTab.id, status: 'Running' });
  } catch (error) {
    await chrome.alarms.clear(ALARM_NAME);
    await setState({
      active: false,
      status: `Stopped: ${error.message || error}`,
      nextReload: null,
    });
  }
});
