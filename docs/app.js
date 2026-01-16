const memoList = document.getElementById("memo-list");
const memoTitle = document.getElementById("memo-title");
const memoContent = document.getElementById("memo-content");
const historyList = document.getElementById("history-list");
const newMemoButton = document.getElementById("new-memo");
const saveVersionButton = document.getElementById("save-version");
const syncButton = document.getElementById("sync");
const syncStatus = document.getElementById("sync-status");
const apiBaseInput = document.getElementById("api-base");
const apiBaseSaveButton = document.getElementById("save-api-base");

const storageKey = "memo-data";
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

const formatTitle = (date) => {
  const datePart = date.toLocaleDateString();
  const timePart = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${datePart} ${timePart}`;
};

const formatTimestamp = (timestamp) => new Date(timestamp).toLocaleString();

const saveState = () => {
  localStorage.setItem(storageKey, JSON.stringify(state.memos));
};

const loadState = () => {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    state.memos = JSON.parse(saved);
    state.activeId = state.memos[0]?.id ?? null;
  }
};

const currentMemo = () => state.memos.find((memo) => memo.id === state.activeId);

const createVersion = (content) => ({
  id: crypto.randomUUID(),
  content,
  timestamp: new Date().toISOString(),
});

const createMemo = () => {
  const now = new Date();
  const memo = {
    id: crypto.randomUUID(),
    title: formatTitle(now),
    history: [createVersion("")],
  };
  state.memos.unshift(memo);
  state.activeId = memo.id;
  saveState();
  render();
};

const updateMemoTitle = (value) => {
  const memo = currentMemo();
  if (!memo) return;
  memo.title = value;
  saveState();
  renderMemoList();
};

const saveVersion = () => {
  const memo = currentMemo();
  if (!memo) return;
  const last = memo.history[memo.history.length - 1];
  if (last && last.content === memoContent.value) {
    return;
  }
  memo.history.push(createVersion(memoContent.value));
  saveState();
  renderHistory(memo);
  renderMemoList();
};

const restoreVersion = (memo, version) => {
  const last = memo.history[memo.history.length - 1];
  if (last && last.content === version.content) {
    return;
  }
  memo.history.push(createVersion(version.content));
  saveState();
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
      button.addEventListener("click", () => restoreVersion(memo, version));
      li.appendChild(label);
      li.appendChild(button);
      historyList.appendChild(li);
    });
};

const renderEditor = () => {
  const memo = currentMemo();
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
          id: crypto.randomUUID(),
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
    saveState();
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

newMemoButton.addEventListener("click", createMemo);
saveVersionButton.addEventListener("click", saveVersion);
syncButton.addEventListener("click", sync);
memoTitle.addEventListener("input", (event) => updateMemoTitle(event.target.value));
apiBaseSaveButton.addEventListener("click", applyApiBase);

loadState();
apiBaseInput.value = apiBase;
if (!state.memos.length) {
  createMemo();
} else {
  render();
}
