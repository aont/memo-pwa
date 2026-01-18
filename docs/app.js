const memoList = document.getElementById("memo-list");
const memoTitle = document.getElementById("memo-title");
const memoContent = document.getElementById("memo-content");
const historyList = document.getElementById("history-list");
const newMemoButton = document.getElementById("new-memo");
const saveVersionButton = document.getElementById("save-version");
const deleteMemoButton = document.getElementById("delete-memo");
const syncButton = document.getElementById("sync");
const syncStatus = document.getElementById("sync-status");
const apiBaseInput = document.getElementById("api-base");
const apiBaseSaveButton = document.getElementById("save-api-base");

const dbName = "memo-pwa";
const dbVersion = 1;
const memoStore = "memo-state";
const apiBaseStorageKey = "memo-api-base";
const initialApiBase =
  localStorage.getItem(apiBaseStorageKey) ||
  document.querySelector('meta[name="memo-api-base"]')?.content ||
  window.MEMO_API_BASE ||
  "";
let apiBase = initialApiBase;
const apiUrl = (path) => `${apiBase.replace(/\/$/, "")}${path}`;

const state = {
  memos: [],
  activeId: null,
};

let dbPromise;

const openDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(memoStore)) {
        db.createObjectStore(memoStore);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDb();
  }
  return dbPromise;
};

const readMemos = async () => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(memoStore, "readonly").objectStore(memoStore).get("memos");
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

const writeMemos = async (memos) => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(memoStore, "readwrite");
    tx.objectStore(memoStore).put(memos, "memos");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const formatTitle = (date) => {
  const datePart = date.toLocaleDateString();
  const timePart = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${datePart} ${timePart}`;
};

const formatTimestamp = (timestamp) => new Date(timestamp).toLocaleString();

const generateId = () => {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  if (crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const saveState = async () => {
  try {
    await writeMemos(state.memos);
  } catch (error) {
    console.error("Failed to save memos", error);
  }
};

const loadState = async () => {
  try {
    state.memos = await readMemos();
    state.activeId = state.memos[0]?.id ?? null;
  } catch (error) {
    console.error("Failed to load memos", error);
  }
};

const currentMemo = () => state.memos.find((memo) => memo.id === state.activeId);

const createVersion = (content) => ({
  id: generateId(),
  content,
  timestamp: new Date().toISOString(),
});

const createMemo = async () => {
  const now = new Date();
  const memo = {
    id: generateId(),
    title: formatTitle(now),
    history: [createVersion("")],
  };
  state.memos.unshift(memo);
  state.activeId = memo.id;
  await saveState();
  render();
};

const updateMemoTitle = async (value) => {
  const memo = currentMemo();
  if (!memo) return;
  memo.title = value;
  await saveState();
  renderMemoList();
};

const saveVersion = async () => {
  const memo = currentMemo();
  if (!memo) return;
  const last = memo.history[memo.history.length - 1];
  if (last && last.content === memoContent.value) {
    return;
  }
  memo.history.push(createVersion(memoContent.value));
  await saveState();
  renderHistory(memo);
  renderMemoList();
};

const restoreVersion = async (memo, version) => {
  const last = memo.history[memo.history.length - 1];
  if (last && last.content === version.content) {
    return;
  }
  memo.history.push(createVersion(version.content));
  await saveState();
  render();
};

const deleteMemo = async () => {
  const memo = currentMemo();
  if (!memo) return;
  const confirmed = window.confirm(`Delete "${memo.title}"?`);
  if (!confirmed) return;
  const index = state.memos.findIndex((item) => item.id === memo.id);
  if (index === -1) return;
  state.memos.splice(index, 1);
  if (state.memos.length) {
    state.activeId = state.memos[Math.max(0, index - 1)].id;
  } else {
    state.activeId = null;
  }
  await saveState();
  render();
};

const renderMemoList = () => {
  memoList.innerHTML = "";
  state.memos.forEach((memo) => {
    const li = document.createElement("li");
    li.className = "memo-item";
    if (memo.id === state.activeId) {
      li.classList.add("active");
    }
    const last = memo.history[memo.history.length - 1];
    li.textContent = `${memo.title}${last?.content ? ` — ${last.content.slice(0, 24)}` : ""}`;
    li.addEventListener("click", () => {
      state.activeId = memo.id;
      render();
    });
    memoList.appendChild(li);
  });
};

const renderHistory = (memo) => {
  historyList.innerHTML = "";
  memo.history
    .slice()
    .reverse()
    .forEach((version) => {
      const li = document.createElement("li");
      li.className = "history-item";
      const label = document.createElement("span");
      label.textContent = formatTimestamp(version.timestamp);
      const button = document.createElement("button");
      button.textContent = "Restore";
      button.addEventListener("click", () => void restoreVersion(memo, version));
      li.appendChild(label);
      li.appendChild(button);
      historyList.appendChild(li);
    });
};

const renderEditor = () => {
  const memo = currentMemo();
  deleteMemoButton.disabled = !memo;
  if (!memo) {
    memoTitle.value = "";
    memoContent.value = "";
    historyList.innerHTML = "";
    return;
  }
  memoTitle.value = memo.title;
  memoContent.value = memo.history[memo.history.length - 1]?.content ?? "";
  renderHistory(memo);
};

const render = () => {
  renderMemoList();
  renderEditor();
};

const mergeServerMemos = (serverMemos) => {
  serverMemos.forEach((memo) => {
    if (!state.memos.find((item) => item.id === memo.id)) {
      state.memos.push(memo);
    }
  });
};

const handleSyncResults = (results) => {
  results.forEach((result) => {
    const localIndex = state.memos.findIndex((memo) => memo.id === result.id);
    if (result.status === "update") {
      if (localIndex >= 0) {
        state.memos[localIndex] = result.memo;
      } else {
        state.memos.push(result.memo);
      }
    }
    if (result.status === "conflict") {
      const localMemo = state.memos[localIndex];
      if (localMemo) {
        const conflictCopy = {
          ...localMemo,
          id: generateId(),
          title: `${localMemo.title} (conflict copy)`
        };
        state.memos.push(conflictCopy);
        state.memos[localIndex] = result.memo;
      } else {
        state.memos.push(result.memo);
      }
    }
  });
};

const sync = async () => {
  syncStatus.textContent = "Syncing...";
  try {
    const response = await fetch(apiUrl("/api/sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memos: state.memos }),
    });
    if (!response.ok) {
      throw new Error("Sync failed");
    }
    const data = await response.json();
    handleSyncResults(data.results);
    mergeServerMemos(data.serverMemos);
    await saveState();
    render();
    syncStatus.textContent = "Synced";
  } catch (error) {
    syncStatus.textContent = "Sync failed";
  }
};

const applyApiBase = () => {
  apiBase = apiBaseInput.value.trim();
  if (apiBase) {
    localStorage.setItem(apiBaseStorageKey, apiBase);
  } else {
    localStorage.removeItem(apiBaseStorageKey);
  }
  syncStatus.textContent = "API base updated";
};

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
};

newMemoButton.addEventListener("click", () => void createMemo());
saveVersionButton.addEventListener("click", () => void saveVersion());
deleteMemoButton.addEventListener("click", () => void deleteMemo());
syncButton.addEventListener("click", () => void sync());
memoTitle.addEventListener("input", (event) => void updateMemoTitle(event.target.value));
apiBaseSaveButton.addEventListener("click", applyApiBase);

const init = async () => {
  await registerServiceWorker();
  await loadState();
  apiBaseInput.value = apiBase;
  if (!state.memos.length) {
    await createMemo();
  } else {
    render();
  }
};

void init();
