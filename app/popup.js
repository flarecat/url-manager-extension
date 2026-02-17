document.addEventListener('DOMContentLoaded', init);

const isSidePanel = document.body.classList.contains('sidepanel');
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
  document.getElementById('fav-save-btn').addEventListener('click', saveFavorite);
  document.getElementById('fav-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveFavorite();
  });
  document.getElementById('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  const openSidePanelBtn = document.getElementById('open-sidepanel');
  if (openSidePanelBtn) {
    openSidePanelBtn.addEventListener('click', openSidePanel);
  }
  renderFavorites();
  renderTabList();

  // Side panel: auto-refresh on tab changes (debounced)
  if (isSidePanel) {
    let refreshTimer = null;
    const debouncedRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(renderTabList, 300);
    };
    chrome.tabs.onCreated.addListener(debouncedRefresh);
    chrome.tabs.onRemoved.addListener(debouncedRefresh);
    chrome.tabs.onMoved.addListener(debouncedRefresh);
    chrome.tabs.onUpdated.addListener(debouncedRefresh);
    chrome.tabs.onActivated.addListener(debouncedRefresh);
    chrome.windows.onFocusChanged.addListener(debouncedRefresh);
  }
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

// --- Accordion state (persists across re-renders) ---
// Keys: "window:<id>" or "tabgroup:<id>", Values: true=expanded
const accordionState = new Map();

// --- Tab group info cache ---
const tabGroupCache = new Map();

async function getTabGroupInfo(groupId) {
  if (groupId === -1 || groupId === undefined) return null;
  if (tabGroupCache.has(groupId)) return tabGroupCache.get(groupId);
  try {
    const info = await chrome.tabGroups.get(groupId);
    tabGroupCache.set(groupId, info);
    return info;
  } catch {
    return null;
  }
}

async function renderTabList() {
  const section = document.getElementById('tab-section');
  section.innerHTML = '';
  tabGroupCache.clear();

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
    group.dataset.windowId = winId;

    const winKey = `window:${winId}`;
    const winExpanded = accordionState.get(winKey) ?? false;

    // Window label (show only in all-windows mode)
    if (scope === 'all') {
      const label = document.createElement('div');
      const isCurrent = winId === currentWindow.id;
      label.className = `window-label${isCurrent ? ' current' : ''}`;
      label.dataset.windowId = winId;
      label.innerHTML = `<span class="accordion-arrow${winExpanded ? ' expanded' : ''}">▶</span>${isCurrent ? '📌 現在のウィンドウ' : '🪟 ウィンドウ'}<span class="badge">${tabs.length}個</span>`;
      label.style.cursor = 'pointer';
      // Drop on window header -> append to end of that window
      setupWindowLabelDrop(label, winId);
      label.addEventListener('click', () => {
        accordionState.set(winKey, !accordionState.get(winKey));
        renderTabList();
      });
      group.appendChild(label);
    }

    const list = document.createElement('div');
    list.className = 'tab-list';
    list.dataset.windowId = winId;

    // In all-windows mode, hide list if collapsed
    if (scope === 'all' && !winExpanded) {
      list.classList.add('collapsed');
    }

    // Sub-group tabs by their Chrome tab group
    const tabsByGroup = groupTabsByTabGroup(tabs);

    for (const chunk of tabsByGroup) {
      // Render tab group header if applicable
      if (chunk.groupId !== -1) {
        const grpKey = `tabgroup:${chunk.groupId}`;
        const grpExpanded = accordionState.get(grpKey) ?? false;
        const groupInfo = await getTabGroupInfo(chunk.groupId);

        const container = document.createElement('div');
        container.className = `tab-group-section tab-group-color-${groupInfo?.color || 'grey'}`;

        const header = document.createElement('div');
        header.className = `tab-group-header tab-group-color-${groupInfo?.color || 'grey'}`;
        header.dataset.groupId = chunk.groupId;
        header.style.cursor = 'pointer';
        header.innerHTML = `<span class="accordion-arrow${grpExpanded ? ' expanded' : ''}">▶</span><span class="group-dot"></span>${groupInfo?.title || 'グループ'}<span class="group-badge">${chunk.tabs.length}個</span>`;
        setupTabGroupHeaderDrop(header, chunk.groupId);
        header.addEventListener('click', () => {
          accordionState.set(grpKey, !accordionState.get(grpKey));
          renderTabList();
        });
        container.appendChild(header);

        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'tab-group-tabs';
        if (!grpExpanded) tabsContainer.classList.add('collapsed');

        for (const tab of chunk.tabs) {
          tabsContainer.appendChild(createTabItem(tab));
        }
        container.appendChild(tabsContainer);
        list.appendChild(container);
      } else {
        for (const tab of chunk.tabs) {
          list.appendChild(createTabItem(tab));
        }
      }
    }

    group.appendChild(list);
    section.appendChild(group);
  }

  // "New window" drop zone
  const newWinZone = document.createElement('div');
  newWinZone.className = 'drop-zone-new-window';
  newWinZone.id = 'drop-zone-new-window';
  newWinZone.textContent = '↗ 新しいウィンドウに移動';
  setupNewWindowDrop(newWinZone);
  section.appendChild(newWinZone);
}

function groupTabsByTabGroup(tabs) {
  const chunks = [];
  let current = null;
  for (const tab of tabs) {
    const gid = tab.groupId ?? -1;
    if (!current || current.groupId !== gid) {
      current = { groupId: gid, tabs: [] };
      chunks.push(current);
    }
    current.tabs.push(tab);
  }
  return chunks;
}

function createTabItem(tab) {
  const item = document.createElement('div');
  item.className = 'tab-item';
  if (tab.active) item.classList.add('active-tab');
  item.dataset.tabId = tab.id;
  item.dataset.windowId = tab.windowId;
  item.dataset.index = tab.index;
  item.draggable = true;

  // Favicon
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = tab.favIconUrl;
    favicon.alt = '';
    favicon.onerror = () => {
      favicon.replaceWith(createFaviconPlaceholder());
    };
    item.appendChild(favicon);
  } else {
    item.appendChild(createFaviconPlaceholder());
  }

  // Tab info (title + url)
  const info = document.createElement('div');
  info.className = 'tab-info';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || '(無題)';

  const url = document.createElement('span');
  url.className = 'tab-url';
  url.textContent = tab.url || '';

  info.appendChild(title);
  info.appendChild(url);
  item.appendChild(info);

  // Click to activate tab
  item.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.update(tab.id, { active: true });
    if (!isSidePanel) window.close();
  });

  // D&D events
  setupTabItemDrag(item);

  return item;
}

function createFaviconPlaceholder() {
  const el = document.createElement('div');
  el.className = 'tab-favicon-placeholder';
  return el;
}

// --- Drag & Drop ---

let dragData = null;

function setupTabItemDrag(item) {
  item.addEventListener('dragstart', (e) => {
    dragData = {
      tabId: parseInt(item.dataset.tabId),
      windowId: parseInt(item.dataset.windowId),
      index: parseInt(item.dataset.index),
    };
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.tabId);
    // Show "new window" drop zone
    const zone = document.getElementById('drop-zone-new-window');
    if (zone) zone.classList.add('visible');
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    dragData = null;
    // Hide "new window" drop zone
    const zone = document.getElementById('drop-zone-new-window');
    if (zone) zone.classList.remove('visible');
    // Clean up indicators
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragData || parseInt(item.dataset.tabId) === dragData.tabId) return;

    // Show drop indicator
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';

    // Remove existing indicators in this list
    item.closest('.tab-list')?.querySelectorAll('.drop-indicator').forEach(el => el.remove());

    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    if (position === 'before') {
      item.parentNode.insertBefore(indicator, item);
    } else {
      item.parentNode.insertBefore(indicator, item.nextSibling);
    }
  });

  item.addEventListener('dragleave', () => {
    // Indicators cleaned up on next dragover or dragend
  });

  item.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragData) return;

    const targetTabId = parseInt(item.dataset.tabId);
    const targetWindowId = parseInt(item.dataset.windowId);
    const targetIndex = parseInt(item.dataset.index);
    if (dragData.tabId === targetTabId) return;

    // Determine drop position
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertAfter = e.clientY >= midY;

    let newIndex = insertAfter ? targetIndex + 1 : targetIndex;
    // If moving within same window and from a higher index, adjust
    if (dragData.windowId === targetWindowId && dragData.index < targetIndex) {
      newIndex = Math.max(0, newIndex - 1);
    }

    try {
      if (dragData.windowId === targetWindowId) {
        await chrome.tabs.move(dragData.tabId, { index: newIndex });
      } else {
        await chrome.tabs.move(dragData.tabId, { windowId: targetWindowId, index: newIndex });
      }
      showStatus('タブを移動しました');
    } catch (err) {
      showStatus('移動に失敗しました', 'error');
    }

    dragData = null;
    renderTabList();
  });
}

function setupWindowLabelDrop(label, windowId) {
  label.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    label.classList.add('drag-over');
  });

  label.addEventListener('dragleave', () => {
    label.classList.remove('drag-over');
  });

  label.addEventListener('drop', async (e) => {
    e.preventDefault();
    label.classList.remove('drag-over');
    if (!dragData || dragData.windowId === windowId) return;

    try {
      await chrome.tabs.move(dragData.tabId, { windowId, index: -1 });
      showStatus('タブを別ウィンドウに移動しました');
    } catch {
      showStatus('移動に失敗しました', 'error');
    }

    dragData = null;
    renderTabList();
  });
}

function setupTabGroupHeaderDrop(header, groupId) {
  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    header.classList.add('drag-over');
  });

  header.addEventListener('dragleave', () => {
    header.classList.remove('drag-over');
  });

  header.addEventListener('drop', async (e) => {
    e.preventDefault();
    header.classList.remove('drag-over');
    if (!dragData) return;

    try {
      await chrome.tabs.group({ tabIds: [dragData.tabId], groupId });
      showStatus('タブをグループに移動しました');
    } catch {
      showStatus('グループ移動に失敗しました', 'error');
    }

    dragData = null;
    renderTabList();
  });
}

function setupNewWindowDrop(zone) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (!dragData) return;

    try {
      await chrome.windows.create({ tabId: dragData.tabId });
      showStatus('新しいウィンドウに移動しました');
    } catch {
      showStatus('移動に失敗しました', 'error');
    }

    dragData = null;
    renderTabList();
  });
}

// --- Side panel ---

async function openSidePanel() {
  const currentWindow = await chrome.windows.getCurrent();
  chrome.runtime.sendMessage({ action: 'openSidePanel', windowId: currentWindow.id });
  window.close();
}

// --- Favorites ---

async function saveFavorite() {
  const input = document.getElementById('fav-name');
  const name = input.value.trim();
  if (!name) {
    showStatus('お気に入り名を入力してください', 'error');
    input.focus();
    return;
  }
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const urls = filterUrls(tabs);
  if (urls.length === 0) {
    showStatus('保存できるURLがありません', 'error');
    return;
  }
  const { favorites = [] } = await chrome.storage.sync.get('favorites');
  favorites.push({ name, urls, createdAt: Date.now() });
  await chrome.storage.sync.set({ favorites });
  input.value = '';
  showStatus(`「${name}」を保存しました（${urls.length}個）`);
  renderFavorites();
}

async function renderFavorites() {
  const container = document.getElementById('fav-list');
  const { favorites = [] } = await chrome.storage.sync.get('favorites');
  container.innerHTML = '';
  if (favorites.length === 0) return;
  container.className = 'fav-list';
  for (let i = 0; i < favorites.length; i++) {
    const fav = favorites[i];
    const item = document.createElement('div');
    item.className = 'fav-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'fav-name';
    nameEl.textContent = fav.name;

    const countEl = document.createElement('span');
    countEl.className = 'fav-count';
    countEl.textContent = `(${fav.urls.length}個)`;

    const actions = document.createElement('div');
    actions.className = 'fav-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'fav-action-btn';
    openBtn.textContent = '開く';
    openBtn.addEventListener('click', () => openFavorite(i));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'fav-action-btn delete';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => deleteFavorite(i));

    actions.appendChild(openBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(nameEl);
    item.appendChild(countEl);
    item.appendChild(actions);
    container.appendChild(item);
  }
}

async function openFavorite(index) {
  const { favorites = [] } = await chrome.storage.sync.get('favorites');
  const fav = favorites[index];
  if (!fav) return;
  const win = await chrome.windows.create({ url: fav.urls[0] });
  for (let i = 1; i < fav.urls.length; i++) {
    await chrome.tabs.create({ windowId: win.id, url: fav.urls[i], active: false });
  }
  showStatus(`「${fav.name}」を開きました`);
}

async function deleteFavorite(index) {
  const { favorites = [] } = await chrome.storage.sync.get('favorites');
  const fav = favorites[index];
  if (!fav) return;
  if (!confirm(`「${fav.name}」を削除しますか？`)) return;
  favorites.splice(index, 1);
  await chrome.storage.sync.set({ favorites });
  showStatus(`「${fav.name}」を削除しました`);
  renderFavorites();
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
