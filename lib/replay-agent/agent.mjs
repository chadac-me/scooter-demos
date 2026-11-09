/**
 * Replay agent: an ACP agent that plays back a demo's script.yaml instead of
 * calling a model. Agent-host spawns it as GOOSE_BIN (via the wrapper in
 * bin/replay-agent), so the UI and server it talks to are real Scooter.
 *
 * DEMO_SCRIPTS is a directory of script.yaml files; each user prompt is matched
 * against every script's turns. See README.md for the script format.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@zed-industries/agent-client-protocol";
import YAML from "yaml";

// Mirrors agent-host's src/acp/client.ts, which isn't a published package.
const INTERRUPT_META = "scooter.dev/interrupt";
const INTERRUPT_RESULT_META = "scooter.dev/interrupt-result";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Replace ${name} with a value a shell step captured. */
const fill = (text, vars) => text.replace(/\$\{(\w+)\}/g, (all, k) => vars[k] ?? all);

/** Default streaming speeds, in characters per second. */
const PACE = { say: 240, think: 420 };

/** Every script.yaml under DEMO_SCRIPTS, one level deep. */
function loadScripts(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const file = join(root, name, "script.yaml");
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    let doc;
    try {
      doc = YAML.parse(readFileSync(file, "utf8"));
    } catch (e) {
      // One broken script mustn't take down every other demo.
      console.error(`replay-agent: skipping ${file}: ${e.message}`);
      continue;
    }
    out.push({ name, dir: join(root, name), ...doc, pace: { ...PACE, ...(doc.pace ?? {}) } });
  }
  return out;
}

/** The script and turn whose prompt matches the user's text. */
function findTurn(scripts, text) {
  const want = norm(text);
  for (const script of scripts) {
    for (const turn of script.turns ?? []) {
      if (norm(turn.prompt) === want) return { script, turn };
    }
  }
  return undefined;
}

class ReplayAgent {
  constructor(conn) {
    this.conn = conn;
    this.titled = new Set();
    this.seq = 0;
    this.cancelled = new Set();
  }

  async initialize() {
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false } };
  }

  async newSession() {
    return { sessionId: `replay-${Math.random().toString(36).slice(2, 10)}` };
  }

  async authenticate() {
    return {};
  }

  async cancel({ sessionId }) {
    this.cancelled.add(sessionId);
  }

  async prompt(p) {
    const { sessionId } = p;
    this.cancelled.delete(sessionId);
    const text = p.prompt
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    // Rescan per prompt, so editing a script needs no restart.
    const scripts = loadScripts(process.env.DEMO_SCRIPTS);
    const hit = findTurn(scripts, text);
    const ctx = { sessionId, pace: hit?.script.pace ?? PACE, dir: hit?.script.dir, vars: {} };
    if (!this.titled.has(sessionId)) {
      this.titled.add(sessionId);
      // The host strips this marker and uses it as the conversation title.
      await this.update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `<title>${hit?.script.title ?? "Demo"}</title>` } });
    }
    if (!hit) {
      await this.stream(ctx, "agent_message_chunk", `No scripted turn matches:\n\n> ${text}`);
      return { stopReason: "end_turn" };
    }
    await this.run(ctx, hit.turn.steps ?? []);
    return { stopReason: this.cancelled.has(sessionId) ? "cancelled" : "end_turn" };
  }

  update(sessionId, update) {
    return this.conn.sessionUpdate({ sessionId, update });
  }

  /** Stream text in small chunks at a steady rate, as a model would. */
  async stream(ctx, kind, text, cps) {
    const rate = cps ?? (kind === "agent_thought_chunk" ? ctx.pace.think : ctx.pace.say);
    // Word-ish chunks keep markdown from flickering mid-token.
    const chunks = text.match(/\S+\s*|\s+/g) ?? [];
    for (const chunk of chunks) {
      if (this.cancelled.has(ctx.sessionId)) return;
      await this.update(ctx.sessionId, { sessionUpdate: kind, content: { type: "text", text: chunk } });
      await sleep((chunk.length / rate) * 1000);
    }
  }

  async run(ctx, steps) {
    for (const step of steps) {
      if (this.cancelled.has(ctx.sessionId)) return;
      if (step.pause) await sleep(step.pause);
      else if (step.think) await this.stream(ctx, "agent_thought_chunk", step.think, step.cps);
      else if (step.say) await this.stream(ctx, "agent_message_chunk", fill(step.say, ctx.vars), step.cps);
      else if (step.shell) await this.shell(ctx, step.shell);
      else if (step.tool) await this.tool(ctx, step.tool);
      else if (step.write) await this.write(ctx, step.write);
      else if (step.ask) await this.ask(ctx, step.ask);
      else throw new Error(`unknown step: ${JSON.stringify(step)}`);
    }
  }

  /** A shell call: run for real in the sandbox unless the script gives its output. */
  async shell(ctx, s) {
    const toolCallId = `call_replay_${++this.seq}`;
    await this.update(ctx.sessionId, { sessionUpdate: "tool_call", toolCallId, title: `run: ${s.command}`, kind: "execute", status: "pending" });
    let output = s.output;
    let ok = true;
    if (output === undefined) {
      const term = await this.conn.createTerminal({ sessionId: ctx.sessionId, command: "sh", args: ["-c", s.command] });
      await this.update(ctx.sessionId, { sessionUpdate: "tool_call_update", toolCallId, status: "in_progress", content: [{ type: "terminal", terminalId: term.id }] });
      const exit = await term.waitForExit();
      output = (await term.currentOutput()).output ?? "";
      ok = (exit.exitCode ?? 0) === 0;
      await term.release();
    } else {
      await sleep(s.duration ?? 600);
    }
    // Values only known at run time, such as a conversation's service URL.
    for (const [name, re] of Object.entries(s.capture ?? {})) {
      const m = output.match(new RegExp(re));
      if (m) ctx.vars[name] = m[1] ?? m[0];
    }
    await this.update(ctx.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: ok ? "completed" : "failed",
      content: [{ type: "content", content: { type: "text", text: output } }],
    });
  }

  /** Write a file from the demo's folder into the sandbox, shown as an edit. */
  async write(ctx, w) {
    const toolCallId = `call_replay_${++this.seq}`;
    const text = readFileSync(join(ctx.dir, w.from), "utf8");
    await this.update(ctx.sessionId, { sessionUpdate: "tool_call", toolCallId, title: `write: ${w.path}`, kind: "edit", status: "pending" });
    // Base64, so no quoting in the file can break the command.
    const b64 = Buffer.from(text).toString("base64");
    const term = await this.conn.createTerminal({ sessionId: ctx.sessionId, command: "sh", args: ["-c", `printf %s '${b64}' | base64 -d > '${w.path}'`] });
    const exit = await term.waitForExit();
    await term.release();
    await sleep(w.duration ?? 0);
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    await this.update(ctx.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: (exit.exitCode ?? 0) === 0 ? "completed" : "failed",
      content: [{ type: "content", content: { type: "text", text: `wrote ${lines} lines` } }],
    });
  }

  /** Any other tool call, with canned input and output. */
  async tool(ctx, t) {
    const toolCallId = `call_replay_${++this.seq}`;
    await this.update(ctx.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId,
      title: t.title,
      kind: t.kind ?? "other",
      status: "pending",
      rawInput: t.input ?? {},
    });
    await sleep(t.duration ?? 800);
    await this.update(ctx.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: t.output ?? "" } }],
    });
  }

  /** An ask-user question card; `then` maps each answer label to its steps. */
  async ask(ctx, a) {
    const res = await this.conn.requestPermission({
      sessionId: ctx.sessionId,
      toolCall: { toolCallId: `call_replay_${++this.seq}`, title: a.question },
      options: [{ optionId: "answer", name: "Answer", kind: "allow_once" }],
      _meta: {
        [INTERRUPT_META]: {
          kind: "ask-user.questions",
          data: { questions: [{ question: a.question, header: a.header, options: a.options, multiSelect: !!a.multiSelect }] },
        },
      },
    });
    const answer = res._meta?.[INTERRUPT_RESULT_META]?.answers?.[a.question];
    await this.run(ctx, a.then?.[answer] ?? a.then?.default ?? []);
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
new AgentSideConnection((conn) => new ReplayAgent(conn), ndJsonStream(input, output));
