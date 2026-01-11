export function createHistoryStore(limit = 120) {
  const historyMap = new Map();

  function getHistory(noteId) {
    if (!historyMap.has(noteId)) historyMap.set(noteId, { undo: [], redo: [] });
    return historyMap.get(noteId);
  }

  function snapshotFromEditor(editor) {
    return {
      text: editor.value,
      selStart: editor.selectionStart ?? 0,
      selEnd: editor.selectionEnd ?? 0
    };
  }

  function pushUndoSnapshot(noteId, snap) {
    const h = getHistory(noteId);
    const last = h.undo[h.undo.length - 1];
    if (last && last.text === snap.text && last.selStart === snap.selStart && last.selEnd === snap.selEnd) return;
    h.undo.push(snap);
    if (h.undo.length > limit) h.undo.shift();
    h.redo = [];
  }

  function undo(noteId) {
    const h = getHistory(noteId);
    if (h.undo.length <= 1) return null;
    const cur = h.undo.pop();
    h.redo.push(cur);
    return h.undo[h.undo.length - 1] ?? null;
  }

  function redo(noteId) {
    const h = getHistory(noteId);
    if (!h.redo.length) return null;
    const snap = h.redo.pop();
    h.undo.push(snap);
    return snap;
  }

  function resetHistory(noteId, snap) {
    const h = getHistory(noteId);
    h.undo = [snap];
    h.redo = [];
  }

  return {
    getHistory,
    snapshotFromEditor,
    pushUndoSnapshot,
    undo,
    redo,
    resetHistory
  };
}
