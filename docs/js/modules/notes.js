import { nowIso, uid } from "./utils.js";
import { STORAGE_KEYS } from "./storage.js";

export function createNotesController({
  state,
  editor,
  currentTitle,
  noteSelect,
  history,
  search,
  setSavedState,
  schedulePersist,
  log,
  onEditorContentChange,
  confirmDelete = window.confirm
}) {
  const MIN_VERSION_INTERVAL_MS = 5000;

  function ensureNoteVersioning(note) {
    if (!note) return;
    if (!Array.isArray(note.versions) || note.versions.length === 0) {
      note.versions = [
        {
          id: uid(),
          text: note.text || "",
          createdAt: note.updatedAt || note.createdAt || nowIso()
        }
      ];
      return;
    }
    note.versions = note.versions.map((version) => ({
      id: typeof version?.id === "string" ? version.id : uid(),
      text: typeof version?.text === "string" ? version.text : note.text || "",
      createdAt:
        typeof version?.createdAt === "string" ? version.createdAt : note.updatedAt || note.createdAt || nowIso()
    }));
  }

  function getLastVersion(note) {
    ensureNoteVersioning(note);
    return note.versions[note.versions.length - 1];
  }

  function recordVersionForNote(noteId, { force = false } = {}) {
    const note = getNoteById(noteId);
    if (!note) return;
    ensureNoteVersioning(note);
    const last = getLastVersion(note);
    const now = Date.now();
    const lastTime = last?.createdAt ? Date.parse(last.createdAt) : 0;
    if (!force && lastTime && now - lastTime < MIN_VERSION_INTERVAL_MS) return;
    if (last && last.text === note.text) return;
    note.versions.push({ id: uid(), text: note.text || "", createdAt: nowIso() });
  }

  state.db.notes.forEach((note) => ensureNoteVersioning(note));

  function sortNotes() {
    state.db.notes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  function ensureAtLeastOneNote() {
    if (state.db.notes.length) return;
    const id = uid();
    state.db.notes.push({
      id,
      title: "New Memo",
      text: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      versions: [{ id: uid(), text: "", createdAt: nowIso() }]
    });
    state.currentId = id;
  }

  function getNoteById(id) {
    return state.db.notes.find((n) => n.id === id);
  }

  function updateCurrentNoteTextFromEditor(silent = false) {
    const note = getNoteById(state.currentId);
    if (!note) return;
    note.text = editor.value;
    note.updatedAt = nowIso();
    ensureNoteVersioning(note);
    if (!silent) log("updateCurrentNoteTextFromEditor()", { noteId: state.currentId });
  }

  function refreshNoteSelect() {
    sortNotes();
    noteSelect.innerHTML = "";
    for (const note of state.db.notes) {
      const opt = document.createElement("option");
      opt.value = note.id;
      opt.textContent = note.title || "Untitled";
      noteSelect.appendChild(opt);
    }
    if (state.currentId) {
      noteSelect.value = state.currentId;
    }
  }

  function loadCurrentNoteToEditor() {
    const note = getNoteById(state.currentId);
    if (!note) return;
    ensureNoteVersioning(note);
    editor.value = note.text || "";
    onEditorContentChange?.();
    currentTitle.textContent = note.title || "Untitled";
    search.scheduleHighlight(true);
    search.syncScroll();
    setSavedState("Saved");

    const snap = history.snapshotFromEditor(editor);
    history.resetHistory(state.currentId, snap);
  }

  function createNote() {
    updateCurrentNoteTextFromEditor();
    const id = uid();
    const note = {
      id,
      title: "New Memo",
      text: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      versions: [{ id: uid(), text: "", createdAt: nowIso() }]
    };
    state.db.notes.unshift(note);
    state.currentId = id;
    refreshNoteSelect();
    loadCurrentNoteToEditor();
    setSavedState("Saving…");
    schedulePersist();
    log("createNote()", { noteId: id });
  }

  function switchNote(id) {
    if (!id || id === state.currentId) return;
    updateCurrentNoteTextFromEditor();
    recordVersionForNote(state.currentId, { force: true });
    state.currentId = id;
    localStorage.setItem(STORAGE_KEYS.current, state.currentId);
    loadCurrentNoteToEditor();
    log("switchNote()", { noteId: id });
  }

  function renameCurrent(title) {
    const note = getNoteById(state.currentId);
    if (!note) return;
    ensureNoteVersioning(note);
    const nextTitle = title.trim() || "Untitled";
    note.title = nextTitle;
    note.updatedAt = nowIso();
    currentTitle.textContent = nextTitle;
    refreshNoteSelect();
    setSavedState("Saving…");
    schedulePersist();
    log("renameCurrent()", { noteId: state.currentId, title: nextTitle });
  }

  function deleteCurrent() {
    if (!confirmDelete("Delete this memo?")) return;
    const idx = state.db.notes.findIndex((n) => n.id === state.currentId);
    if (idx === -1) return;
    const [n] = state.db.notes.splice(idx, 1);
    state.currentId = state.db.notes[Math.max(0, idx - 1)]?.id || state.db.notes[0]?.id || null;

    refreshNoteSelect();
    if (state.currentId) {
      loadCurrentNoteToEditor();
    } else {
      editor.value = "";
      onEditorContentChange?.();
      currentTitle.textContent = "—";
      setSavedState("Saved");
    }

    setSavedState("Saving…");
    schedulePersist();
    log("deleteCurrent()", { deletedId: n?.id, remaining: state.db.notes.length });
  }

  return {
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
  };
}
