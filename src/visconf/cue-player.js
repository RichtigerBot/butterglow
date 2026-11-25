// Plays a visconf: turns the song position into preset changes at the planned moments.
//
// The player script in the tab reports the position only now and then (and a loaded file is played by the
// extension itself). `createSongClock()` therefore estimates the position for every frame from the last report.
// `createCuePlayer()` decides once per frame whether a cue is due. After a seek it jumps to the section at the
// new position with a hard cut, so the picture always matches the part of the song that is playing.

const SEEK_BACK_SECONDS = 0.3; // the clock may run back this little after a new report without it being a seek
const SEEK_FORWARD_SECONDS = 1.5; // larger jumps forward are seeks, not normal playback
const DRIFT_SECONDS = 0.15; // smaller differences to the report are smoothed, not jumped

export function createSongClock() {
  let anchorPosition = 0;
  let anchorTime = null;
  let playing = false;
  let rate = 1;

  const estimate = (now) => (anchorTime === null ? 0 : anchorPosition + (playing ? (now - anchorTime) * rate : 0));

  return {
    // A report from the player: `position` in seconds, `now` the time of the report in seconds (performance.now() / 1000).
    sync({ position, playing: isPlaying, playbackRate = 1 }, now) {
      const expected = estimate(now);
      // Small differences come from the delay of the report itself. Keep the clock steady instead of jittering.
      const keep = anchorTime !== null && playing && isPlaying && Math.abs(position - expected) < DRIFT_SECONDS;
      anchorPosition = keep ? expected + (position - expected) * 0.2 : position;
      anchorTime = now;
      playing = Boolean(isPlaying);
      rate = playbackRate > 0 ? playbackRate : 1;
    },
    position: estimate,
    get playing() {
      return playing;
    },
  };
}

// `resolvePreset(cue)` turns the cue's preset choice into a preset name (see resolvePreset below).
export function createCuePlayer({ resolvePreset } = {}) {
  let visconf = null;
  let last = null; // last position
  let activeId = null;

  const sectionAt = (position) => {
    let found = null;
    for (const cue of visconf.cues) if (cue.time <= position) found = cue;
    return found;
  };

  const start = (cue, transition, reason) => {
    activeId = cue?.id ?? null;
    if (!cue) return null;
    return { cue, transition, reason, preset: resolvePreset ? resolvePreset(cue) : null };
  };

  return {
    // A new visconf (or null to stop). The next update starts the section at the current position.
    load(next) {
      visconf = next;
      last = null;
      activeId = null;
    },

    get active() {
      return visconf?.cues.find((cue) => cue.id === activeId) ?? null;
    },

    // Once per frame with the song position. Returns null or { cue, transition, reason, preset };
    // `reason`: 'cue' (planned moment reached), 'start' (first update) or 'seek'.
    update(position) {
      if (!visconf || !Number.isFinite(position)) return null;
      const previous = last;
      last = position;
      if (previous === null) return start(sectionAt(position), 'cut', 'start');
      const jumped = position < previous - SEEK_BACK_SECONDS || position > previous + SEEK_FORWARD_SECONDS;
      if (jumped) {
        const cue = sectionAt(position);
        return cue?.id === activeId ? null : start(cue, 'cut', 'seek');
      }
      if (position <= previous) return null;
      // Usually at most one cue per frame. If several were passed at once, only the last one matters.
      let due = null;
      for (const cue of visconf.cues) if (cue.time > previous && cue.time <= position) due = cue;
      return due && due.id !== activeId ? start(due, due.transition, 'cue') : null;
    },

    // The next cue after `position` and the seconds until it, for a cross-fade that should end exactly on it.
    upcoming(position) {
      const cue = visconf?.cues.find((candidate) => candidate.time > position) ?? null;
      return cue ? { cue, inSeconds: cue.time - position } : null;
    },
  };
}

// Chooses the preset for a cue. `namesOf(pool)` returns the preset names of a collection (PresetLibrary.namesOf),
// `allNames` all available presets. A fixed preset that no longer exists falls back to a random one.
// A random choice avoids the preset that is showing now, if there is another one.
export function resolvePreset(cue, { allNames, namesOf = () => allNames, current = null, random = Math.random }) {
  const { preset } = cue;
  if (preset.mode === 'fixed' && allNames.includes(preset.name)) return preset.name;
  let pool = preset.mode === 'random' ? namesOf(preset.pool).filter((name) => allNames.includes(name)) : [];
  if (pool.length === 0) pool = allNames;
  const choices = pool.length > 1 ? pool.filter((name) => name !== current) : pool;
  return choices.length ? choices[Math.floor(random() * choices.length)] : null;
}
