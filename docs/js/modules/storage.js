import { nowIso, uid } from "./utils.js";

export const STORAGE_KEYS = {
  notes: "memo:notes:v2",
  current: "memo:current:v2",
  wrap: "memo:wrap:v1",
  caseSensitive: "memo:case:v1",
  regex: "memo:regex:v1",
  logUi: "memo:logui:v1"
};

export function loadNotes(logger) {
  let db = { version: 2, notes: [] };
  let currentId = null;

  const raw = localStorage.getItem(STORAGE_KEYS.notes);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.notes)) {
        db = { version: 2, notes: parsed.notes };
        logger?.log?.("DB loaded", { notes: db.notes.length });
      }
    } catch (e) {
      logger?.warn?.("DB parse failed", { message: e?.message });
    }
  }

  const legacy = localStorage.getItem("memo:text:v1");
  if (legacy != null && db.notes.length === 0) {
    const id = uid();
    db.notes.push({
      id,
      title: "Migrated Memo",
      text: legacy,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    currentId = id;
    logger?.log?.("Migrated legacy memo:text:v1");
  }

  currentId = localStorage.getItem(STORAGE_KEYS.current) || currentId;
  return { db, currentId };
}

export function saveNotes(db, currentId) {
  localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(db));
  if (currentId) localStorage.setItem(STORAGE_KEYS.current, currentId);
}

export function loadPreferences() {
  return {
    wrap: localStorage.getItem(STORAGE_KEYS.wrap) !== "0",
    regex: localStorage.getItem(STORAGE_KEYS.regex) === "1",
    caseSensitive: localStorage.getItem(STORAGE_KEYS.caseSensitive) === "1",
    logVisible: localStorage.getItem(STORAGE_KEYS.logUi) === "1"
  };
}

export function savePreference(key, value) {
  localStorage.setItem(key, value);
}
