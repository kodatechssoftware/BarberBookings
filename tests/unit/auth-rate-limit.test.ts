import assert from "node:assert/strict";
import test from "node:test";
import { createFixedWindowRateLimiter } from "../../server/auth-rate-limit";

test("auth rate limiter fails closed for the configured window and can be reset", () => {
  let now = 1_000;
  const limiter = createFixedWindowRateLimiter({ maxAttempts: 2, windowMs: 10_000, now: () => now });
  assert.equal(limiter.consume("actor").allowed, true);
  assert.equal(limiter.consume("actor").allowed, true);
  assert.deepEqual(limiter.consume("actor"), { allowed: false, retryAfterSeconds: 10 });
  limiter.reset("actor");
  assert.equal(limiter.consume("actor").allowed, true);
  now += 10_001;
  assert.equal(limiter.consume("actor").allowed, true);
});

test("rate-limit keys remain isolated", () => {
  const limiter = createFixedWindowRateLimiter({ maxAttempts: 1, windowMs: 10_000 });
  assert.equal(limiter.consume("one").allowed, true);
  assert.equal(limiter.consume("one").allowed, false);
  assert.equal(limiter.consume("two").allowed, true);
});
