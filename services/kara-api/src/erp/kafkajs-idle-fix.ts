/**
 * kafkajs 2.2.4 spins a ~1 ms timer on every broker connection, forever.
 *
 * `RequestQueue.scheduleCheckPendingRequests` computes
 * `throttledUntil - Date.now()`; with no throttle (`throttledUntil` is -1) and
 * nothing pending that is a large negative number, which `setTimeout` runs
 * after 1 ms — and the callback schedules itself again. Measured: 854 checks
 * and 75 ms of CPU per second for one idle queue, which is the 60–86m every
 * idle chatbot service with a Kafka connection sat at, enough on its own to
 * trip a 70 % CPU autoscaling target.
 *
 * Nothing needs the timer when the queue is empty: `push` schedules a check
 * when it queues a request, and every response and timeout re-checks the
 * queue. So it is only scheduled while something waits — at the throttle's
 * end, else after kafkajs' own 10 ms interval, exactly as before.
 *
 * kafkajs 2.2.4 is its last release, so this is patched in place, guarded by
 * version and shape: any other version is left alone and says so.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('kafkajs/package.json') as { version: string };

const CHECK_PENDING_REQUESTS_INTERVAL = 10;

interface Queue {
  pending: unknown[];
  throttledUntil: number;
  throttleCheckTimeoutId: NodeJS.Timeout | null;
  checkPendingRequests(): void;
}

export function applyKafkajsIdleFix(): 'patched' | 'already' | 'skipped' {
  if (pkg.version !== '2.2.4') return 'skipped';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RequestQueue = require('kafkajs/src/network/requestQueue') as { prototype: Record<string, unknown> };
  const proto = RequestQueue.prototype as Record<string, unknown> & { __simorghIdleFix?: boolean };
  if (proto.__simorghIdleFix) return 'already';
  if (typeof proto.scheduleCheckPendingRequests !== 'function') return 'skipped';
  proto.scheduleCheckPendingRequests = function scheduleCheckPendingRequests(this: Queue) {
    if (this.throttleCheckTimeoutId || this.pending.length === 0) return;
    const untilThrottleEnds = this.throttledUntil - Date.now();
    this.throttleCheckTimeoutId = setTimeout(() => {
      this.throttleCheckTimeoutId = null;
      this.checkPendingRequests();
    }, untilThrottleEnds > 0 ? untilThrottleEnds : CHECK_PENDING_REQUESTS_INTERVAL);
  };
  proto.__simorghIdleFix = true;
  return 'patched';
}

export const kafkajsIdleFix = applyKafkajsIdleFix();
