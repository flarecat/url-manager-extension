document.addEventListener('DOMContentLoaded', init);

let scope = 'current'; // 'current' | 'all'

function init() {
  document.getElementById('scope-current').addEventListener('click', () => setScope('current'));
  document.getElementById('scope-all').addEventListener('click', () => setScope('all'));
  document.getElementById('copy-all').addEventListener('click', copyAllUrls);
  document.getElementById('copy-current').addEventListener('click', copyCurrentTabUrl);
  document.getElementById('restore').addEventListener('click', restoreFromClipboard);
  document.getElementById('sort-by-url').addEventListener('click', sortTabsByUrl);
  document.getElementById('close-duplicates').addEventListener('click', closeDuplicateTabs);
  document.getElementById('close-others').addEventListener('click', closeOtherTabs);
  renderTabList();
}

function setScope(newScope) {
  scope = newScope;
  document.getElementById('scope-current').classList.toggle('active', scope === 'current');
  document.getElementById('scope-all').classList.toggle('active', scope === 'all');
  renderTabList();
}

function queryTabs() {
  return scope === 'current'
    ? chrome.tabs.query({ currentWindow: true })
    : chrome.tabs.query({});
}

function filterUrls(tabs) {
  return tabs
    .map(t => t.url)
    .filter(url => url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://'));
}

async function copyAllUrls() {
  const tabs = await queryTabs();
  const urls = filterUrls(tabs);
  await navigator.clipboard.writeText(urls.join('\n'));
  showStatus(`${urls.length}個のURLをコピーしました`);
}

async function copyCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    await navigator.clipboard.writeText(tab.url);
    showStatus('URLをコピーしました');
  }
}

async function restoreFromClipboard() {
  const text = await navigator.clipboard.readText();
  const urls = extractUrls(text);
  if (urls.length === 0) {
    showStatus('クリップボードにURLが見つかりません', 'error');
    return;
  }
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }
  showStatus(`${urls.length}個のタブを開きました`);
}

async function sortTabsByUrl() {
  const tabs = await queryTabs();

  // Group by groupId (-1 = ungrouped)
  const groups = new Map();
  for (const tab of tabs) {
    const key = `${tab.windowId}:${tab.groupId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }

  // Sort within each group/ungrouped chunk, then move in place
  for (const chunk of groups.values()) {
    const sorted = [...chunk].sort((a, b) => (a.url || '').localeCompare(b.url || ''));
    // Use the original positions of the chunk to place sorted tabs
    const indices = chunk.map(t => t.index).sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      await chrome.tabs.move(sorted[i].id, { index: indices[i] });
    }
  }

  showStatus('タブをURL順に並び替えました');
  renderTabList();
}

async function closeDuplicateTabs() {
  const tabs = await queryTabs();
  const seen = new Set();
  const duplicateIds = [];
  for (const tab of tabs) {
    if (seen.has(tab.url)) {
      duplicateIds.push(tab.id);
    } else {
      seen.add(tab.url);
    }
  }
  if (duplicateIds.length === 0) {
    showStatus('重複タブはありません');
    return;
  }
  await chrome.tabs.remove(duplicateIds);
  showStatus(`重複タブを${duplicateIds.length}個閉じました`);
  renderTabList();
}

async function closeOtherTabs() {
  if (!confirm('他のタブを全て閉じますか？')) return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const otherIds = tabs.filter(t => t.id !== activeTab.id).map(t => t.id);
  if (otherIds.length === 0) {
    showStatus('他にタブはありません');
    return;
  }
  await chrome.tabs.remove(otherIds);
  showStatus(`${otherIds.length}個のタブを閉じました`);
  renderTabList();
}

async function renderTabList() {
  const section = document.getElementById('tab-section');
  section.innerHTML = '';

  const currentWindow = await chrome.windows.getCurrent();
  const allTabs = await chrome.tabs.query({});

  // Group tabs by windowId
  const windowMap = new Map();
  for (const tab of allTabs) {
    if (!windowMap.has(tab.windowId)) windowMap.set(tab.windowId, []);
    windowMap.get(tab.windowId).push(tab);
  }

  // Sort: current window first, then by windowId
  const windowIds = [...windowMap.keys()].sort((a, b) => {
    if (a === currentWindow.id) return -1;
    if (b === currentWindow.id) return 1;
    return a - b;
  });

  // Total count
  const totalTabs = scope === 'current' ? (windowMap.get(currentWindow.id) || []).length : allTabs.length;
  const countEl = document.createElement('p');
  countEl.className = 'tab-count';
  countEl.textContent = `開いているタブ: ${totalTabs}個`;
  section.appendChild(countEl);

  const windowsToShow = scope === 'current' ? [currentWindow.id] : windowIds;

  for (const winId of windowsToShow) {
    const tabs = windowMap.get(winId) || [];
    const group = document.createElement('div');
    group.className = 'window-group';

    // Window label (show only in all-windows mode)
    if (scope === 'all') {
      const label = document.createElement('div');
      label.className = 'window-label';
      const isCurrent = winId === currentWindow.id;
      label.innerHTML = `${isCurrent ? '現在のウィンドウ' : 'ウィンドウ'}<span class="badge">${tabs.length}個</span>`;
      group.appendChild(label);
    }

    const list = document.createElement('div');
    list.className = 'tab-list';

    for (const tab of tabs) {
      const item = document.createElement('div');
      item.className = 'tab-item';

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || '(無題)';

      const url = document.createElement('span');
      url.className = 'tab-url';
      url.textContent = tab.url || '';

      item.appendChild(title);
      item.appendChild(url);
      item.addEventListener('click', () => {
        chrome.windows.update(tab.windowId, { focused: true });
        chrome.tabs.update(tab.id, { active: true });
        window.close();
      });
      list.appendChild(item);
    }

    group.appendChild(list);
    section.appendChild(group);
  }
}

function extractUrls(text) {
  const urlPattern = /^https?:\/\/\S+/;
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split(/\t/);
      const candidate = parts[parts.length - 1].trim();
      if (urlPattern.test(candidate)) return candidate;
      if (urlPattern.test(line)) return line;
      return null;
    })
    .filter(Boolean);
}

let statusTimer = null;

function showStatus(message, type = 'success') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = `status visible ${type}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.classList.remove('visible');
  }, 3000);
}
