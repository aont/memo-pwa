import { nowIso, uid } from "./utils.js";

export const STORAGE_KEYS = {
  notes: "memo:notes:v3",
  current: "memo:current:v2",
  wrap: "memo:wrap:v1",
  theme: "memo:theme:v1",
  caseSensitive: "memo:case:v1",
  regex: "memo:regex:v1",
  logUi: "memo:logui:v1",
  logLevel: "memo:loglevel:v1",
  serverEndpoint: "memo:server:endpoint:v1",
  serverToken: "memo:server:token:v1"
};

function normalizeVersion(version, fallbackText) {
  const createdAt =
    version?.createdAt && typeof version.createdAt === "string" ? version.createdAt : nowIso();
  const text = typeof version?.text === "string" ? version.text : fallbackText;
  const id = version?.id && typeof version.id === "string" ? version.id : uid();
  return { id, text, createdAt };
}

function normalizeNote(note) {
  const id = note?.id && typeof note.id === "string" ? note.id : uid();
  const title = typeof note?.title === "string" ? note.title : "Untitled";
  const text = typeof note?.text === "string" ? note.text : "";
  const createdAt = note?.createdAt && typeof note.createdAt === "string" ? note.createdAt : nowIso();
  const updatedAt = note?.updatedAt && typeof note.updatedAt === "string" ? note.updatedAt : nowIso();
  const versionsRaw = Array.isArray(note?.versions) ? note.versions : [];
  const versions = versionsRaw.length
    ? versionsRaw.map((v) => normalizeVersion(v, text))
    : [normalizeVersion(null, text)];
  return { id, title, text, createdAt, updatedAt, versions };
}

export function loadNotes(logger) {
  let db = { version: 3, notes: [] };
  let currentId = null;

  const raw = localStorage.getItem(STORAGE_KEYS.notes) || localStorage.getItem("memo:notes:v2");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.notes)) {
        db = { version: 3, notes: parsed.notes.map((note) => normalizeNote(note)) };
        logger?.log?.("DB loaded", { notes: db.notes.length });
        logger?.debug?.("DB load detail", { version: parsed.version ?? "unknown" });
      }
    } catch (e) {
      logger?.warn?.("DB parse failed", { message: e?.message });
    }
  }

  const legacy = localStorage.getItem("memo:text:v1");
  if (legacy != null && db.notes.length === 0) {
    const id = uid();
    db.notes.push(
      normalizeNote({
        id,
        title: "Migrated Memo",
        text: legacy,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    currentId = id;
    logger?.log?.("Migrated legacy memo:text:v1");
  }

  currentId = localStorage.getItem(STORAGE_KEYS.current) || currentId;
  logger?.debug?.("DB current note", { currentId });
  return { db, currentId };
}

export function saveNotes(db, currentId) {
  localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(db));
  if (currentId) localStorage.setItem(STORAGE_KEYS.current, currentId);
}

export function loadPreferences() {
  return {
    wrap: localStorage.getItem(STORAGE_KEYS.wrap) !== "0",
    theme: localStorage.getItem(STORAGE_KEYS.theme) || "light",
    regex: localStorage.getItem(STORAGE_KEYS.regex) === "1",
    caseSensitive: localStorage.getItem(STORAGE_KEYS.caseSensitive) === "1",
    logVisible: localStorage.getItem(STORAGE_KEYS.logUi) === "1"
  };
}

export function savePreference(key, value) {
  localStorage.setItem(key, value);
}
