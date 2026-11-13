/** Shared badge polling policy. Active Inbox communication keeps its own flows.
 * Wait 15s after completion, or 30/60/120s after failures (capped at 120s).
 * Visibility/focus bypass backoff once; paired browser events coalesce for 250ms.
 */
export function createVisibilityPolling(poll: () => Promise<boolean | void>) {
  let stopped = false;
  let running = false;
  let queuedDelay: number | undefined;
  let failures = 0;
  let lastStarted = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => {
    clearTimer();
    if (!stopped && !document.hidden) timer = setTimeout(() => void run(), delay);
  };
  const run = async () => {
    if (stopped || document.hidden || running) return;
    clearTimer();
    running = true;
    lastStarted = Date.now();
    try {
      const result = await poll();
      failures = result === false ? Math.min(failures + 1, 3) : 0;
    } catch {
      failures = Math.min(failures + 1, 3);
    } finally {
      running = false;
      if (queuedDelay !== undefined) {
        const delay = queuedDelay;
        queuedDelay = undefined;
        if (!stopped && !document.hidden && delay === 0) void run();
        else schedule(delay);
      } else schedule(15_000 * 2 ** failures);
    }
  };
  const refresh = (delay = 0) => {
    if (stopped || document.hidden) return;
    if (running) { queuedDelay = Math.min(queuedDelay ?? delay, delay); return; }
    if (delay > 0) schedule(delay);
    else void run();
  };
  const focus = () => {
    if (stopped || document.hidden || running) return;
    const elapsed = Date.now() - lastStarted;
    if (elapsed >= 250) void run();
    else if (timer === undefined) schedule(250 - elapsed);
  };
  const visibility = () => {
    if (document.hidden) clearTimer();
    else focus();
  };
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", visibility);
  void run();
  return {
    refresh,
    stop() {
      stopped = true;
      queuedDelay = undefined;
      clearTimer();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
