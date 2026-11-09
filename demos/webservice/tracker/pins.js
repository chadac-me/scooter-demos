// Pin overlay and live reload, injected into app pages by server.py.
(() => {
  "use strict";
  const API = new URL("../api/", location.href);
  const MODE_KEY = "tracker.pinMode";
  const TOAST_KEY = "tracker.reloaded";

  const css = `
    #tw-root { position: absolute; inset: 0 auto auto 0; z-index: 2147483000; font: 13px/1.4 Inter, system-ui, sans-serif; }
    #tw-root * { box-sizing: border-box; }
    .tw-pin { position: absolute; display: flex; align-items: center; gap: 8px; transform: translate(-13px, -13px); pointer-events: auto; }
    .tw-pin.flip { flex-direction: row-reverse; transform: translate(calc(-100% + 13px), -13px); }
    .tw-dot {
      flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
      background: #f97316; color: #fff; font-weight: 700; font-size: 13px;
      box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 4px 12px rgba(0,0,0,.25);
      transition: background .35s, transform .35s;
    }
    .tw-pin.open .tw-dot { animation: tw-pulse 1.6s ease-out infinite; }
    .tw-pin.resolved .tw-dot { background: #16a34a; animation: tw-pop .45s ease-out; }
    .tw-label {
      max-width: 240px; padding: 6px 10px; border-radius: 8px; white-space: normal;
      background: #1f2937; color: #f9fafb; box-shadow: 0 6px 18px rgba(0,0,0,.25);
      transition: opacity .35s, transform .35s;
    }
    .tw-pin.resolved .tw-label { opacity: 0; transform: scale(.9); pointer-events: none; }
    .tw-pin.resolved:hover .tw-label { opacity: 1; transform: none; }
    @keyframes tw-pulse { 0% { box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 0 3px rgba(249,115,22,.55); }
                          100% { box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 0 14px rgba(249,115,22,0); } }
    @keyframes tw-pop { 0% { transform: scale(.6); } 60% { transform: scale(1.2); } 100% { transform: scale(1); } }
    #tw-hl { position: fixed; pointer-events: none; border: 2px solid #f97316; background: rgba(249,115,22,.08);
             border-radius: 4px; transition: all .08s ease-out; display: none; z-index: 2147483001; }
    #tw-pop { position: absolute; width: 280px; padding: 10px; border-radius: 10px; pointer-events: auto;
              background: #fff; color: #111827; box-shadow: 0 10px 30px rgba(0,0,0,.25); border: 1px solid #e5e7eb; z-index: 2147483002; }
    #tw-pop textarea { width: 100%; height: 64px; resize: none; border: 1px solid #d1d5db; border-radius: 6px;
                       padding: 6px 8px; font: inherit; color: inherit; background: #fff; outline: none; }
    #tw-pop textarea:focus { border-color: #f97316; }
    #tw-pop .row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; color: #6b7280; font-size: 12px; }
    #tw-pop button { border: 0; border-radius: 6px; padding: 5px 12px; background: #f97316; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    #tw-toggle {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483003; display: flex; align-items: center; gap: 8px;
      border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer; font: 600 13px Inter, system-ui, sans-serif;
      background: #111827; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25);
    }
    #tw-toggle.on { background: #f97316; }
    #tw-toast {
      position: fixed; left: 20px; bottom: 20px; z-index: 2147483003; padding: 8px 14px; border-radius: 999px;
      background: #111827; color: #fff; font: 500 12px Inter, system-ui, sans-serif; opacity: 0; transform: translateY(8px);
      transition: opacity .25s, transform .25s; pointer-events: none;
    }
    #tw-toast.show { opacity: 1; transform: none; }
    html.tw-picking, html.tw-picking * { cursor: crosshair !important; }
    @media (prefers-color-scheme: dark) {
      .tw-dot { box-shadow: 0 0 0 3px rgba(17,24,39,.9), 0 4px 12px rgba(0,0,0,.5); }
      #tw-pop { background: #1f2937; color: #f9fafb; border-color: #374151; }
      #tw-pop textarea { background: #111827; border-color: #4b5563; }
      #tw-pop .row { color: #9ca3af; }
      #tw-toggle, #tw-toast { background: #f9fafb; color: #111827; }
      .tw-label { background: #f9fafb; color: #111827; }
    }`;

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.assign(n, attrs);
    n.append(...kids);
    return n;
  };
  document.head.append(el("style", { textContent: css }));
  const root = el("div", { id: "tw-root" });
  const hl = el("div", { id: "tw-hl" });
  const toggle = el("button", { id: "tw-toggle", type: "button" });
  const toast = el("div", { id: "tw-toast" });
  document.body.append(root, hl, toggle, toast);
  const ours = (n) => n && (n.closest?.("#tw-root, #tw-toggle, #tw-toast") || n === hl);

  // A selector that survives the app re-rendering its markup.
  function selectorFor(node) {
    const parts = [];
    for (let n = node; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id) {
        parts.unshift(`#${CSS.escape(n.id)}`);
        break;
      }
      let part = n.localName;
      const stable = ["col", "id"].find((k) => n.dataset[k]);
      if (stable) part += `[data-${stable}="${n.dataset[stable]}"]`;
      else {
        const cls = [...n.classList].slice(0, 2);
        if (cls.length) part += "." + cls.map(CSS.escape).join(".");
        const same = n.parentElement ? [...n.parentElement.children].filter((s) => s.matches(part)) : [];
        if (same.length > 1) part += `:nth-of-type(${[...n.parentElement.children].filter((s) => s.localName === n.localName).indexOf(n) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  }

  let pins = [];
  const views = new Map();

  function render() {
    for (const [id, v] of views) if (!pins.some((p) => p.id === id)) (v.remove(), views.delete(id));
    for (const p of pins) {
      let v = views.get(p.id);
      if (!v) {
        v = el("div", { className: "tw-pin" }, el("span", { className: "tw-dot" }), el("span", { className: "tw-label" }));
        v.dataset.pin = p.id;
        root.append(v);
        views.set(p.id, v);
      }
      v.classList.toggle("open", !p.resolved);
      v.classList.toggle("resolved", p.resolved);
      v.firstChild.textContent = p.resolved ? "✓" : String(p.id);
      v.lastChild.textContent = p.note;
    }
  }

  // Follow each pin's element as the page lays out, scrolls or reloads.
  function place() {
    for (const p of pins) {
      const v = views.get(p.id);
      let target = null;
      try {
        target = p.selector && document.querySelector(p.selector);
      } catch {}
      let x = p.x, y = p.y;
      if (target) {
        const r = target.getBoundingClientRect();
        x = r.left + scrollX + r.width * p.fx;
        y = r.top + scrollY + r.height * p.fy;
      }
      v.style.left = `${x}px`;
      v.style.top = `${y}px`;
      v.classList.toggle("flip", x + 280 > document.documentElement.clientWidth);
    }
    requestAnimationFrame(place);
  }

  async function load() {
    pins = await (await fetch(new URL("pins", API))).json();
    render();
  }

  let picking = sessionStorage.getItem(MODE_KEY) === "1";
  let draft = null;
  function setPicking(on) {
    picking = on;
    sessionStorage.setItem(MODE_KEY, on ? "1" : "0");
    document.documentElement.classList.toggle("tw-picking", on);
    toggle.classList.toggle("on", on);
    toggle.textContent = on ? "✕  Done pinning" : "📍  Pin a note";
    if (!on) (hl.style.display = "none", closeDraft());
  }

  function closeDraft() {
    draft?.pop.remove();
    draft?.marker.remove();
    draft = null;
  }

  function hover(e) {
    if (!picking || draft) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || ours(t) || t === document.documentElement || t === document.body) return (hl.style.display = "none");
    const r = t.getBoundingClientRect();
    Object.assign(hl.style, { display: "block", left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  }

  function pick(e) {
    if (!picking || ours(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (draft) return closeDraft();
    const t = e.target;
    const r = t.getBoundingClientRect();
    const x = e.clientX + scrollX, y = e.clientY + scrollY;
    const marker = el("div", { className: "tw-pin open" }, el("span", { className: "tw-dot", textContent: "+" }));
    Object.assign(marker.style, { left: `${x}px`, top: `${y}px` });
    const note = el("textarea", { id: "tw-note", placeholder: "Leave a note for Scooter" });
    const send = el("button", { id: "tw-send", type: "button", textContent: "Send" });
    const pop = el("div", { id: "tw-pop" }, note, el("div", { className: "row" }, el("span", { textContent: "Enter to send" }), send));
    const left = Math.min(x + 18, scrollX + document.documentElement.clientWidth - 296);
    Object.assign(pop.style, { left: `${left}px`, top: `${y + 18}px` });
    root.append(marker, pop);
    hl.style.display = "none";
    draft = {
      pop, marker,
      body: {
        selector: selectorFor(t),
        text: t.innerText ?? "",
        fx: r.width ? (e.clientX - r.left) / r.width : 0.5,
        fy: r.height ? (e.clientY - r.top) / r.height : 0.5,
        x, y,
      },
    };
    const submit = async () => {
      const text = note.value.trim();
      if (!text || !draft) return;
      const body = { ...draft.body, note: text };
      closeDraft();
      const res = await fetch(new URL("pins", API), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        const pin = await res.json();
        if (!pins.some((p) => p.id === pin.id)) pins.push(pin);
        render();
      }
    };
    note.addEventListener("keydown", (k) => {
      if (k.key === "Enter" && !k.shiftKey) (k.preventDefault(), submit());
      if (k.key === "Escape") closeDraft();
    });
    send.addEventListener("click", submit);
    setTimeout(() => note.focus(), 0);
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  // CSS swaps in place; any other change reloads the page.
  function onChange(paths) {
    const note = `↻ ${paths.join(", ")} updated`;
    if (paths.every((p) => p.endsWith(".css"))) {
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const u = new URL(link.href);
        u.searchParams.set("v", Date.now());
        link.href = u.href;
      }
      return showToast(note);
    }
    sessionStorage.setItem(TOAST_KEY, note);
    location.reload();
  }

  toggle.addEventListener("click", () => setPicking(!picking));
  document.addEventListener("mousemove", hover, true);
  document.addEventListener("click", pick, true);
  addEventListener("keydown", (k) => k.key === "Escape" && !draft && picking && setPicking(false));

  const events = new EventSource(new URL("events", API));
  events.addEventListener("change", (e) => onChange(JSON.parse(e.data)));
  events.addEventListener("pins", (e) => ((pins = JSON.parse(e.data)), render()));

  setPicking(picking);
  const reloaded = sessionStorage.getItem(TOAST_KEY);
  if (reloaded) (sessionStorage.removeItem(TOAST_KEY), showToast(reloaded));
  load().then(() => requestAnimationFrame(place));
})();
