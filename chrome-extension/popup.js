'use strict';

const $ = (id) => document.getElementById(id);

let currentTab = null;

function isUpwork(url) {
  return /^https:\/\/([a-z0-9-]+\.)*upwork\.com\//i.test(url || '');
}

function isLoginPage(url) {
  return /login|signin|sign-in|account-security/i.test(url || '');
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.round((timestamp - Date.now()) / 1000));
  if (seconds <= 0) return 'any moment';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'status' });
  currentTab = await getActiveTab();

  $('status').textContent = state.status || (state.active ? 'Running' : 'Stopped');
  $('status').className = state.active ? 'status ok' : 'status';

  $('tab').textContent = currentTab ? currentTab.url || '' : 'No active tab';
  $('min').value = state.minMinutes ?? 2;
  $('max').value = state.maxMinutes ?? 5;
  $('next').textContent =
    state.active && state.nextReload ? `Next refresh in ${formatTime(state.nextReload)}` : '';

  $('start').disabled = !currentTab || !isUpwork(currentTab.url);
  $('stop').disabled = !state.active;

  if (!currentTab) {
    $('message').textContent = 'Open an Upwork dashboard tab first.';
  } else if (!isUpwork(currentTab.url)) {
    $('message').textContent = 'Open an Upwork dashboard tab first.';
  } else if (isLoginPage(currentTab.url)) {
    $('message').textContent = 'This looks like a login page. Log in; the extension will wait.';
  } else {
    $('message').textContent = '';
  }
}

$('start').addEventListener('click', async () => {
  if (!currentTab) return;

  const min = Number($('min').value);
  const max = Number($('max').value);

  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < 1) {
    $('message').textContent = 'Enter valid minute values.';
    return;
  }
  if (max < min) {
    $('message').textContent = 'Max minutes must be greater than or equal to min minutes.';
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: 'start',
    tabId: currentTab.id,
    minMinutes: min,
    maxMinutes: max,
  });

  if (!result || !result.ok) {
    $('message').textContent = (result && result.error) || 'Could not start.';
    return;
  }

  await refresh();
});

$('stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop' });
  await refresh();
});

refresh();
setInterval(refresh, 1000);
