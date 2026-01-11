export function createSearchController({
  editor,
  highlightLayer,
  matchStatus,
  findInput,
  regexToggle,
  caseToggle
}) {
  let matches = [];
  let activeIndex = -1;
  let highlightTimer = null;

  const escapeHtml = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  function buildMatcher() {
    const query = findInput.value;
    if (!query) return { ok: false, reason: "empty" };
    const flags = caseToggle.checked ? "g" : "gi";
    if (regexToggle.checked) {
      try {
        const re = new RegExp(query, flags);
        return { ok: true, type: "regex", re };
      } catch (e) {
        return { ok: false, reason: "regex", error: e };
      }
    }
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc, flags);
    return { ok: true, type: "plain", re };
  }

  function updateMatchStatus() {
    if (!matches.length) {
      matchStatus.textContent = "0/0";
      return;
    }
    matchStatus.textContent = `${activeIndex + 1}/${matches.length}`;
  }

  function syncScroll() {
    highlightLayer.scrollTop = editor.scrollTop;
    highlightLayer.scrollLeft = editor.scrollLeft;
  }

  function renderHighlight() {
    const text = editor.value;
    const query = findInput.value;

    if (!query || !matches.length) {
      highlightLayer.innerHTML = escapeHtml(text) || "&nbsp;";
      syncScroll();
      return;
    }

    let out = "";
    let last = 0;
    for (let i = 0; i < matches.length; i += 1) {
      const { start, end } = matches[i];
      out += escapeHtml(text.slice(last, start));
      const cls = i === activeIndex ? "hit active" : "hit";
      out += `<span class="${cls}">${escapeHtml(text.slice(start, end))}</span>`;
      last = end;
      if (out.length > 2_000_000) break;
    }
    out += escapeHtml(text.slice(last));
    highlightLayer.innerHTML = out || "&nbsp;";
    syncScroll();
  }

  function computeMatches() {
    const m = buildMatcher();
    matches = [];
    activeIndex = -1;

    if (!m.ok) {
      matchStatus.textContent = m.reason === "regex" ? "ERR" : "0/0";
      renderHighlight();
      return;
    }

    const text = editor.value;
    let match;
    while ((match = m.re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) {
        m.re.lastIndex = start + 1;
        continue;
      }
      matches.push({ start, end });
      if (matches.length > 5000) break;
    }

    if (matches.length) {
      const caret = editor.selectionStart ?? 0;
      let idx = matches.findIndex((x) => x.start >= caret);
      if (idx === -1) idx = 0;
      activeIndex = idx;
    }

    updateMatchStatus();
    renderHighlight();
  }

  function scheduleHighlight(force = false) {
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => computeMatches(), force ? 0 : 80);
  }

  function scrollCaretIntoView(pos) {
    const before = editor.value.slice(0, pos);
    const lines = before.split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
    const targetY = Math.max(0, lines * lineHeight - editor.clientHeight * 0.3);
    editor.scrollTop = targetY;
    syncScroll();
  }

  function gotoMatch(idx) {
    if (!matches.length) return;
    activeIndex = (idx + matches.length) % matches.length;
    const { start, end } = matches[activeIndex];
    editor.focus();
    editor.setSelectionRange(start, end);
    scrollCaretIntoView(start);
    updateMatchStatus();
    renderHighlight();
  }

  function gotoNext() {
    gotoMatch(activeIndex + 1);
  }

  function gotoPrev() {
    gotoMatch(activeIndex - 1);
  }

  return {
    scheduleHighlight,
    computeMatches,
    renderHighlight,
    updateMatchStatus,
    syncScroll,
    gotoNext,
    gotoPrev,
    gotoMatch,
    getMatches: () => matches,
    getActiveIndex: () => activeIndex
  };
}
