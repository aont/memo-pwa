import { nowIso, uid } from "./utils.js";
import { savePreference, STORAGE_KEYS } from "./storage.js";

function isValidIsoString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizeVersion(version, fallbackText, fallbackCreatedAt, fallbackId) {
  const createdAt = isValidIsoString(version?.createdAt)
    ? version.createdAt
    : isValidIsoString(fallbackCreatedAt)
      ? fallbackCreatedAt
      : nowIso();
  const text = typeof version?.text === "string" ? version.text : fallbackText;
  const id = typeof version?.id === "string" ? version.id : fallbackId;
  return { id, text, createdAt };
}

function normalizeNote(note) {
  const id = note?.id && typeof note.id === "string" ? note.id : uid();
  const title = typeof note?.title === "string" ? note.title : "Untitled";
  const text = typeof note?.text === "string" ? note.text : "";
  const rawCreatedAt = typeof note?.createdAt === "string" ? note.createdAt : null;
  const rawUpdatedAt = typeof note?.updatedAt === "string" ? note.updatedAt : null;
  const createdAt = isValidIsoString(rawCreatedAt) ? rawCreatedAt : nowIso();
  const updatedAt = isValidIsoString(rawUpdatedAt) ? rawUpdatedAt : nowIso();
  const fallbackCreatedAt = isValidIsoString(rawUpdatedAt)
    ? rawUpdatedAt
    : isValidIsoString(rawCreatedAt)
      ? rawCreatedAt
      : nowIso();
  const versionsRaw = Array.isArray(note?.versions) ? note.versions : [];
  const versions = versionsRaw.length
    ? versionsRaw.map((v, index) =>
        normalizeVersion(v, text, fallbackCreatedAt, `${id}-v${index}`)
      )
    : [normalizeVersion(null, text, fallbackCreatedAt, `${id}-v0`)];
  return { id, title, text, createdAt, updatedAt, versions };
}

function versionIds(note) {
  return Array.isArray(note?.versions) ? note.versions.map((v) => v.id) : [];
}

function noteUpdatedAt(note) {
  const updatedAt = note?.updatedAt;
  if (!isValidIsoString(updatedAt)) return 0;
  return Date.parse(updatedAt);
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
  debug,
  log,
  warn,
  err
}) {
  function normalizeEndpoint(endpoint) {
    return endpoint.trim().replace(/\/+$/, "");
  }

  function getEndpoint() {
    return localStorage.getItem(STORAGE_KEYS.serverEndpoint) || "";
  }

  function setEndpoint(endpoint) {
    savePreference(STORAGE_KEYS.serverEndpoint, normalizeEndpoint(endpoint));
  }

  function getToken() {
    return localStorage.getItem(STORAGE_KEYS.serverToken) || "";
  }

  function setToken(token) {
    savePreference(STORAGE_KEYS.serverToken, token.trim());
  }

  function buildAuthHeaders(token) {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  async function postAuth(endpoint, path, payload) {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      throw new Error("Auth endpoint is not set.");
    }
    debug?.("Auth request start", { endpoint: base, path, username: payload?.username });
    const start = performance.now();
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    debug?.("Auth request response", {
      endpoint: base,
      path,
      status: res.status,
      durationMs: Math.round(performance.now() - start)
    });
    if (!res.ok) {
      let details = `${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) details = `${details} (${body.error})`;
      } catch {
        // Ignore JSON parse errors.
      }
      throw new Error(`Auth failed: ${details}`);
    }
    return res.json();
  }

  async function registerUser({ endpoint, username, password }) {
    debug?.("Register attempt", { endpoint, username });
    const payload = await postAuth(endpoint, "/auth/register", { username, password });
    if (!payload?.token) {
      throw new Error("Register failed: token missing.");
    }
    debug?.("Register succeeded", { username });
    return payload.token;
  }

  async function loginUser({ endpoint, username, password }) {
    debug?.("Login attempt", { endpoint, username });
    const payload = await postAuth(endpoint, "/auth/login", { username, password });
    if (!payload?.token) {
      throw new Error("Login failed: token missing.");
    }
    debug?.("Login succeeded", { username });
    return payload.token;
  }

  async function fetchServerNotes(endpoint, token) {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      throw new Error("Sync endpoint is not set.");
    }
    debug?.("Fetch server notes start", { endpoint: base });
    const start = performance.now();
    const res = await fetch(`${base}/notes`, {
      method: "GET",
      headers: buildAuthHeaders(token)
    });
    if (!res.ok) {
      throw new Error(`Server responded ${res.status}`);
    }
    const payload = await res.json();
    const notes = Array.isArray(payload?.notes) ? payload.notes : [];
    debug?.("Fetch server notes completed", {
      endpoint: base,
      status: res.status,
      durationMs: Math.round(performance.now() - start),
      count: notes.length
    });
    return notes.map((note) => normalizeNote(note));
  }

  async function pushNotes(endpoint, notes, token) {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      throw new Error("Sync endpoint is not set.");
    }
    debug?.("Push notes start", { endpoint: base, count: notes.length });
    const start = performance.now();
    const res = await fetch(`${base}/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(token)
      },
      body: JSON.stringify({ notes })
    });
    if (!res.ok) {
      throw new Error(`Server responded ${res.status}`);
    }
    const payload = await res.json();
    debug?.("Push notes completed", {
      endpoint: base,
      status: res.status,
      durationMs: Math.round(performance.now() - start),
      received: payload?.received
    });
    return payload;
  }

  async function replaceNotes(endpoint, notes, token) {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      throw new Error("Sync endpoint is not set.");
    }
    debug?.("Replace notes start", { endpoint: base, count: notes.length });
    const start = performance.now();
    const res = await fetch(`${base}/notes`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(token)
      },
      body: JSON.stringify({ notes })
    });
    if (!res.ok) {
      throw new Error(`Server responded ${res.status}`);
    }
    const payload = await res.json();
    debug?.("Replace notes completed", {
      endpoint: base,
      status: res.status,
      durationMs: Math.round(performance.now() - start),
      received: payload?.received
    });
    return payload;
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

  async function syncNow({ endpoint, token }) {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      warn("Sync: endpoint not set");
      throw new Error("Sync endpoint is not set.");
    }
    setSavedState("Syncing…");
    log("Sync started", { endpoint: base });
    debug?.("Sync preflight", { localNotes: state.db.notes.length, currentId: state.currentId });

    for (const note of state.db.notes) {
      ensureNoteVersioning(note);
      recordVersionForNote(note.id, { force: false });
    }

    const serverNotes = await fetchServerNotes(base, token);
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
      const localIsPrefix = isPrefix(localVersions, serverVersions);
      const serverIsPrefix = isPrefix(serverVersions, localVersions);

      if (localIsPrefix && serverIsPrefix) {
        const localUpdatedAt = noteUpdatedAt(localNote);
        const serverUpdatedAt = noteUpdatedAt(serverNote);
        if (serverUpdatedAt > localUpdatedAt) {
          applyServerNote(localNote, serverNote);
          localUpdates += 1;
        } else if (localUpdatedAt > serverUpdatedAt) {
          toUpload.push(cloneNote(localNote));
          serverUpdates += 1;
        }
        continue;
      }

      if (localIsPrefix) {
        applyServerNote(localNote, serverNote);
        localUpdates += 1;
        continue;
      }

      if (serverIsPrefix) {
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
      await pushNotes(base, toUpload, token);
    }

    refreshNoteSelect();
    loadCurrentNoteToEditor();
    setSavedState("Saved");
    schedulePersist();

    log("Sync completed", { localUpdates, serverUpdates, conflicts });
  }

  async function replaceLocalWithServer({ endpoint, token }) {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      warn("Replace local: endpoint not set");
      throw new Error("Sync endpoint is not set.");
    }
    setSavedState("Syncing…");
    log("Replace local with server started", { endpoint: base });
    debug?.("Replace local preflight", { localNotes: state.db.notes.length, currentId: state.currentId });

    const serverNotes = await fetchServerNotes(base, token);
    state.db.notes = serverNotes.map((note) => cloneNote(note));
    for (const note of state.db.notes) {
      ensureNoteVersioning(note);
    }

    if (!state.db.notes.some((note) => note.id === state.currentId)) {
      state.currentId = state.db.notes[0]?.id || null;
    }

    refreshNoteSelect();
    loadCurrentNoteToEditor();
    setSavedState("Saved");
    schedulePersist();

    log("Replace local with server completed", { notes: state.db.notes.length });
  }

  async function replaceServerWithLocal({ endpoint, token }) {
    const base = normalizeEndpoint(endpoint);
    if (!base) {
      warn("Replace server: endpoint not set");
      throw new Error("Sync endpoint is not set.");
    }
    setSavedState("Syncing…");
    log("Replace server with local started", { endpoint: base });
    debug?.("Replace server preflight", { localNotes: state.db.notes.length, currentId: state.currentId });

    for (const note of state.db.notes) {
      ensureNoteVersioning(note);
      recordVersionForNote(note.id, { force: false });
    }

    await replaceNotes(base, state.db.notes.map((note) => cloneNote(note)), token);
    setSavedState("Saved");
    schedulePersist();

    log("Replace server with local completed", { notes: state.db.notes.length });
  }

  return {
    getEndpoint,
    setEndpoint,
    getToken,
    setToken,
    registerUser,
    loginUser,
    syncNow,
    replaceLocalWithServer,
    replaceServerWithLocal
  };
}
