export function createRunController() {
  let generation = 0;
  let current = null;

  const release = (job) => {
    const waiters = job?.pauseWaiters?.splice(0) ?? [];
    waiters.forEach((resolve) => resolve());
  };

  const invalidate = (job) => {
    if (!job) return;
    job.cancelled = true;
    job.paused = false;
    release(job);
    if (current === job) current = null;
  };

  const nextGeneration = () => {
    generation += 1;
    return generation;
  };

  const isCurrent = (job) => Boolean(job) && current === job && generation === job.generation && !job.cancelled;
  const isCurrentGeneration = (token) => generation === token;

  return {
    begin(config) {
      invalidate(current);
      const job = {
        generation: nextGeneration(),
        config: Object.freeze({ ...config }),
        cancelled: false,
        paused: false,
        pauseWaiters: []
      };
      current = job;
      return job;
    },

    beginImport() {
      invalidate(current);
      return nextGeneration();
    },

    reset() {
      invalidate(current);
      return nextGeneration();
    },

    cancel() {
      const job = current;
      invalidate(job);
      nextGeneration();
      return job;
    },

    finish(job) {
      if (!isCurrent(job)) return false;
      invalidate(job);
      nextGeneration();
      return true;
    },

    current() {
      return current;
    },

    isCurrent,
    isCurrentGeneration,

    commit(context, callback) {
      const valid = typeof context === "number" ? isCurrentGeneration(context) : isCurrent(context);
      if (!valid) return false;
      callback();
      return true;
    },

    togglePause(job) {
      if (!isCurrent(job)) return false;
      job.paused = !job.paused;
      if (!job.paused) release(job);
      return job.paused;
    },

    waitIfPaused(job) {
      if (!isCurrent(job) || !job.paused) return Promise.resolve();
      return new Promise((resolve) => job.pauseWaiters.push(resolve));
    }
  };
}
