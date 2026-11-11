/** Fake broker: answers approval cards on the fast stack. */

import { createServer } from "node:http";

/** The wake message a script turn matches. */
const answerMessage = (contrib, requestId, optionId) =>
  `The user answered "${optionId}" to ${contrib} request ${requestId}.`;

export function startFakeBroker(port) {
  const server = createServer((req, res) => {
    req.resume();
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    // POST /<contrib>/<requestId>/<verb>.
    const m = req.method === "POST" && /^\/([\w-]+)\/([^/]+)\/([\w-]+)$/.exec(req.url ?? "");
    if (!m) return reply(404, { error: "the fake broker serves only approval verbs" });
    const [, contrib, id, verb] = m.map(decodeURIComponent);
    if (verb === "can-approve") return reply(200, { can_approve: true, pending: true });
    return reply(200, { agent_message: answerMessage(contrib, id, verb) });
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok(server));
  });
}
