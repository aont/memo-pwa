import { nowIso, uid } from "./utils.js";

export function createImportExportController({
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
}) {
  function buildExportPayload(mode) {
    const notes = mode === "all" ? state.db.notes : state.db.notes.filter((n) => n.id === state.currentId);

    return {
      app: "memo-pwa",
      schema: 2,
      exportedAt: nowIso(),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        text: n.text,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        versions: Array.isArray(n.versions) ? n.versions : []
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
    const safeTitle = (getNoteById(state.currentId)?.title || "memo")
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
    const rawVersions = Array.isArray(n?.versions) ? n.versions : [];
    const versions =
      rawVersions.length > 0
        ? rawVersions.map((version) => ({
            id: typeof version?.id === "string" ? version.id : uid(),
            text: typeof version?.text === "string" ? version.text : text,
            createdAt: typeof version?.createdAt === "string" ? version.createdAt : updatedAt
          }))
        : [{ id: uid(), text, createdAt: updatedAt }];
    return { title, text, createdAt, updatedAt, versions };
  }

  function importPayload(payload) {
    if (!payload || !Array.isArray(payload.notes)) {
      alert("Invalid import format (missing notes array).");
      warn("importPayload(): invalid format");
      return;
    }

    updateCurrentNoteTextFromEditor();
    const existingIds = new Set(state.db.notes.map((n) => n.id));

    let imported = 0;
    let lastImportedId = null;

    for (const item of payload.notes) {
      const normalized = normalizeImportedNote(item);
      let id = item?.id && typeof item.id === "string" ? item.id : uid();
      if (existingIds.has(id)) id = uid();

      state.db.notes.push({
        id,
        title: normalized.title,
        text: normalized.text,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt,
        versions: normalized.versions
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

    state.currentId = lastImportedId;
    refreshNoteSelect();
    loadCurrentNoteToEditor();
    setSavedState("Saving…");
    schedulePersist();

    log("importPayload()", { imported, currentId: state.currentId });
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

  return {
    exportSelected,
    exportAll,
    importFromFile
  };
}
