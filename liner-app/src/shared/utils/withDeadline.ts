// Promise deadline helper: race a promise against a timeout and reject with a
// caller-built error when the deadline fires. Used by the playback stack so a
// stuck network stage can never leave the player in a silent "loading" state —
// the timeout error flows into the normal failure handling (fallbacks, toast,
// auto-skip) instead of hanging forever.
//
// If the deadline wins, the losing promise gets a no-op catch so a late
// rejection can't surface as "Uncaught (in promise)" console noise.

export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  makeError: () => Error,
): Promise<T> {
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
