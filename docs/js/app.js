import { debounce } from "./modules/utils.js";
import { createLogger } from "./modules/logger.js";
import { createHistoryStore } from "./modules/history.js";
import { createSearchController } from "./modules/search.js";
import { STORAGE_KEYS, loadNotes, loadPreferences, saveNotes, savePreference } from "./modules/storage.js";
import { setupPwa } from "./modules/pwa.js";
import { createNotesController } from "./modules/notes.js";
import { createImportExportController } from "./modules/importExport.js";
import { createSyncController } from "./modules/sync.js";

(() => {
  // =========================
  // Elements
  // =========================
  const editor = document.getElementById("editor");
  const highlightLayer = document.getElementById("highlightLayer");
  const editorSurface = document.querySelector(".editor-surface");

  const currentTitle = document.getElementById("currentTitle");
  const matchStatus = document.getElementById("matchStatus");
  const saveStatus = document.getElementById("saveStatus");

  const logEl = document.getElementById("log");

  // Menus
  const fileBtn = document.getElementById("fileBtn");
  const editBtn = document.getElementById("editBtn");
  const viewBtn = document.getElementById("viewBtn");
  const fileMenu = document.getElementById("fileMenu");
  const editMenu = document.getElementById("editMenu");
  const viewMenu = document.getElementById("viewMenu");

  // Menu items
  const mNewMemo = document.getElementById("mNewMemo");
  const mOpen = document.getElementById("mOpen");
  const mRename = document.getElementById("mRename");
  const mUndo = document.getElementById("mUndo");
  const mRedo = document.getElementById("mRedo");
  const mFind = document.getElementById("mFind");
  const mNext = document.getElementById("mNext");
  const mPrev = document.getElementById("mPrev");
  const mReplace = document.getElementById("mReplace");
  const mWrap = document.getElementById("mWrap");
  const mToggleLog = document.getElementById("mToggleLog");

  const mExportSel = document.getElementById("mExportSel");
  const mExportAll = document.getElementById("mExportAll");
  const mImport = document.getElementById("mImport");
  const mDelete = document.getElementById("mDelete");
  const mSync = document.getElementById("mSync");
  const mVersions = document.getElementById("mVersions");

  // Dialogs & UI
  const openOverlay = document.getElementById("openOverlay");
  const renameOverlay = document.getElementById("renameOverlay");
  const findOverlay = document.getElementById("findOverlay");
  const replaceOverlay = document.getElementById("replaceOverlay");
  const syncOverlay = document.getElementById("syncOverlay");
  const versionsOverlay = document.getElementById("versionsOverlay");

  const noteSelect = document.getElementById("noteSelect");
  const openApplyBtn = document.getElementById("openApplyBtn");
  const newNoteBtn = document.getElementById("newNoteBtn");

  const titleInput = document.getElementById("titleInput");
  const renameBtn = document.getElementById("renameBtn");
  const deleteBtn = document.getElementById("deleteBtn");

  const findInput = document.getElementById("findInput");
  const regexToggle = document.getElementById("regexToggle");
  const caseToggle = document.getElementById("caseToggle");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  const replaceInput = document.getElementById("replaceInput");
  const replaceBtn = document.getElementById("replaceBtn");
  const replaceAllBtn = document.getElementById("replaceAllBtn");
  const clearBtn = document.getElementById("clearBtn");

  const importFile = document.getElementById("importFile");
  const syncEndpointInput = document.getElementById("syncEndpointInput");
  const syncTokenInput = document.getElementById("syncTokenInput");
  const syncUsernameInput = document.getElementById("syncUsernameInput");
  const syncPasswordInput = document.getElementById("syncPasswordInput");
  const syncRegisterBtn = document.getElementById("syncRegisterBtn");
  const syncLoginBtn = document.getElementById("syncLoginBtn");
  const syncSaveBtn = document.getElementById("syncSaveBtn");
  const syncNowBtn = document.getElementById("syncNowBtn");
  const syncReplaceLocalBtn = document.getElementById("syncReplaceLocalBtn");
  const syncReplaceServerBtn = document.getElementById("syncReplaceServerBtn");
  const syncStatus = document.getElementById("syncStatus");

  const versionSelect = document.getElementById("versionSelect");
  const versionRestoreBtn = document.getElementById("versionRestoreBtn");

  // =========================
  // Logger
  // =========================
  const { debug, log, warn, err, getLevel } = createLogger(logEl);
  debug("Logger initialized", { level: getLevel() });

  // =========================
  // DB
  // =========================
  const loadResult = loadNotes({ debug, log, warn });
  const state = {
    db: loadResult.db,
    currentId: loadResult.currentId
  };
  debug("State initialized", { notes: state.db.notes.length, currentId: state.currentId });

  // =========================
  // Search/Highlight
  // =========================
  const search = createSearchController({
    editor,
    highlightLayer,
    matchStatus,
    findInput,
    regexToggle,
    caseToggle
  });

  // =========================
  // Undo/Redo
  // =========================
  const history = createHistoryStore();
  debug("History store ready");

  function applySnapshot(snap) {
    editor.value = snap.text;
    editor.focus();
    editor.setSelectionRange(snap.selStart, snap.selEnd);
    resizeEditorToContent();
    search.scheduleHighlight(true);
    search.syncScroll();
  }

  // =========================
  // Settings
  // =========================
  function setSavedState(text) {
    saveStatus.textContent = text;
  }

  function setWrap(on) {
    if (on) {
      document.body.classList.remove("nowrap");
      editor.setAttribute("wrap", "soft");
      mWrap.setAttribute("aria-checked", "true");
      mWrap.textContent = "Wrap";
    } else {
      document.body.classList.add("nowrap");
      editor.setAttribute("wrap", "off");
      mWrap.setAttribute("aria-checked", "false");
      mWrap.textContent = "Wrap (Off)";
    }
    resizeEditorToContent();
    savePreference(STORAGE_KEYS.wrap, on ? "1" : "0");
    search.scheduleHighlight(true);
    setSavedState("Saving…");
    schedulePersist();
  }

  function isLogVisible() {
    return localStorage.getItem(STORAGE_KEYS.logUi) === "1";
  }

  function setLogVisible(v) {
    savePreference(STORAGE_KEYS.logUi, v ? "1" : "0");
    document.querySelector(".bottombar").style.display = v ? "block" : "none";
    debug("Log UI visibility changed", { visible: v });
  }

  // =========================
  // Persistence
  // =========================
  const persistNow = () => {
    recordVersionForNote(state.currentId, { force: false });
    saveNotes(state.db, state.currentId);
    setSavedState("Saved");
    log("persistNow()", { notes: state.db.notes.length, currentId: state.currentId });
  };
  const schedulePersist = debounce(persistNow, 800);

  // =========================
  // Notes
  // =========================
  const {
    ensureAtLeastOneNote,
    getNoteById,
    ensureNoteVersioning,
    recordVersionForNote,
    updateCurrentNoteTextFromEditor,
    refreshNoteSelect,
    loadCurrentNoteToEditor,
    createNote,
    switchNote,
    renameCurrent,
    deleteCurrent
  } = createNotesController({
    state,
    editor,
    currentTitle,
    noteSelect,
    history,
    search,
    setSavedState,
    schedulePersist,
    log,
    onEditorContentChange: () => {
      resizeEditorToContent();
    }
  });

  function resizeEditorToContent() {
    if (!editorSurface) return;
    editorSurface.style.height = "auto";
    highlightLayer.style.height = "auto";
    editor.style.height = "auto";
    const minHeight = parseFloat(getComputedStyle(editorSurface).minHeight) || 0;
    const nextHeight = Math.max(editor.scrollHeight, minHeight);
    editor.style.height = `${nextHeight}px`;
    highlightLayer.style.height = `${nextHeight}px`;
    editorSurface.style.height = `${nextHeight}px`;
  }

  // =========================
  // Export / Import
  // =========================
  const { exportSelected, exportAll, importFromFile } = createImportExportController({
    state,
    editor,
    getNoteById,
    updateCurrentNoteTextFromEditor,
    refreshNoteSelect,
    loadCurrentNoteToEditor,
    setSavedState,
    schedulePersist,
    log,
    warn,
    err,
    history
  });

  const {
    getEndpoint,
    setEndpoint,
    getToken,
    setToken,
    registerUser,
    loginUser,
    syncNow,
    replaceLocalWithServer,
    replaceServerWithLocal
  } = createSyncController({
    state,
    ensureNoteVersioning,
    recordVersionForNote,
    refreshNoteSelect,
    loadCurrentNoteToEditor,
    setSavedState,
    schedulePersist,
    debug,
    log,
    warn,
    err
  });

  // =========================
  // Dialog helpers
  // =========================
  function openOverlayById(id) {
    const el = document.getElementById(id);
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
  }

  function closeOverlayById(id) {
    const el = document.getElementById(id);
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
  }

  function closeAllOverlays() {
    for (const id of ["openOverlay", "renameOverlay", "findOverlay", "replaceOverlay", "syncOverlay", "versionsOverlay"]) {
      closeOverlayById(id);
    }
  }

  document.addEventListener("click", (e) => {
    const closeId = e.target?.getAttribute?.("data-close");
    if (closeId) closeOverlayById(closeId);
  });

  for (const ov of [openOverlay, renameOverlay, findOverlay, replaceOverlay, syncOverlay, versionsOverlay]) {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) ov.classList.remove("open");
    });
  }

  // =========================
  // Menus open/close
  // =========================
  function closeMenus() {
    for (const p of [fileMenu, editMenu, viewMenu]) p.classList.remove("open");
    fileBtn.setAttribute("aria-expanded", "false");
    editBtn.setAttribute("aria-expanded", "false");
    viewBtn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu(btn, panel) {
    const isOpen = panel.classList.contains("open");
    closeMenus();
    if (!isOpen) {
      panel.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }
  }

  fileBtn.addEventListener("click", () => toggleMenu(fileBtn, fileMenu));
  editBtn.addEventListener("click", () => toggleMenu(editBtn, editMenu));
  viewBtn.addEventListener("click", () => toggleMenu(viewBtn, viewMenu));

  document.addEventListener("click", (e) => {
    const inMenu = e.target.closest(".menu-group");
    if (!inMenu) closeMenus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenus();
      closeAllOverlays();
    }
  });

  // =========================
  // Menu Actions
  // =========================
  mNewMemo.addEventListener("click", () => {
    closeMenus();
    createNote();
  });
  mOpen.addEventListener("click", () => {
    closeMenus();
    refreshNoteSelect();
    openOverlayById("openOverlay");
  });
  mRename.addEventListener("click", () => {
    closeMenus();
    titleInput.value = getNoteById(state.currentId)?.title || "";
    openOverlayById("renameOverlay");
    titleInput.focus();
  });

  mUndo.addEventListener("click", () => {
    closeMenus();
    const snap = history.undo(state.currentId);
    if (!snap) return;
    applySnapshot(snap);
    updateCurrentNoteTextFromEditor(true);
    schedulePersist();
    log("Undo", { noteId: state.currentId });
  });
  mRedo.addEventListener("click", () => {
    closeMenus();
    const snap = history.redo(state.currentId);
    if (!snap) return;
    applySnapshot(snap);
    updateCurrentNoteTextFromEditor(true);
    schedulePersist();
    log("Redo", { noteId: state.currentId });
  });

  mFind.addEventListener("click", () => {
    closeMenus();
    openOverlayById("findOverlay");
    findInput.focus();
    search.scheduleHighlight(true);
  });
  mNext.addEventListener("click", () => {
    closeMenus();
    search.gotoNext();
  });
  mPrev.addEventListener("click", () => {
    closeMenus();
    search.gotoPrev();
  });
  mReplace.addEventListener("click", () => {
    closeMenus();
    openOverlayById("replaceOverlay");
    replaceInput.focus();
  });

  mWrap.addEventListener("click", () => {
    closeMenus();
    const on = !document.body.classList.contains("nowrap");
    setWrap(!on);
  });

  mToggleLog.addEventListener("click", () => {
    closeMenus();
    const v = !isLogVisible();
    setLogVisible(v);
    log("Toggle Log", { visible: v });
  });

  mExportSel.addEventListener("click", () => {
    closeMenus();
    exportSelected();
  });
  mExportAll.addEventListener("click", () => {
    closeMenus();
    exportAll();
  });
  mImport.addEventListener("click", () => {
    closeMenus();
    importFile.click();
  });
  mDelete.addEventListener("click", () => {
    closeMenus();
    deleteCurrent();
  });
  mSync.addEventListener("click", () => {
    closeMenus();
    syncEndpointInput.value = getEndpoint();
    syncTokenInput.value = getToken();
    syncUsernameInput.value = "";
    syncPasswordInput.value = "";
    syncStatus.textContent = "";
    openOverlayById("syncOverlay");
    syncEndpointInput.focus();
  });
  mVersions.addEventListener("click", () => {
    closeMenus();
    refreshVersionList();
    openOverlayById("versionsOverlay");
  });

  // =========================
  // Dialog actions
  // =========================
  openApplyBtn.addEventListener("click", () => {
    const nextId = noteSelect.value;
    switchNote(nextId);
    closeOverlayById("openOverlay");
  });
  newNoteBtn.addEventListener("click", () => {
    createNote();
    refreshNoteSelect();
    closeOverlayById("openOverlay");
  });

  renameBtn.addEventListener("click", () => {
    renameCurrent(titleInput.value);
    closeOverlayById("renameOverlay");
  });
  deleteBtn.addEventListener("click", () => {
    deleteCurrent();
    closeOverlayById("renameOverlay");
  });

  // Find dialog interactions
  findInput.addEventListener("input", () => search.scheduleHighlight(true));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) search.gotoPrev();
      else search.gotoNext();
    }
  });
  regexToggle.addEventListener("change", () => {
    savePreference(STORAGE_KEYS.regex, regexToggle.checked ? "1" : "0");
    search.scheduleHighlight(true);
  });
  caseToggle.addEventListener("change", () => {
    savePreference(STORAGE_KEYS.caseSensitive, caseToggle.checked ? "1" : "0");
    search.scheduleHighlight(true);
  });
  prevBtn.addEventListener("click", () => search.gotoPrev());
  nextBtn.addEventListener("click", () => search.gotoNext());

  // Replace dialog actions
  replaceBtn.addEventListener("click", () => {
    const matches = search.getMatches();
    if (!matches.length) return;
    const rep = replaceInput.value ?? "";
    const activeIndex = search.getActiveIndex();
    const { start, end } = matches[activeIndex];
    const text = editor.value;

    editor.value = text.slice(0, start) + rep + text.slice(end);
    editor.setSelectionRange(start, start + rep.length);
    resizeEditorToContent();

    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(true);

    history.pushUndoSnapshot(state.currentId, history.snapshotFromEditor(editor));
  });

  replaceAllBtn.addEventListener("click", () => {
    const query = findInput.value;
    if (!query) return;
    const flags = caseToggle.checked ? "g" : "gi";
    let re;
    if (regexToggle.checked) {
      try {
        re = new RegExp(query, flags);
      } catch {
        return;
      }
    } else {
      const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      re = new RegExp(esc, flags);
    }

    const rep = replaceInput.value ?? "";
    editor.value = editor.value.replace(re, rep);
    resizeEditorToContent();

    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(true);

    history.pushUndoSnapshot(state.currentId, history.snapshotFromEditor(editor));
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear the memo content?")) return;
    editor.value = "";
    resizeEditorToContent();
    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(true);
    history.pushUndoSnapshot(state.currentId, history.snapshotFromEditor(editor));
  });

  // Import file
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) return;
    await importFromFile(file);
  });

  syncSaveBtn.addEventListener("click", () => {
    setEndpoint(syncEndpointInput.value);
    setToken(syncTokenInput.value);
    syncStatus.textContent = "Settings saved.";
  });

  async function handleAuth(action) {
    const endpoint = syncEndpointInput.value.trim();
    const username = syncUsernameInput.value.trim();
    const password = syncPasswordInput.value;
    if (!endpoint) {
      syncStatus.textContent = "Set the server endpoint first.";
      return;
    }
    if (!username || !password) {
      syncStatus.textContent = "Enter a username and password.";
      return;
    }
    syncStatus.textContent = action === "register" ? "Registering…" : "Logging in…";
    try {
      const token =
        action === "register"
          ? await registerUser({ endpoint, username, password })
          : await loginUser({ endpoint, username, password });
      syncTokenInput.value = token;
      setEndpoint(endpoint);
      setToken(token);
      syncStatus.textContent = action === "register" ? "Registered. Token saved." : "Logged in. Token saved.";
    } catch (e) {
      err("auth failed", { message: e?.message });
      syncStatus.textContent = "Auth failed. Check the log.";
    }
  }

  syncRegisterBtn.addEventListener("click", () => handleAuth("register"));
  syncLoginBtn.addEventListener("click", () => handleAuth("login"));

  syncNowBtn.addEventListener("click", async () => {
    setEndpoint(syncEndpointInput.value);
    setToken(syncTokenInput.value);
    syncStatus.textContent = "Syncing…";
    try {
      updateCurrentNoteTextFromEditor();
      recordVersionForNote(state.currentId, { force: true });
      await syncNow({ endpoint: syncEndpointInput.value, token: syncTokenInput.value });
      syncStatus.textContent = "Sync completed.";
    } catch (e) {
      err("syncNow failed", { message: e?.message });
      syncStatus.textContent = "Sync failed. Check the log.";
    }
  });

  syncReplaceLocalBtn.addEventListener("click", async () => {
    setEndpoint(syncEndpointInput.value);
    setToken(syncTokenInput.value);
    if (!window.confirm("Replace local notes with the server copy? This will discard local-only notes.")) {
      return;
    }
    syncStatus.textContent = "Replacing local notes…";
    try {
      await replaceLocalWithServer({ endpoint: syncEndpointInput.value, token: syncTokenInput.value });
      syncStatus.textContent = "Local notes replaced from server.";
    } catch (e) {
      err("replaceLocalWithServer failed", { message: e?.message });
      syncStatus.textContent = "Replace failed. Check the log.";
    }
  });

  syncReplaceServerBtn.addEventListener("click", async () => {
    setEndpoint(syncEndpointInput.value);
    setToken(syncTokenInput.value);
    if (!window.confirm("Replace server notes with local data? This will erase server-only notes.")) {
      return;
    }
    syncStatus.textContent = "Replacing server notes…";
    try {
      updateCurrentNoteTextFromEditor();
      recordVersionForNote(state.currentId, { force: true });
      await replaceServerWithLocal({ endpoint: syncEndpointInput.value, token: syncTokenInput.value });
      syncStatus.textContent = "Server notes replaced from local.";
    } catch (e) {
      err("replaceServerWithLocal failed", { message: e?.message });
      syncStatus.textContent = "Replace failed. Check the log.";
    }
  });

  function refreshVersionList() {
    const note = getNoteById(state.currentId);
    if (!note) return;
    ensureNoteVersioning(note);
    versionSelect.innerHTML = "";
    const versions = [...note.versions].reverse();
    for (const version of versions) {
      const opt = document.createElement("option");
      const stamp = version.createdAt ? new Date(version.createdAt).toLocaleString() : "Unknown";
      const snippet = (version.text || "").replace(/\s+/g, " ").slice(0, 40);
      opt.value = version.id;
      opt.textContent = `${stamp} — ${snippet || "(empty)"}`;
      versionSelect.appendChild(opt);
    }
  }

  versionRestoreBtn.addEventListener("click", () => {
    const note = getNoteById(state.currentId);
    if (!note) return;
    ensureNoteVersioning(note);
    const selectedId = versionSelect.value;
    const version = note.versions.find((v) => v.id === selectedId);
    if (!version) return;
    if (!confirm("Restore this version? Current content will be saved as a new version.")) return;
    recordVersionForNote(note.id, { force: true });
    editor.value = version.text || "";
    resizeEditorToContent();
    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(true);
    history.pushUndoSnapshot(state.currentId, history.snapshotFromEditor(editor));
    refreshVersionList();
  });

  // =========================
  // Editor input: save + history + highlight
  // =========================
  const scheduleHistory = debounce(() => {
    history.pushUndoSnapshot(state.currentId, history.snapshotFromEditor(editor));
  }, 250);

  editor.addEventListener("input", () => {
    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(false);
    scheduleHistory();
    resizeEditorToContent();
  });

  editor.addEventListener("scroll", search.syncScroll);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;

    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      const snap = history.undo(state.currentId);
      if (!snap) return;
      applySnapshot(snap);
      updateCurrentNoteTextFromEditor(true);
      schedulePersist();
      return;
    }
    if ((mod && e.key.toLowerCase() === "z" && e.shiftKey) || (mod && e.key.toLowerCase() === "y")) {
      e.preventDefault();
      const snap = history.redo(state.currentId);
      if (!snap) return;
      applySnapshot(snap);
      updateCurrentNoteTextFromEditor(true);
      schedulePersist();
      return;
    }
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openOverlayById("findOverlay");
      findInput.focus();
      return;
    }
    if (mod && e.key.toLowerCase() === "h") {
      e.preventDefault();
      openOverlayById("replaceOverlay");
      replaceInput.focus();
    }
  });

  // =========================
  // Init
  // =========================
  ensureAtLeastOneNote();
  refreshNoteSelect();
  loadCurrentNoteToEditor();

  const prefs = loadPreferences();
  debug("Preferences loaded", prefs);
  setWrap(prefs.wrap);
  regexToggle.checked = prefs.regex;
  caseToggle.checked = prefs.caseSensitive;
  setLogVisible(prefs.logVisible);

  resizeEditorToContent();
  window.addEventListener("resize", resizeEditorToContent);

  search.scheduleHighlight(true);
  setupPwa({ log, warn, err });

  // Global error logs
  window.addEventListener("error", (e) => {
    err("window error", {
      message: e.message,
      source: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    err("unhandledrejection", { reason: String(e.reason), stack: e.reason?.stack });
  });
})();
