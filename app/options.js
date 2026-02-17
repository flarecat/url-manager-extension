document.addEventListener('DOMContentLoaded', render);

async function render() {
  const editor = document.getElementById('fav-editor');
  const emptyMsg = document.getElementById('empty-msg');
  const { favorites = [] } = await chrome.storage.sync.get('favorites');

  editor.innerHTML = '';

  if (favorites.length === 0) {
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  for (let i = 0; i < favorites.length; i++) {
    editor.appendChild(createCard(favorites, i));
  }
}

function createCard(favorites, index) {
  const fav = favorites[index];
  const card = document.createElement('div');
  card.className = 'fav-card';

  // Header: name input + actions
  const header = document.createElement('div');
  header.className = 'fav-card-header';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'fav-card-name';
  nameInput.value = fav.name;

  const meta = document.createElement('span');
  meta.className = 'fav-card-meta';
  meta.textContent = `${fav.urls.length}個のURL`;

  const actions = document.createElement('div');
  actions.className = 'fav-card-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '保存';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = '削除';

  actions.appendChild(saveBtn);
  actions.appendChild(deleteBtn);
  header.appendChild(nameInput);
  header.appendChild(meta);
  header.appendChild(actions);
  card.appendChild(header);

  // URL list
  const urlList = document.createElement('div');
  urlList.className = 'url-list';

  function addUrlRow(url) {
    const row = document.createElement('div');
    row.className = 'url-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'url-input';
    input.value = url;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'url-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      row.remove();
      updateMeta();
    });

    row.appendChild(input);
    row.appendChild(removeBtn);
    urlList.appendChild(row);
  }

  for (const url of fav.urls) {
    addUrlRow(url);
  }

  card.appendChild(urlList);

  // Add URL button
  const addBtn = document.createElement('button');
  addBtn.className = 'url-add';
  addBtn.textContent = '+ URL を追加';
  addBtn.addEventListener('click', () => {
    addUrlRow('https://');
    const inputs = urlList.querySelectorAll('.url-input');
    inputs[inputs.length - 1].focus();
    updateMeta();
  });
  card.appendChild(addBtn);

  function updateMeta() {
    const count = urlList.querySelectorAll('.url-row').length;
    meta.textContent = `${count}個のURL`;
  }

  // Save handler
  saveBtn.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (!newName) {
      showStatus('名前を入力してください', 'error');
      nameInput.focus();
      return;
    }
    const inputs = urlList.querySelectorAll('.url-input');
    const newUrls = [...inputs]
      .map(input => input.value.trim())
      .filter(url => url && /^https?:\/\/\S+/.test(url));
    if (newUrls.length === 0) {
      showStatus('有効なURLが1つもありません', 'error');
      return;
    }
    const { favorites = [] } = await chrome.storage.sync.get('favorites');
    favorites[index] = { name: newName, urls: newUrls, createdAt: fav.createdAt };
    await chrome.storage.sync.set({ favorites });
    showStatus(`「${newName}」を保存しました`);
    render();
  });

  // Delete handler
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`「${fav.name}」を削除しますか？`)) return;
    const { favorites = [] } = await chrome.storage.sync.get('favorites');
    favorites.splice(index, 1);
    await chrome.storage.sync.set({ favorites });
    showStatus(`「${fav.name}」を削除しました`);
    render();
  });

  return card;
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
