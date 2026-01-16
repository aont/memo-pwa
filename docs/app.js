const APP_STORAGE_KEY = "memo-pwa-db";
const CURRENT_NOTE_KEY = "memo-pwa-current";
const LEGACY_KEY = "memo-pwa-legacy";
const PREF_WRAP_KEY = "memo-pwa-pref-wrap";
const PREF_THEME_KEY = "memo-pwa-pref-theme";
const PREF_LOG_KEY = "memo-pwa-pref-log";
const PREF_SEARCH_KEY = "memo-pwa-pref-search";
const PREF_SYNC_KEY = "memo-pwa-pref-sync";

const editor = document.getElementById("editor");
const highlightLayer = document.getElementById("highlight-layer");
const statusTitle = document.getElementById("status-title");
const statusSearch = document.getElementById("status-search");
const statusSave = document.getElementById("status-save");
const logPanel = document.getElementById("log-panel");
const logBody = document.getElementById("log-body");
const clearLogButton = document.getElementById("clear-log");

const openDialog = document.getElementById("open-dialog");
const openList = document.getElementById("open-list");
const renameDialog = document.getElementById("rename-dialog");
const renameForm = document.getElementById("rename-form");
const renameInput = document.getElementById("rename-input");
const findDialog = document.getElementById("find-dialog");
const findForm = document.getElementById("find-form");
const findInput = document.getElementById("find-input");
const findRegex = document.getElementById("find-regex");
const findCase = document.getElementById("find-case");
const replaceDialog = document.getElementById("replace-dialog");
const replaceForm = document.getElementById("replace-form");
const replaceFind = document.getElementById("replace-find");
const replaceWith = document.getElementById("replace-with");
const replaceRegex = document.getElementById("replace-regex");
const replaceCase = document.getElementById("replace-case");
const syncDialog = document.getElementById("sync-dialog");
const syncForm = document.getElementById("sync-form");
const syncUrlInput = document.getElementById("sync-url");
const syncTokenInput = document.getElementById("sync-token");
const versionsDialog = document.getElementById("versions-dialog");
const versionsList = document.getElementById("versions-list");
const importDialog = document.getElementById("import-dialog");
const importForm = document.getElementById("import-form");
const importInput = document.getElementById("import-input");

const menus = {
  file: document.getElementById("menu-file"),
  edit: document.getElementById("menu-edit"),
  view: document.getElementById("menu-view"),
};

const menuButtons = document.querySelectorAll(".menu-button");

const historyStore = new Map();
let db = loadDatabase();
let currentNoteId = loadCurrentNoteId();
let searchState = loadSearchPreferences();
let syncSettings = loadSyncSettings();
let highlightMatches = [];
let activeMatchIndex = 0;
let lastSavedText = "";
let lastVersionRecordedAt = 0;
let saveTimer = null;
let snapshotTimer = null;

initialize();

function initialize() {
  ensureInitialNote();
  applyPreferences();
  bindMenuEvents();
  bindEditorEvents();
  bindDialogs();
  bindKeyboardShortcuts();
  bindLogControls();
  loadNote(currentNoteId);
  renderHighlight();
  setupPwa();
  log("Memo PWA initialized.");
  setInterval(recordVersionIfNeeded, 2000);
}

function loadDatabase() {
  const raw = localStorage.getItem(APP_STORAGE_KEY);
  if (!raw) {
    return { version: 3, notes: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.notes) {
      return { version: 3, notes: [] };
    }
    return parsed;
  } catch (error) {
    log("Failed to parse database, resetting.", "warn");
    return { version: 3, notes: [] };
  }
}

function saveDatabase() {
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(db));
  statusSave.textContent = "Saved";
}

function loadCurrentNoteId() {
  return localStorage.getItem(CURRENT_NOTE_KEY);
}

function setCurrentNoteId(noteId) {
  currentNoteId = noteId;
  localStorage.setItem(CURRENT_NOTE_KEY, noteId);
}

function loadSearchPreferences() {
  const raw = localStorage.getItem(PREF_SEARCH_KEY);
  if (!raw) {
    return { query: "", regex: false, caseSensitive: false };
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { query: "", regex: false, caseSensitive: false };
  }
}

function saveSearchPreferences() {
  localStorage.setItem(PREF_SEARCH_KEY, JSON.stringify(searchState));
}

function loadSyncSettings() {
  const raw = localStorage.getItem(PREF_SYNC_KEY);
  if (!raw) {
    return { url: "", token: "" };
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { url: "", token: "" };
  }
}

function saveSyncSettings() {
  localStorage.setItem(PREF_SYNC_KEY, JSON.stringify(syncSettings));
}

function applyPreferences() {
  const wrapOn = localStorage.getItem(PREF_WRAP_KEY) !== "off";
  editor.classList.toggle("wrap-off", !wrapOn);
  const theme = localStorage.getItem(PREF_THEME_KEY) || "light";
  document.documentElement.dataset.theme = theme;
  const logVisible = localStorage.getItem(PREF_LOG_KEY) !== "hidden";
  logPanel.classList.toggle("hidden", !logVisible);
  findInput.value = searchState.query;
  findRegex.checked = searchState.regex;
  findCase.checked = searchState.caseSensitive;
  replaceFind.value = searchState.query;
  replaceRegex.checked = searchState.regex;
  replaceCase.checked = searchState.caseSensitive;
  syncUrlInput.value = syncSettings.url;
  syncTokenInput.value = syncSettings.token;
}

function ensureInitialNote() {
  if (db.notes.length === 0) {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const note = createNote({ title: "Migrated Memo", text: legacy });
      db.notes.push(note);
      setCurrentNoteId(note.id);
    } else {
      const note = createNote({ title: "New Memo", text: "" });
      db.notes.push(note);
      setCurrentNoteId(note.id);
    }
    saveDatabase();
  }
  if (!currentNoteId || !findNoteById(currentNoteId)) {
    setCurrentNoteId(db.notes[0].id);
  }
}

function createNote({ title, text }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    text,
    createdAt: now,
    updatedAt: now,
    versions: [],
  };
}

function findNoteById(noteId) {
  return db.notes.find((note) => note.id === noteId);
}

function loadNote(noteId) {
  const note = findNoteById(noteId);
  if (!note) {
    return;
  }
  editor.value = note.text;
  lastSavedText = note.text;
  updateStatus(note);
  ensureHistory(noteId);
  resetHistory(noteId, note.text);
  renderHighlight();
}

function updateStatus(note) {
  statusTitle.textContent = note.title;
  statusSave.textContent = "Saved";
}

function bindMenuEvents() {
  menuButtons.forEach((button) => {
    button.addEventListener("click", () => toggleMenu(button.dataset.menu));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-bar") && !event.target.closest(".menu-panel")) {
      closeMenus();
    }
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });
}

function bindEditorEvents() {
  editor.addEventListener("input", () => {
    statusSave.textContent = "Editing";
    debounceSave();
    debounceSnapshot();
    renderHighlight();
  });
  editor.addEventListener("scroll", syncScroll);
}

function bindDialogs() {
  renameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (renameDialog.returnValue === "confirm") {
      renameCurrentNote(renameInput.value.trim());
    }
    renameDialog.close();
  });

  findForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (findDialog.returnValue === "confirm") {
      searchState = {
        query: findInput.value,
        regex: findRegex.checked,
        caseSensitive: findCase.checked,
      };
      saveSearchPreferences();
      updateSearch();
    }
    findDialog.close();
  });

  replaceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (replaceDialog.returnValue === "replace") {
      handleReplace();
    }
    if (replaceDialog.returnValue === "replace-all") {
      handleReplaceAll();
    }
    replaceDialog.close();
  });

  syncForm.addEventListener("submit", (event) => {
    event.preventDefault();
    syncSettings = {
      url: syncUrlInput.value.trim(),
      token: syncTokenInput.value.trim(),
    };
    saveSyncSettings();
    if (syncDialog.returnValue === "sync") {
      performSync();
    }
    if (syncDialog.returnValue === "push") {
      overwriteServer();
    }
    if (syncDialog.returnValue === "pull") {
      replaceLocal();
    }
    syncDialog.close();
  });

  syncDialog.addEventListener("click", (event) => {
    const action = event.target.dataset.sync;
    if (!action) {
      return;
    }
    syncSettings = {
      url: syncUrlInput.value.trim(),
      token: syncTokenInput.value.trim(),
    };
    saveSyncSettings();
    if (action === "register") {
      authRequest("/auth/register");
    }
    if (action === "login") {
      authRequest("/auth/login");
    }
  });

  importForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (importDialog.returnValue === "confirm") {
      importNotes();
    }
    importDialog.close();
  });
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const isMeta = event.metaKey || event.ctrlKey;
    if (!isMeta) {
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFindDialog();
    }
    if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      openReplaceDialog();
    }
    if (event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    }
    if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
  });

  findDialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        previousMatch();
      } else {
        nextMatch();
      }
    }
  });
}

function bindLogControls() {
  clearLogButton.addEventListener("click", () => {
    logBody.textContent = "";
  });
  window.addEventListener("error", (event) => {
    log(`Error: ${event.message}`, "error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    log(`Unhandled: ${event.reason}`, "error");
  });
}

function toggleMenu(menuKey) {
  const target = menus[menuKey];
  const button = document.querySelector(`[data-menu="${menuKey}"]`);
  const isOpen = !target.hidden;
  closeMenus();
  if (!isOpen) {
    target.hidden = false;
    button.classList.add("active");
  }
}

function closeMenus() {
  Object.values(menus).forEach((menu) => {
    menu.hidden = true;
  });
  menuButtons.forEach((button) => button.classList.remove("active"));
}

function handleAction(action) {
  closeMenus();
  switch (action) {
    case "new-note":
      createNewNote();
      break;
    case "open-note":
      openOpenDialog();
      break;
    case "rename-note":
      openRenameDialog();
      break;
    case "export-selected":
      exportNotes([findNoteById(currentNoteId)]);
      break;
    case "export-all":
      exportNotes(db.notes);
      break;
    case "import-notes":
      importDialog.showModal();
      break;
    case "sync":
      syncDialog.showModal();
      break;
    case "versions":
      openVersionsDialog();
      break;
    case "delete-note":
      deleteCurrentNote();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "find":
      openFindDialog();
      break;
    case "next-match":
      nextMatch();
      break;
    case "prev-match":
      previousMatch();
      break;
    case "replace":
      openReplaceDialog();
      break;
    case "toggle-wrap":
      toggleWrap();
      break;
    case "toggle-log":
      toggleLog();
      break;
    case "toggle-theme":
      toggleTheme();
      break;
    default:
      break;
  }
}

function createNewNote() {
  saveCurrentNote();
  const note = createNote({ title: `Memo ${db.notes.length + 1}`, text: "" });
  db.notes.push(note);
  setCurrentNoteId(note.id);
  saveDatabase();
  loadNote(note.id);
  log(`Created note ${note.title}`);
}

function openOpenDialog() {
  openList.textContent = "";
  db.notes.forEach((note) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = note.title;
    if (note.id === currentNoteId) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => {
      switchNote(note.id);
      openDialog.close();
    });
    openList.appendChild(button);
  });
  openDialog.showModal();
}

function openRenameDialog() {
  const note = findNoteById(currentNoteId);
  if (!note) {
    return;
  }
  renameInput.value = note.title;
  renameDialog.showModal();
}

function renameCurrentNote(newTitle) {
  if (!newTitle) {
    return;
  }
  const note = findNoteById(currentNoteId);
  if (!note) {
    return;
  }
  note.title = newTitle;
  note.updatedAt = new Date().toISOString();
  saveDatabase();
  updateStatus(note);
  log(`Renamed note to ${newTitle}`);
}

function deleteCurrentNote() {
  const noteIndex = db.notes.findIndex((note) => note.id === currentNoteId);
  if (noteIndex === -1) {
    return;
  }
  const note = db.notes[noteIndex];
  if (!confirm(`Delete memo "${note.title}"?`)) {
    return;
  }
  db.notes.splice(noteIndex, 1);
  if (db.notes.length === 0) {
    db.notes.push(createNote({ title: "New Memo", text: "" }));
  }
  const nextNote = db.notes[Math.min(noteIndex, db.notes.length - 1)];
  setCurrentNoteId(nextNote.id);
  saveDatabase();
  loadNote(nextNote.id);
  log(`Deleted note ${note.title}`);
}

function switchNote(noteId) {
  if (noteId === currentNoteId) {
    return;
  }
  saveCurrentNote();
  recordVersion(true);
  setCurrentNoteId(noteId);
  loadNote(noteId);
  log(`Switched to ${statusTitle.textContent}`);
}

function saveCurrentNote() {
  const note = findNoteById(currentNoteId);
  if (!note) {
    return;
  }
  note.text = editor.value;
  note.updatedAt = new Date().toISOString();
  saveDatabase();
}

function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCurrentNote();
  }, 500);
}

function ensureHistory(noteId) {
  if (!historyStore.has(noteId)) {
    historyStore.set(noteId, { undo: [], redo: [] });
  }
}

function resetHistory(noteId, text) {
  const history = historyStore.get(noteId);
  history.undo = [text];
  history.redo = [];
}

function debounceSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    pushSnapshot(editor.value);
  }, 400);
}

function pushSnapshot(text) {
  const history = historyStore.get(currentNoteId);
  if (!history) {
    return;
  }
  const last = history.undo[history.undo.length - 1];
  if (last === text) {
    return;
  }
  history.undo.push(text);
  if (history.undo.length > 120) {
    history.undo.shift();
  }
  history.redo = [];
}

function undo() {
  const history = historyStore.get(currentNoteId);
  if (!history || history.undo.length <= 1) {
    return;
  }
  const current = history.undo.pop();
  history.redo.push(current);
  const previous = history.undo[history.undo.length - 1];
  editor.value = previous;
  saveCurrentNote();
  renderHighlight();
}

function redo() {
  const history = historyStore.get(currentNoteId);
  if (!history || history.redo.length === 0) {
    return;
  }
  const next = history.redo.pop();
  history.undo.push(next);
  editor.value = next;
  saveCurrentNote();
  renderHighlight();
}

function openFindDialog() {
  findInput.value = searchState.query;
  findRegex.checked = searchState.regex;
  findCase.checked = searchState.caseSensitive;
  findDialog.showModal();
}

function openReplaceDialog() {
  replaceFind.value = searchState.query;
  replaceRegex.checked = searchState.regex;
  replaceCase.checked = searchState.caseSensitive;
  replaceDialog.showModal();
}

function updateSearch() {
  activeMatchIndex = 0;
  renderHighlight();
}

function renderHighlight() {
  const { query, regex, caseSensitive } = searchState;
  const text = editor.value;
  highlightMatches = [];
  let regexValue = null;
  if (query) {
    try {
      const flags = caseSensitive ? "g" : "gi";
      regexValue = regex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
    } catch (error) {
      log(`Invalid search expression: ${error.message}`, "warn");
    }
  }

  if (regexValue) {
    let match;
    while ((match = regexValue.exec(text)) !== null) {
      if (match[0].length === 0) {
        regexValue.lastIndex += 1;
        continue;
      }
      highlightMatches.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  if (highlightMatches.length === 0) {
    highlightLayer.innerHTML = escapeHtml(text);
    statusSearch.textContent = "0/0";
    return;
  }

  const segments = [];
  let cursor = 0;
  highlightMatches.forEach((match, index) => {
    const before = text.slice(cursor, match.start);
    segments.push(escapeHtml(before));
    const matched = text.slice(match.start, match.end);
    const markClass = index === activeMatchIndex ? "active" : "";
    segments.push(`<mark class="${markClass}">${escapeHtml(matched)}</mark>`);
    cursor = match.end;
  });
  segments.push(escapeHtml(text.slice(cursor)));
  highlightLayer.innerHTML = segments.join("");
  statusSearch.textContent = `${activeMatchIndex + 1}/${highlightMatches.length}`;
  syncScroll();
}

function syncScroll() {
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
}

function nextMatch() {
  if (highlightMatches.length === 0) {
    return;
  }
  activeMatchIndex = (activeMatchIndex + 1) % highlightMatches.length;
  jumpToMatch();
}

function previousMatch() {
  if (highlightMatches.length === 0) {
    return;
  }
  activeMatchIndex = (activeMatchIndex - 1 + highlightMatches.length) % highlightMatches.length;
  jumpToMatch();
}

function jumpToMatch() {
  const match = highlightMatches[activeMatchIndex];
  if (!match) {
    return;
  }
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  renderHighlight();
}

function handleReplace() {
  if (highlightMatches.length === 0) {
    return;
  }
  const match = highlightMatches[activeMatchIndex];
  const originalText = editor.value;
  const before = originalText.slice(0, match.start);
  const after = originalText.slice(match.end);
  const replacement = getReplacementValue(match, originalText);
  editor.value = before + replacement + after;
  saveCurrentNote();
  renderHighlight();
  log("Replaced match.");
}

function handleReplaceAll() {
  const query = replaceFind.value;
  if (!query) {
    return;
  }
  const regexValue = buildRegex(query, replaceRegex.checked, replaceCase.checked);
  if (!regexValue) {
    return;
  }
  editor.value = editor.value.replace(regexValue, replaceWith.value);
  saveCurrentNote();
  renderHighlight();
  log("Replaced all matches.");
}

function getReplacementValue(match, text) {
  const query = replaceFind.value;
  if (!query) {
    return replaceWith.value;
  }
  const regexValue = buildRegex(query, replaceRegex.checked, replaceCase.checked);
  if (!regexValue) {
    return replaceWith.value;
  }
  const matchText = text.slice(match.start, match.end);
  return matchText.replace(regexValue, replaceWith.value);
}

function buildRegex(query, isRegex, isCaseSensitive) {
  try {
    const flags = isCaseSensitive ? "g" : "gi";
    return isRegex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
  } catch (error) {
    log(`Invalid regex: ${error.message}`, "warn");
    return null;
  }
}

function toggleWrap() {
  const isWrapped = !editor.classList.contains("wrap-off");
  if (isWrapped) {
    editor.classList.add("wrap-off");
    localStorage.setItem(PREF_WRAP_KEY, "off");
  } else {
    editor.classList.remove("wrap-off");
    localStorage.setItem(PREF_WRAP_KEY, "on");
  }
}

function toggleLog() {
  const isHidden = logPanel.classList.toggle("hidden");
  localStorage.setItem(PREF_LOG_KEY, isHidden ? "hidden" : "visible");
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || "light";
  const next = current === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(PREF_THEME_KEY, next);
}

function openVersionsDialog() {
  versionsList.textContent = "";
  const note = findNoteById(currentNoteId);
  if (!note) {
    return;
  }
  note.versions
    .slice()
    .reverse()
    .forEach((version) => {
      const button = document.createElement("button");
      button.type = "button";
      const time = new Date(version.createdAt).toLocaleString();
      button.textContent = `${time} (${version.text.length} chars)`;
      button.addEventListener("click", () => {
        restoreVersion(version);
        versionsDialog.close();
      });
      versionsList.appendChild(button);
    });
  versionsDialog.showModal();
}

function restoreVersion(version) {
  const note = findNoteById(currentNoteId);
  if (!note) {
    return;
  }
  recordVersion(true);
  editor.value = version.text;
  saveCurrentNote();
  resetHistory(currentNoteId, version.text);
  renderHighlight();
  log("Restored version.");
}

function recordVersion(force) {
  const note = findNoteById(currentNoteId);
  if (!note) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastVersionRecordedAt < 5000) {
    return;
  }
  if (note.text === lastSavedText) {
    return;
  }
  note.versions.push({ text: note.text, createdAt: new Date().toISOString() });
  lastVersionRecordedAt = now;
  lastSavedText = note.text;
  saveDatabase();
  log("Version recorded.");
}

function recordVersionIfNeeded() {
  recordVersion(false);
}

function exportNotes(notes) {
  const payload = {
    schema: "memo-pwa-export",
    version: 3,
    exportedAt: new Date().toISOString(),
    notes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `memo-export-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  log(`Exported ${notes.length} notes.`);
}

function importNotes() {
  let payload;
  try {
    payload = JSON.parse(importInput.value);
  } catch (error) {
    log("Invalid JSON.", "warn");
    return;
  }
  if (!Array.isArray(payload.notes)) {
    log("Import JSON missing notes array.", "warn");
    return;
  }
  const existingIds = new Set(db.notes.map((note) => note.id));
  const imported = payload.notes.map((raw) => {
    const now = new Date().toISOString();
    let id = raw.id || crypto.randomUUID();
    while (existingIds.has(id)) {
      id = crypto.randomUUID();
    }
    existingIds.add(id);
    return {
      id,
      title: raw.title || "Imported Memo",
      text: raw.text || "",
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
      versions: Array.isArray(raw.versions) ? raw.versions : [],
    };
  });
  db.notes = db.notes.concat(imported);
  saveDatabase();
  const lastNote = imported[imported.length - 1];
  if (lastNote) {
    setCurrentNoteId(lastNote.id);
    loadNote(lastNote.id);
  }
  log(`Imported ${imported.length} notes.`);
}

async function authRequest(path) {
  if (!syncSettings.url) {
    log("Sync URL missing.", "warn");
    return;
  }
  try {
    const response = await fetch(`${syncSettings.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Auth failed (${response.status})`);
    }
    const data = await response.json();
    syncSettings.token = data.token;
    syncTokenInput.value = data.token;
    saveSyncSettings();
    log("Auth succeeded.");
  } catch (error) {
    log(`Auth error: ${error.message}`, "error");
  }
}

async function performSync() {
  if (!syncSettings.url || !syncSettings.token) {
    log("Sync URL/token missing.", "warn");
    return;
  }
  recordVersion(true);
  saveCurrentNote();
  try {
    const response = await fetch(`${syncSettings.url}/notes`, {
      headers: { Authorization: `Bearer ${syncSettings.token}` },
    });
    if (!response.ok) {
      throw new Error(`Sync failed (${response.status})`);
    }
    const data = await response.json();
    const serverNotes = Array.isArray(data.notes) ? data.notes : [];
    const merged = mergeNotes(serverNotes);
    db.notes = merged;
    saveDatabase();
    loadNote(currentNoteId);
    await pushNotes(serverNotes);
    log("Sync completed.");
  } catch (error) {
    log(`Sync error: ${error.message}`, "error");
  }
}

function mergeNotes(serverNotes) {
  const merged = [];
  const localMap = new Map(db.notes.map((note) => [note.id, note]));
  serverNotes.forEach((serverNote) => {
    const local = localMap.get(serverNote.id);
    if (!local) {
      merged.push(serverNote);
      return;
    }
    if (local.updatedAt === serverNote.updatedAt) {
      merged.push(local);
      return;
    }
    if (new Date(local.updatedAt) > new Date(serverNote.updatedAt)) {
      const conflict = createNote({ title: `${local.title} (Local copy)`, text: local.text });
      conflict.versions = local.versions;
      merged.push(serverNote);
      merged.push(conflict);
      log(`Conflict detected for ${local.title}. Created local copy.`, "warn");
      return;
    }
    merged.push(serverNote);
  });
  db.notes.forEach((note) => {
    if (!serverNotes.find((serverNote) => serverNote.id === note.id)) {
      merged.push(note);
    }
  });
  return merged;
}

async function pushNotes(existingServerNotes) {
  const serverIds = new Set(existingServerNotes.map((note) => note.id));
  const outbound = db.notes.filter((note) => !serverIds.has(note.id));
  if (outbound.length === 0) {
    return;
  }
  await fetch(`${syncSettings.url}/notes`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${syncSettings.token}`,
    },
    body: JSON.stringify({ notes: db.notes }),
  });
}

async function overwriteServer() {
  if (!syncSettings.url || !syncSettings.token) {
    log("Sync URL/token missing.", "warn");
    return;
  }
  recordVersion(true);
  saveCurrentNote();
  try {
    await fetch(`${syncSettings.url}/notes`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${syncSettings.token}`,
      },
      body: JSON.stringify({ notes: db.notes }),
    });
    log("Server overwritten.");
  } catch (error) {
    log(`Overwrite error: ${error.message}`, "error");
  }
}

async function replaceLocal() {
  if (!syncSettings.url || !syncSettings.token) {
    log("Sync URL/token missing.", "warn");
    return;
  }
  try {
    const response = await fetch(`${syncSettings.url}/notes`, {
      headers: { Authorization: `Bearer ${syncSettings.token}` },
    });
    if (!response.ok) {
      throw new Error(`Fetch failed (${response.status})`);
    }
    const data = await response.json();
    db.notes = Array.isArray(data.notes) ? data.notes : [];
    if (db.notes.length === 0) {
      db.notes.push(createNote({ title: "New Memo", text: "" }));
    }
    setCurrentNoteId(db.notes[0].id);
    saveDatabase();
    loadNote(currentNoteId);
    log("Local notes replaced.");
  } catch (error) {
    log(`Replace error: ${error.message}`, "error");
  }
}

function setupPwa() {
  const manifest = {
    name: "Memo PWA",
    short_name: "Memo",
    start_url: ".",
    display: "standalone",
    background_color: "#141416",
    theme_color: "#375aff",
    icons: [],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = url;
  document.head.appendChild(link);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(() => {
      log("Service worker registered.");
    });
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function log(message, level = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  logBody.textContent += `${line}\n`;
  logBody.scrollTop = logBody.scrollHeight;
}
