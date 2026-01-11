export function createLogger(logEl) {
  const LOG_MAX = 260;
  let logLines = [];

  function ts() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function safeJson(obj) {
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unserializable]";
    }
  }

  function pushLog(level, msg, obj) {
    const line = `[${ts()}] ${level} ${msg}` + (obj ? ` ${safeJson(obj)}` : "");
    logLines.push(line);
    if (logLines.length > LOG_MAX) logLines = logLines.slice(logLines.length - LOG_MAX);
    logEl.textContent = logLines.join("\n");
    logEl.scrollTop = logEl.scrollHeight;

    if (level === "ERR") console.error(line, obj ?? "");
    else if (level === "WRN") console.warn(line, obj ?? "");
    else console.log(line, obj ?? "");
  }

  const log = (m, o) => pushLog("INF", m, o);
  const warn = (m, o) => pushLog("WRN", m, o);
  const err = (m, o) => pushLog("ERR", m, o);

  return { log, warn, err };
}
