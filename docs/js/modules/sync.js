import { nowIso, uid } from "./utils.js";
import { savePreference, STORAGE_KEYS } from "./storage.js";

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

function versionIds(note) {
  return Array.isArray(note?.versions) ? note.versions.map((v) => v.id) : [];
}

function isPrefix(prefix, full) {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== full[i]) return false;
  }
  return true;
}

function cloneNote(note) {
  return {
    ...note,
    versions: Array.isArray(note.versions) ? note.versions.map((v) => ({ ...v })) : []
  };
}

export function createSyncController({
  state,
  ensureNoteVersioning,
  recordVersionForNote,
  refreshNoteSelect,
  loadCurrentNoteToEditor,
  setSavedState,
  schedulePersist,
  log,
  warn,
  err
}) {
  function getEndpoint() {
    return localStorage.getItem(STORAGE_KEYS.serverEndpoint) || "";
  }

  function setEndpoint(endpoint) {
    savePreference(STORAGE_KEYS.serverEndpoint, endpoint.trim());
  }

  async function fetchServerNotes(endpoint) {
    const res = await fetch(`${endpoint}/notes`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`Server responded ${res.status}`);
    }
    const payload = await res.json();
    const notes = Array.isArray(payload?.notes) ? payload.notes : [];
    return notes.map((note) => normalizeNote(note));
  }

  async function pushNotes(endpoint, notes) {
    const res = await fetch(`${endpoint}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes })
    });
    if (!res.ok) {
      throw new Error(`Server responded ${res.status}`);
    }
    return res.json();
  }

  function applyServerNote(localNote, serverNote) {
    Object.assign(localNote, cloneNote(serverNote));
  }

  function buildConflictCopy(localNote) {
    const timestamp = new Date().toLocaleString();
    const copy = cloneNote(localNote);
    copy.id = uid();
    copy.title = `${localNote.title || "Untitled"} (Local copy ${timestamp})`;
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    if (!Array.isArray(copy.versions) || copy.versions.length === 0) {
      copy.versions = [{ id: uid(), text: copy.text || "", createdAt: copy.updatedAt }];
    }
    return copy;
  }

  async function syncNow({ endpoint }) {
    const base = endpoint.trim().replace(/\/+$/, "");
    if (!base) {
      warn("Sync: endpoint not set");
      throw new Error("Sync endpoint is not set.");
    }
    setSavedState("Syncing…");
    log("Sync started", { endpoint: base });

    for (const note of state.db.notes) {
      ensureNoteVersioning(note);
      recordVersionForNote(note.id, { force: false });
    }

    const serverNotes = await fetchServerNotes(base);
    const serverById = new Map(serverNotes.map((note) => [note.id, note]));
    const localById = new Map(state.db.notes.map((note) => [note.id, note]));
    const toUpload = [];
    let localUpdates = 0;
    let serverUpdates = 0;
    let conflicts = 0;

    for (const serverNote of serverNotes) {
      const localNote = localById.get(serverNote.id);
      if (!localNote) {
        state.db.notes.push(cloneNote(serverNote));
        localUpdates += 1;
        continue;
      }

      ensureNoteVersioning(localNote);
      const localVersions = versionIds(localNote);
      const serverVersions = versionIds(serverNote);

      if (localVersions.length === serverVersions.length && isPrefix(localVersions, serverVersions)) {
        continue;
      }

      if (isPrefix(localVersions, serverVersions)) {
        applyServerNote(localNote, serverNote);
        localUpdates += 1;
        continue;
      }

      if (isPrefix(serverVersions, localVersions)) {
        toUpload.push(cloneNote(localNote));
        serverUpdates += 1;
        continue;
      }

      conflicts += 1;
      const copy = buildConflictCopy(localNote);
      state.db.notes.push(copy);
      toUpload.push(cloneNote(copy));
      serverUpdates += 1;
      applyServerNote(localNote, serverNote);
      if (state.currentId === localNote.id) {
        state.currentId = copy.id;
      }
    }

    for (const localNote of state.db.notes) {
      if (!serverById.has(localNote.id)) {
        toUpload.push(cloneNote(localNote));
        serverUpdates += 1;
      }
    }

    if (toUpload.length) {
      await pushNotes(base, toUpload);
    }

    refreshNoteSelect();
    loadCurrentNoteToEditor();
    setSavedState("Saved");
    schedulePersist();

    log("Sync completed", { localUpdates, serverUpdates, conflicts });
  }

  return {
    getEndpoint,
    setEndpoint,
    syncNow
  };
}
