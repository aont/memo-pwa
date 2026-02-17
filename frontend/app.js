const memoList = document.getElementById("memo-list");
const memoTitle = document.getElementById("memo-title");
const memoContent = document.getElementById("memo-content");
const historyList = document.getElementById("history-list");
const newMemoButton = document.getElementById("new-memo");
const saveVersionButton = document.getElementById("save-version");
const deleteMemoButton = document.getElementById("delete-memo");
const searchInput = document.getElementById("search-text");
const replaceInput = document.getElementById("replace-text");
const searchCaseToggle = document.getElementById("search-case");
const findNextButton = document.getElementById("find-next");
const replaceOneButton = document.getElementById("replace-one");
const replaceAllButton = document.getElementById("replace-all");
const searchStatus = document.getElementById("search-status");
const syncButton = document.getElementById("sync");
const syncStatus = document.getElementById("sync-status");
const apiBaseInput = document.getElementById("api-base");
const apiBaseSaveButton = document.getElementById("save-api-base");
const resetStorageButton = document.getElementById("reset-storage");

const dbName = "memo-pwa";
const dbVersion = 1;
const memoStore = "memo-state";
const apiBaseStorageKey = "memo-api-base";
const defaultApiBase = window.location.origin;
const initialApiBase =
  localStorage.getItem(apiBaseStorageKey) ||
  document.querySelector('meta[name="memo-api-base"]')?.content ||
  window.MEMO_API_BASE ||
  defaultApiBase;
let apiBase = initialApiBase;
const resolveApiBase = (value) => {
  const trimmed = value?.trim();
  const baseValue = trimmed ? trimmed : defaultApiBase;
  const url = new URL(baseValue, window.location.origin);
  const normalizedPath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = normalizedPath || "/";
  return url;
};
const resolveApiEndpoint = (value, endpoint) => {
  const url = resolveApiBase(value);
  const pathPrefix = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `${pathPrefix}/${endpoint}`;
  return url.toString();
};
const syncEndpoint = () => resolveApiEndpoint(apiBase, "sync");

const state = {
  memos: [],
  activeId: null,
  deletedMemos: [],
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

const readStoreValue = async (key, fallback) => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(memoStore, "readonly").objectStore(memoStore).get(key);
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => reject(request.error);
  });
};

const writeState = async () => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(memoStore, "readwrite");
    const store = tx.objectStore(memoStore);
    store.put(state.memos, "memos");
    store.put(state.deletedMemos, "deletedMemos");
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
    await writeState();
  } catch (error) {
    console.error("Failed to save memos", error);
  }
};

const loadState = async () => {
  try {
    state.memos = await readStoreValue("memos", []);
    state.deletedMemos = await readStoreValue("deletedMemos", []);
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

const recordDeletion = (memoId, deletedAt = new Date().toISOString()) => {
  if (!memoId) return;
  if (state.deletedMemos.some((entry) => entry.id === memoId)) {
    return;
  }
  state.deletedMemos.push({ id: memoId, deletedAt });
};

const removeMemoById = (memoId) => {
  const index = state.memos.findIndex((item) => item.id === memoId);
  if (index === -1) return;
  state.memos.splice(index, 1);
  if (state.activeId === memoId) {
    if (state.memos.length) {
      state.activeId = state.memos[Math.max(0, index - 1)].id;
    } else {
      state.activeId = null;
    }
  }
};

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

const adjustMemoContentHeight = () => {
  memoContent.style.height = "auto";
  memoContent.style.height = `${memoContent.scrollHeight}px`;
};

const setSearchControlsDisabled = (disabled) => {
  [searchInput, replaceInput, searchCaseToggle, findNextButton, replaceOneButton, replaceAllButton].forEach(
    (element) => {
      element.disabled = disabled;
    }
  );
  if (disabled) {
    searchStatus.textContent = "";
  }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getMatchIndices = (content, query, caseSensitive) => {
  if (!query) return [];
  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const indices = [];
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    indices.push(index);
    index += needle.length;
  }
  return indices;
};

const updateSearchStatus = () => {
  const memo = currentMemo();
  if (!memo) {
    searchStatus.textContent = "";
    return;
  }
  const query = searchInput.value;
  if (!query) {
    searchStatus.textContent = "Enter text to search.";
    return;
  }
  const indices = getMatchIndices(memoContent.value, query, searchCaseToggle.checked);
  if (!indices.length) {
    searchStatus.textContent = "No matches found.";
    return;
  }
  searchStatus.textContent = `${indices.length} match${indices.length === 1 ? "" : "es"} found.`;
};

const focusMatch = (matchIndex, count) => {
  if (matchIndex === -1) return;
  const query = searchInput.value;
  memoContent.focus();
  memoContent.setSelectionRange(matchIndex, matchIndex + query.length);
  if (count) {
    const position = count.indexOf(matchIndex) + 1;
    if (position > 0) {
      searchStatus.textContent = `Match ${position} of ${count.length}.`;
    }
  }
};

const findNextMatch = () => {
  const memo = currentMemo();
  if (!memo) return;
  const query = searchInput.value;
  if (!query) {
    searchStatus.textContent = "Enter text to search.";
    return;
  }
  const indices = getMatchIndices(memoContent.value, query, searchCaseToggle.checked);
  if (!indices.length) {
    searchStatus.textContent = "No matches found.";
    return;
  }
  const cursor = memoContent.selectionEnd ?? 0;
  const nextIndex = indices.find((index) => index >= cursor);
  const matchIndex = nextIndex ?? indices[0];
  focusMatch(matchIndex, indices);
};

const replaceSelection = (replacement) => {
  const start = memoContent.selectionStart;
  const end = memoContent.selectionEnd;
  if (start == null || end == null || start === end) {
    return false;
  }
  const content = memoContent.value;
  memoContent.value = `${content.slice(0, start)}${replacement}${content.slice(end)}`;
  const cursor = start + replacement.length;
  memoContent.setSelectionRange(cursor, cursor);
  adjustMemoContentHeight();
  return true;
};

const replaceCurrentMatch = () => {
  const memo = currentMemo();
  if (!memo) return;
  const query = searchInput.value;
  if (!query) {
    searchStatus.textContent = "Enter text to search.";
    return;
  }
  const replacement = replaceInput.value;
  const selectedText = memoContent.value.slice(memoContent.selectionStart, memoContent.selectionEnd);
  const caseSensitive = searchCaseToggle.checked;
  const matchesSelection = caseSensitive
    ? selectedText === query
    : selectedText.toLowerCase() === query.toLowerCase();
  if (matchesSelection && replaceSelection(replacement)) {
    updateSearchStatus();
    return;
  }
  findNextMatch();
  const updatedSelection = memoContent.value.slice(memoContent.selectionStart, memoContent.selectionEnd);
  const updatedMatches = caseSensitive
    ? updatedSelection === query
    : updatedSelection.toLowerCase() === query.toLowerCase();
  if (updatedMatches) {
    replaceSelection(replacement);
  }
  updateSearchStatus();
};

const replaceAllMatches = () => {
  const memo = currentMemo();
  if (!memo) return;
  const query = searchInput.value;
  if (!query) {
    searchStatus.textContent = "Enter text to search.";
    return;
  }
  const caseSensitive = searchCaseToggle.checked;
  const indices = getMatchIndices(memoContent.value, query, caseSensitive);
  if (!indices.length) {
    searchStatus.textContent = "No matches found.";
    return;
  }
  const regex = new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
  memoContent.value = memoContent.value.replace(regex, replaceInput.value);
  adjustMemoContentHeight();
  searchStatus.textContent = `Replaced ${indices.length} match${indices.length === 1 ? "" : "es"}.`;
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
  removeMemoById(memo.id);
  recordDeletion(memo.id);
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
    setSearchControlsDisabled(true);
    return;
  }
  memoTitle.value = memo.title;
  memoContent.value = memo.history[memo.history.length - 1]?.content ?? "";
  adjustMemoContentHeight();
  renderHistory(memo);
  setSearchControlsDisabled(false);
  updateSearchStatus();
};

const render = () => {
  renderMemoList();
  renderEditor();
};

const mergeServerMemos = (serverMemos) => {
  const deletedIds = new Set(state.deletedMemos.map((entry) => entry.id));
  serverMemos.forEach((memo) => {
    if (deletedIds.has(memo.id)) {
      return;
    }
    if (!state.memos.find((item) => item.id === memo.id)) {
      state.memos.push(memo);
    }
  });
};

const handleSyncResults = (results) => {
  results.forEach((result) => {
    const localIndex = state.memos.findIndex((memo) => memo.id === result.id);
    if (result.status === "deleted") {
      removeMemoById(result.id);
      recordDeletion(result.id, result.deletedAt);
      return;
    }
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
          title: `${localMemo.title} (conflict copy)`,
        };
        state.memos.push(conflictCopy);
        state.memos[localIndex] = result.memo;
      } else {
        state.memos.push(result.memo);
      }
    }
  });
};

const applyServerDeletions = (serverDeleted) => {
  if (!Array.isArray(serverDeleted)) return;
  serverDeleted.forEach((entry) => {
    if (!entry?.id) return;
    removeMemoById(entry.id);
    recordDeletion(entry.id, entry.deletedAt);
  });
};

const sync = async () => {
  syncStatus.textContent = "Syncing...";
  try {
    const response = await fetch(syncEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memos: state.memos,
        deletedMemos: state.deletedMemos,
      }),
    });
    if (!response.ok) {
      throw new Error("Sync failed");
    }
    const data = await response.json();
    handleSyncResults(data.results);
    applyServerDeletions(data.serverDeleted);
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
  void updateServiceWorkerApiEndpoint();
};

const updateServiceWorkerApiEndpoint = async () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const endpoint = syncEndpoint();
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "api-endpoint", endpoint });
  } catch (error) {
    console.warn("Failed to update service worker API endpoint", error);
  }
};

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    await navigator.serviceWorker.register("sw.js");
    await updateServiceWorkerApiEndpoint();
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
};

const resetStorage = async () => {
  const confirmed = window.confirm("Reset data stored on this device?");
  if (!confirmed) return;
  try {
    if (dbPromise) {
      const db = await dbPromise;
      db.close();
    }
  } catch (error) {
    console.warn("Failed to close database before reset", error);
  }
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  state.memos = [];
  state.deletedMemos = [];
  state.activeId = null;
  await createMemo();
  syncStatus.textContent = "Data reset complete";
};

newMemoButton.addEventListener("click", () => void createMemo());
saveVersionButton.addEventListener("click", () => void saveVersion());
deleteMemoButton.addEventListener("click", () => void deleteMemo());
syncButton.addEventListener("click", async () => {
  await saveVersion();
  await sync();
});
memoTitle.addEventListener("input", (event) => void updateMemoTitle(event.target.value));
memoContent.addEventListener("blur", () => void saveVersion());
memoContent.addEventListener("input", () => {
  adjustMemoContentHeight();
  updateSearchStatus();
});
searchInput.addEventListener("input", updateSearchStatus);
searchCaseToggle.addEventListener("change", updateSearchStatus);
findNextButton.addEventListener("click", findNextMatch);
replaceOneButton.addEventListener("click", replaceCurrentMatch);
replaceAllButton.addEventListener("click", replaceAllMatches);
apiBaseSaveButton.addEventListener("click", applyApiBase);
resetStorageButton.addEventListener("click", () => void resetStorage());

const init = async () => {
  await registerServiceWorker();
  await loadState();
  apiBaseInput.value = apiBase;
  if (!state.memos.length) {
    await createMemo();
  } else {
    render();
  }
  adjustMemoContentHeight();
};

void init();
