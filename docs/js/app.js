import { debounce, nowIso, uid } from "./modules/utils.js";
import { createLogger } from "./modules/logger.js";
import { createHistoryStore } from "./modules/history.js";
import { createSearchController } from "./modules/search.js";
import { STORAGE_KEYS, loadNotes, loadPreferences, saveNotes, savePreference } from "./modules/storage.js";
import { setupPwa } from "./modules/pwa.js";

(() => {
  // =========================
  // Elements
  // =========================
  const editor = document.getElementById("editor");
  const highlightLayer = document.getElementById("highlightLayer");

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

  // Dialogs & UI
  const openOverlay = document.getElementById("openOverlay");
  const renameOverlay = document.getElementById("renameOverlay");
  const findOverlay = document.getElementById("findOverlay");
  const replaceOverlay = document.getElementById("replaceOverlay");

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

  // =========================
  // Logger
  // =========================
  const { log, warn, err } = createLogger(logEl);

  // =========================
  // DB
  // =========================
  const loadResult = loadNotes({ log, warn });
  let db = loadResult.db;
  let currentId = loadResult.currentId;

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

  function applySnapshot(snap) {
    editor.value = snap.text;
    editor.focus();
    editor.setSelectionRange(snap.selStart, snap.selEnd);
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
  }

  // =========================
  // Notes helpers
  // =========================
  function sortNotes() {
    db.notes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  function ensureAtLeastOneNote() {
    if (db.notes.length) return;
    const id = uid();
    db.notes.push({ id, title: "New Memo", text: "", createdAt: nowIso(), updatedAt: nowIso() });
    currentId = id;
  }

  function getNoteById(id) {
    return db.notes.find((n) => n.id === id);
  }

  function updateCurrentNoteTextFromEditor(silent = false) {
    const note = getNoteById(currentId);
    if (!note) return;
    note.text = editor.value;
    note.updatedAt = nowIso();
    if (!silent) log("updateCurrentNoteTextFromEditor()", { noteId: currentId });
  }

  function refreshNoteSelect() {
    sortNotes();
    noteSelect.innerHTML = "";
    for (const note of db.notes) {
      const opt = document.createElement("option");
      opt.value = note.id;
      opt.textContent = note.title || "Untitled";
      noteSelect.appendChild(opt);
    }
    noteSelect.value = currentId;
  }

  function loadCurrentNoteToEditor() {
    const note = getNoteById(currentId);
    if (!note) return;
    editor.value = note.text || "";
    currentTitle.textContent = note.title || "Untitled";
    search.scheduleHighlight(true);
    search.syncScroll();
    setSavedState("Saved");

    const snap = history.snapshotFromEditor(editor);
    history.resetHistory(currentId, snap);
  }

  function createNote() {
    updateCurrentNoteTextFromEditor();
    const id = uid();
    const note = { id, title: "New Memo", text: "", createdAt: nowIso(), updatedAt: nowIso() };
    db.notes.unshift(note);
    currentId = id;
    refreshNoteSelect();
    loadCurrentNoteToEditor();
    setSavedState("Saving…");
    schedulePersist();
    log("createNote()", { noteId: id });
  }

  function switchNote(id) {
    if (!id || id === currentId) return;
    updateCurrentNoteTextFromEditor();
    currentId = id;
    localStorage.setItem(STORAGE_KEYS.current, currentId);
    loadCurrentNoteToEditor();
    log("switchNote()", { noteId: id });
  }

  function renameCurrent() {
    const note = getNoteById(currentId);
    if (!note) return;
    const title = titleInput.value.trim() || "Untitled";
    note.title = title;
    note.updatedAt = nowIso();
    currentTitle.textContent = title;
    refreshNoteSelect();
    setSavedState("Saving…");
    schedulePersist();
    log("renameCurrent()", { noteId: currentId, title });
  }

  function deleteCurrent() {
    if (!confirm("Delete this memo?")) return;
    const idx = db.notes.findIndex((n) => n.id === currentId);
    if (idx === -1) return;
    const [n] = db.notes.splice(idx, 1);
    currentId = db.notes[Math.max(0, idx - 1)]?.id || db.notes[0]?.id || null;

    refreshNoteSelect();
    if (currentId) {
      loadCurrentNoteToEditor();
    } else {
      editor.value = "";
      currentTitle.textContent = "—";
      setSavedState("Saved");
    }

    setSavedState("Saving…");
    schedulePersist();
    log("deleteCurrent()", { deletedId: n?.id, remaining: db.notes.length });
  }

  // =========================
  // Export / Import
  // =========================
  function buildExportPayload(mode) {
    const notes = mode === "all" ? db.notes : db.notes.filter((n) => n.id === currentId);

    return {
      app: "memo-pwa",
      schema: 1,
      exportedAt: nowIso(),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        text: n.text,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt
      }))
    };
  }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSelected() {
    updateCurrentNoteTextFromEditor();
    const payload = buildExportPayload("selected");
    const safeTitle = (getNoteById(currentId)?.title || "memo")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 40);
    downloadJson(payload, `memo_selected_${safeTitle}.json`);
    log("exportSelected()", { notes: payload.notes.length });
  }

  function exportAll() {
    updateCurrentNoteTextFromEditor();
    const payload = buildExportPayload("all");
    downloadJson(payload, `memo_all_${new Date().toISOString().slice(0, 10)}.json`);
    log("exportAll()", { notes: payload.notes.length });
  }

  function normalizeImportedNote(n) {
    const title = (n?.title ?? "Untitled").toString();
    const text = (n?.text ?? "").toString();
    const createdAt = n?.createdAt && typeof n.createdAt === "string" ? n.createdAt : nowIso();
    const updatedAt = n?.updatedAt && typeof n.updatedAt === "string" ? n.updatedAt : nowIso();
    return { title, text, createdAt, updatedAt };
  }

  function importPayload(payload) {
    if (!payload || !Array.isArray(payload.notes)) {
      alert("Invalid import format (missing notes array).");
      warn("importPayload(): invalid format");
      return;
    }

    updateCurrentNoteTextFromEditor();
    const existingIds = new Set(db.notes.map((n) => n.id));

    let imported = 0;
    let lastImportedId = null;

    for (const item of payload.notes) {
      const normalized = normalizeImportedNote(item);
      let id = item?.id && typeof item.id === "string" ? item.id : uid();
      if (existingIds.has(id)) id = uid();

      db.notes.push({
        id,
        title: normalized.title,
        text: normalized.text,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt
      });
      existingIds.add(id);
      imported += 1;
      lastImportedId = id;

      const h = history.getHistory(id);
      h.undo = [{ text: normalized.text, selStart: 0, selEnd: 0 }];
      h.redo = [];
    }

    if (imported === 0) {
      alert("No memos were imported.");
      return;
    }

    currentId = lastImportedId;
    refreshNoteSelect();
    loadCurrentNoteToEditor();
    setSavedState("Saving…");
    schedulePersist();

    log("importPayload()", { imported, currentId });
    alert(`Imported ${imported} memo(s).`);
  }

  async function importFromFile(file) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      importPayload(payload);
    } catch (e) {
      err("importFromFile failed", { message: e?.message });
      alert("Import failed. Please check the JSON format.");
    }
  }

  // =========================
  // Persistence
  // =========================
  const persistNow = () => {
    saveNotes(db, currentId);
    setSavedState("Saved");
    log("persistNow()", { notes: db.notes.length, currentId });
  };
  const schedulePersist = debounce(persistNow, 800);

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
    for (const id of ["openOverlay", "renameOverlay", "findOverlay", "replaceOverlay"]) {
      closeOverlayById(id);
    }
  }

  document.addEventListener("click", (e) => {
    const closeId = e.target?.getAttribute?.("data-close");
    if (closeId) closeOverlayById(closeId);
  });

  for (const ov of [openOverlay, renameOverlay, findOverlay, replaceOverlay]) {
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
    titleInput.value = getNoteById(currentId)?.title || "";
    openOverlayById("renameOverlay");
    titleInput.focus();
  });

  mUndo.addEventListener("click", () => {
    closeMenus();
    const snap = history.undo(currentId);
    if (!snap) return;
    applySnapshot(snap);
    updateCurrentNoteTextFromEditor(true);
    schedulePersist();
    log("Undo", { noteId: currentId });
  });
  mRedo.addEventListener("click", () => {
    closeMenus();
    const snap = history.redo(currentId);
    if (!snap) return;
    applySnapshot(snap);
    updateCurrentNoteTextFromEditor(true);
    schedulePersist();
    log("Redo", { noteId: currentId });
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
    renameCurrent();
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

    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(true);

    history.pushUndoSnapshot(currentId, history.snapshotFromEditor(editor));
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

    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(true);

    history.pushUndoSnapshot(currentId, history.snapshotFromEditor(editor));
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear the memo content?")) return;
    editor.value = "";
    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(true);
    history.pushUndoSnapshot(currentId, history.snapshotFromEditor(editor));
  });

  // Import file
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) return;
    await importFromFile(file);
  });

  // =========================
  // Editor input: save + history + highlight
  // =========================
  const scheduleHistory = debounce(() => {
    history.pushUndoSnapshot(currentId, history.snapshotFromEditor(editor));
  }, 250);

  editor.addEventListener("input", () => {
    setSavedState("Saving…");
    updateCurrentNoteTextFromEditor();
    schedulePersist();
    search.scheduleHighlight(false);
    scheduleHistory();
  });

  editor.addEventListener("scroll", search.syncScroll);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;

    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      const snap = history.undo(currentId);
      if (!snap) return;
      applySnapshot(snap);
      updateCurrentNoteTextFromEditor(true);
      schedulePersist();
      return;
    }
    if ((mod && e.key.toLowerCase() === "z" && e.shiftKey) || (mod && e.key.toLowerCase() === "y")) {
      e.preventDefault();
      const snap = history.redo(currentId);
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
  setWrap(prefs.wrap);
  regexToggle.checked = prefs.regex;
  caseToggle.checked = prefs.caseSensitive;
  setLogVisible(prefs.logVisible);

  search.scheduleHighlight(true);
  setupPwa({ log, warn, err });

  // Global error logs
  window.addEventListener("error", (e) => {
    err("window error", { message: e.message, source: e.filename, line: e.lineno, col: e.colno });
  });
  window.addEventListener("unhandledrejection", (e) => {
    err("unhandledrejection", { reason: String(e.reason) });
  });
})();
