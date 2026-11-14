// Decides for each monitor frame whether Milkdrop draws. Returns true for "skip this time".
// The clock is carried forward instead of restarted, so on average exactly `rate` frames/s come out.
// 1 ms of slack, because the monitor's frame times vary slightly. 0 means: draw every frame.
export function createFrameGate() {
  let next = -Infinity;
  return (now, rate) => {
    if (!(rate > 0)) {
      next = -Infinity;
      return false;
    }
    const interval = 1000 / rate;
    if (now < next - 1) return true;
    // Far behind (tab in the background, long frame): start over instead of catching up.
    next = now - next > interval ? now + interval : next + interval;
    return false;
  };
}
