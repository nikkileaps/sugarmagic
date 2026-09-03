/**
 * targets/web/src/serialRunner.ts
 *
 * Purpose: run async calls one after another, never alongside each other.
 *
 * The boot path is a long await chain that reassigns host-wide state as it
 * goes. Two overlapping boots interleave those writes and the result
 * depends on how far each got, which is a bug that reproduces only
 * sometimes. Sequential boots already work, so the fix is to make every
 * boot sequential -- enforced here rather than in every caller's memory.
 *
 * Exports:
 *   - createSerialRunner
 *
 * Status: active
 */

export interface SerialRunner {
  /**
   * Queue `work` behind anything already running or queued. The returned
   * promise settles with `work`'s own result, including its rejection.
   */
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createSerialRunner(): SerialRunner {
  // Always settles, never rejects: this only orders the queue, it does not
  // carry results. The caller gets those from `queued` below.
  let chain: Promise<void> = Promise.resolve();

  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      // Both arms run the next piece of work. A failure must not wedge the
      // queue -- otherwise one bad boot means the tab can never boot again.
      const queued = chain.then(work, work);
      chain = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
    }
  };
}
