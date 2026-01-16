const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const LEVEL_LABELS = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR"
};

function normalizeLevel(level) {
  if (!level || typeof level !== "string") return "debug";
  const key = level.toLowerCase();
  return LEVELS[key] === undefined ? "debug" : key;
}

function resolveLevel(explicitLevel) {
  if (explicitLevel) return normalizeLevel(explicitLevel);
  const stored = localStorage.getItem("memo:loglevel:v1");
  if (stored) return normalizeLevel(stored);
  const query = new URLSearchParams(window.location.search);
  const fromQuery = query.get("log");
  if (fromQuery) return normalizeLevel(fromQuery);
  return "debug";
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function normalizePayload(payload) {
  if (!payload) return payload;
  if (payload instanceof Error) {
    return { message: payload.message, stack: payload.stack };
  }
  if (payload?.error instanceof Error) {
    return { ...payload, error: { message: payload.error.message, stack: payload.error.stack } };
  }
  return payload;
}

export function createLogger(logEl, { level } = {}) {
  const LOG_MAX = 260;
  let logLines = [];
  const minLevel = resolveLevel(level);

  function safeJson(obj) {
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unserializable]";
    }
  }

  function shouldLog(levelName) {
    return LEVELS[levelName] >= LEVELS[minLevel];
  }

  function pushLog(levelName, msg, obj) {
    if (!shouldLog(levelName)) return;
    const payload = normalizePayload(obj);
    const label = LEVEL_LABELS[levelName] ?? "UNK";
    const line = `[${formatTimestamp()}] ${label} ${msg}` + (payload ? ` ${safeJson(payload)}` : "");
    logLines.push(line);
    if (logLines.length > LOG_MAX) logLines = logLines.slice(logLines.length - LOG_MAX);
    logEl.textContent = logLines.join("\n");
    logEl.scrollTop = logEl.scrollHeight;

    if (levelName === "error") console.error(line, payload ?? "");
    else if (levelName === "warn") console.warn(line, payload ?? "");
    else if (levelName === "debug") console.debug(line, payload ?? "");
    else console.log(line, payload ?? "");
  }

  const debug = (m, o) => pushLog("debug", m, o);
  const log = (m, o) => pushLog("info", m, o);
  const warn = (m, o) => pushLog("warn", m, o);
  const err = (m, o) => pushLog("error", m, o);

  return {
    debug,
    log,
    warn,
    err,
    getLevel: () => minLevel
  };
}
