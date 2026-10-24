// Active playback time is independent of frame rate. Pause and hidden time do not count.
export function createPlaybackClock(time = () => performance.now()) {
  let elapsed = 0, previous = time(), running = false;
  const now = () => {
    const current = time();
    if (running) elapsed += Math.max(0, current - previous);
    previous = current;
    return elapsed;
  };
  return {
    now,
    setRunning(value) { now(); running = value; },
    reset() { elapsed = 0; previous = time(); }
  };
}
