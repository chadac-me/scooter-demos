/**
 * The director: the helpers a scene uses to drive Scooter's UI the way a person
 * would on camera. Typing is paced, the pointer glides, and every wait is on a
 * UI state rather than a clock, so renders come out the same each time.
 */

// Selectors from scooter's test/e2e/fixtures.ts; they move when the UI does.
export const sel = {
  composer: '[aria-label="Message input"]',
  assistant: ".aui-assistant-message-content, .aui-md",
  thread: '[data-slot="aui_thread-viewport"]',
  runStatus: '[data-testid="run-status-bar"]',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A fake pointer, since a headed browser under Xvfb draws none. */
const CURSOR_BODY = `
  const c = document.createElement("div");
  c.id = "demo-cursor";
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: "fixed", left: "-40px", top: "-40px", zIndex: 2147483647, pointerEvents: "none", transition: "transform 120ms" });
  document.documentElement.appendChild(c);
  // Set by the director, since mouse events over an iframe never reach this document.
  window.__demoCursor = (x, y) => { c.style.left = x - 3 + "px"; c.style.top = y - 2 + "px"; };
  addEventListener("mousedown", () => { c.style.transform = "scale(0.85)"; }, true);
  addEventListener("mouseup", () => { c.style.transform = ""; }, true);
`;
const CURSOR_SCRIPT = `addEventListener("DOMContentLoaded", () => {${CURSOR_BODY}});`;

/** Hide what reads as harness rather than product. */
const DEMO_CSS = `
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
  * { scrollbar-width: none !important; }
  html { scroll-behavior: smooth; }
`;

/** The fast stack's noop sandbox never reports ready, so hide its status rather than show "starting" forever. */
export const FAST_STACK_CSS = `
  [data-testid="header-sandbox-status"], [data-testid="sandbox-status-banner"] { display: none !important; }
`;

export class Director {
  constructor(page, { markers, rng, css = "" }) {
    this.page = page;
    this.css = DEMO_CSS + css;
    this.markers = markers;
    this.rng = rng;
    this.pointer = { x: 720, y: 450 };
  }

  async prepare() {
    await this.page.addInitScript(CURSOR_SCRIPT);
    this.page.on("load", () => this.page.addStyleTag({ content: this.css }).catch(() => {}));
  }

  /** Note a point in the recording: begin, end and poster drive the trim. */
  mark(name) {
    this.markers.mark(name);
  }

  async open(path = "/") {
    await this.page.goto(path);
    await this.page.locator(sel.composer).first().waitFor({ state: "visible", timeout: 30_000 });
    await this.page.addStyleTag({ content: this.css });
    await this.page.mouse.move(this.pointer.x, this.pointer.y);
    await this.page.evaluate(([x, y]) => window.__demoCursor?.(x, y), [this.pointer.x, this.pointer.y]);
    await this.settle();
  }

  /** Wait for fonts and layout to stop moving. */
  async settle(ms = 400) {
    await this.page.evaluate(() => document.fonts.ready);
    await sleep(ms);
  }

  hold(ms) {
    return sleep(ms);
  }

  /** Glide the pointer to the centre of a locator. */
  async moveTo(target, { duration = 650 } = {}) {
    const loc = typeof target === "string" ? this.page.locator(target).first() : target;
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`moveTo: ${target} has no box`);
    await this.glide({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, duration);
    return loc;
  }

  /** Switch to another tab, such as one a link opened, keeping the cursor. */
  async use(page) {
    this.page = page;
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(`(() => {${CURSOR_BODY}})()`);
    await page.addStyleTag({ content: this.css });
    await page.mouse.move(this.pointer.x, this.pointer.y);
    await page.evaluate(([x, y]) => window.__demoCursor?.(x, y), [this.pointer.x, this.pointer.y]);
  }

  /** Press on a locator, glide by an offset and let go, as a slider drag. */
  async drag(target, { dx = 0, dy = 0, duration = 900 } = {}) {
    await this.moveTo(target);
    await sleep(120);
    await this.page.mouse.down();
    await this.glide({ x: this.pointer.x + dx, y: this.pointer.y + dy }, duration);
    await this.page.mouse.up();
    await sleep(200);
  }

  /** Move the pointer out of the way of the reply. */
  async park() {
    const [width, height] = await this.page.evaluate(() => [innerWidth, innerHeight]);
    // The empty lower part of the right panel.
    await this.glide({ x: width - 160, y: height - 140 }, 500);
  }

  async glide(to, duration) {
    const from = { ...this.pointer };
    const frames = Math.max(1, Math.round(duration / 16));
    for (let i = 1; i <= frames; i++) {
      const t = ease(i / frames);
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await this.page.mouse.move(x, y);
      await this.page.evaluate(([x, y]) => window.__demoCursor?.(x, y), [x, y]);
      await sleep(16);
    }
    this.pointer = to;
  }

  async click(target, opts) {
    const loc = await this.moveTo(target, opts);
    await sleep(120);
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    await sleep(200);
    return loc;
  }

  /** Type into the composer at a human rate, with a little seeded jitter. */
  async type(text, { cps = 16, into = sel.composer } = {}) {
    await this.click(into);
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      const base = 1000 / cps;
      await sleep(base * (0.6 + this.rng() * 0.8) + (ch === " " ? base * 0.4 : 0));
    }
  }

  /** Send the composer and wait for the run to start. */
  async send() {
    await sleep(350);
    await this.page.keyboard.press("Enter");
    await this.park();
    await this.page.locator(sel.runStatus).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  }

  /** Type a prompt, send it and wait out the reply. */
  async ask(text, opts = {}) {
    await this.type(text, opts);
    await this.send();
    if (opts.wait !== false) await this.waitForReply(opts);
  }

  /** Wait until the run is over and the reply has painted. */
  async waitForReply({ timeout = 180_000 } = {}) {
    await this.page.locator(sel.runStatus).first().waitFor({ state: "detached", timeout });
    await this.settle(300);
  }

  /** Click a card's submit until the card goes; a click before the resume is wired is lost. */
  async submitCard(card, button) {
    await this.click(button);
    for (let i = 0; i < 10; i++) {
      if ((await this.page.locator(card).count()) === 0) return;
      await sleep(1000);
      await this.page.locator(button).first().click({ timeout: 2000 }).catch(() => {});
    }
    throw new Error(`submitCard: ${card} never went away`);
  }

  /** Smooth-scroll the thread to its end, so the whole reply's tail is on screen. */
  async scrollToEnd() {
    await this.page.locator(sel.thread).first().evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    await sleep(800);
  }

  /** Scroll a locator into the middle of the view. */
  async focus(target) {
    const loc = typeof target === "string" ? this.page.locator(target).first() : target;
    await loc.waitFor({ state: "visible", timeout: 30_000 });
    await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await sleep(700);
    return loc;
  }
}

/** A small seeded PRNG (mulberry32), so typing jitter is identical between renders. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Define a scene: an async function of the director. */
export const scene = (fn) => fn;
