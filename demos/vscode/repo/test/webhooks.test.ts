import assert from "node:assert/strict";
import { test } from "node:test";
import { deliver } from "../src/webhooks.ts";

test("deliver posts the event as JSON", async () => {
  const calls: RequestInit[] = [];
  const post = async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init!);
    return new Response(null, { status: 204 });
  };
  await deliver({ url: "https://hooks.test/a", event: "order.paid", payload: { id: 7 } }, post);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, '{"id":7}');
});
