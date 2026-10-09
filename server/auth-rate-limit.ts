export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type RateLimitEntry = {
  attempts: number;
  resetAt: number;
};

export function createFixedWindowRateLimiter(options: {
  maxAttempts: number;
  windowMs: number;
  now?: () => number;
}) {
  const entries = new Map<string, RateLimitEntry>();
  const now = options.now ?? Date.now;

  function prune(currentTime: number) {
    if (entries.size < 1_000) return;
    entries.forEach((entry, key) => {
      if (entry.resetAt <= currentTime) entries.delete(key);
    });
  }

  return {
    consume(key: string): RateLimitDecision {
      const currentTime = now();
      prune(currentTime);
      const current = entries.get(key);
      if (!current || current.resetAt <= currentTime) {
        entries.set(key, { attempts: 1, resetAt: currentTime + options.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.attempts >= options.maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - currentTime) / 1_000)),
        };
      }
      current.attempts += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset(key: string) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
