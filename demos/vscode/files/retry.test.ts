import assert from "node:assert/strict";
import { test } from "node:test";
import { RetryExhaustedError, withRetry } from "../src/retry.ts";

test("withRetry gives up after five attempts", async () => {
  let calls = 0;
  const failing = async () => {
    calls++;
    throw new Error("receiver down");
  };
  await assert.rejects(withRetry(failing, { baseDelayMs: 1 }), RetryExhaustedError);
  assert.equal(calls, 5);
});

test("withRetry returns once a retry succeeds", async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? Promise.reject(new Error("503")) : "ok");
  assert.equal(await withRetry(flaky, { baseDelayMs: 1 }), "ok");
  assert.equal(calls, 3);
});
