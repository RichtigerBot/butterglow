// Detects song sections: quiet, build-up, drop and normal, plus the moment of the drop.
// A drop is the first strong kick with which the full bass returns: after a few seconds with little bass,
// after a short pause in the bass, or at the end of a build-up.
// Everything is relative to the song and to the rest of the spectrum, not fixed levels. So it does not depend
// on how loud the player is set. Tuned with real songs (scripts/tools/analyze-sections.mjs).

const BASS_HZ = [30, 120];
const FULL_HZ = [30, 16000];
const HIGH_HZ = [4000, 16000];

const SLOT_SECONDS = 0.1;
const HISTORY_SLOTS = 120; // 12 s
const FAST_SECONDS = 0.06; // Smoothing for the moment of the drop: one kick is enough.
const MAX_GAP_SECONDS = 0.5;
const LEVEL_SLOTS = 20; // Level over 2 s for the sections, so single gaps between kicks do not disturb.

// Song level: follows peaks immediately and falls slowly, so a long quiet part does not lower the bar.
const REFERENCE_FALL_DB_PER_SECOND = 0.1;
const SILENCE_DB = -85; // Below this is silence, for example between two songs.
const SILENCE_RESET_SECONDS = 3;

// Drop after a quiet part: the window before it (7 to 1.5 s earlier) had clearly less bass than the rest of the song,
// and now a kick comes almost as strong as the strongest ones.
const BEFORE_FROM_SLOTS = 70;
const BEFORE_TO_SLOTS = 15;
const DROP_QUIET_BEFORE_DB = 9; // How far the bass before must be below the song level.
const DROP_KICK_DB = 4; // How close the kick must come to the strongest kicks.
const DROP_MIN_SECONDS_APART = 10;
const DROP_MIN_MUSIC_DB = 30; // Music must have played before, at most this far below the song level (otherwise: song start).
const DROP_CONFIRM_SECONDS = 0.8; // If the bass does not stay up this long, it was a single kick.
const DROP_CONFIRM_DB = 7;
// At the start of a song the song level is still unknown. On a drop the bass therefore also clearly stands out
// from the rest of the spectrum, regardless of volume. Measured: drops 17 to 26 dB, kicks in the intro 1 to 11 dB.
const DROP_MIN_BASS_LEAD_DB = 14;
// The kick must jump compared with the last second. If the bass fades in slowly, it is not a drop.
const DROP_MIN_JUMP_DB = 6;
const JUMP_SLOTS = 10;
// Or shortly before, the bass stopped completely (pause before the drop), at least 0.2 s, at most 1.5 s ago.
// In the middle of a drop such a pause does not count; there it is usually just a break.
const GAP_DB = 20;
const GAP_MIN_SLOTS = 2;
const GAP_RECENT_SECONDS = 1.5;
const GAP_MIN_BASS_LEAD_DB = 18; // After a pause the bass must stand out even more clearly.
// At the start of a song the song level only knows the intro. Then it counts how far the kick exceeds the window before.
const DROP_KICK_OVER_BEFORE_DB = 11;
// Or a build-up has just ended and the kick is as strong as the strongest ones.
const BUILD_RECENT_SECONDS = 2;
const AFTER_BUILD_KICK_DB = 2;
// The drop often starts one kick earlier than the rules can reliably detect it. Then the first kick in
// this window before counts, if it was almost as strong already and jumped compared with the second before.
const ONSET_LOOKBACK_SECONDS = 0.6;
const ONSET_NEAR_DB = 6; // How close the earlier kick must come to the detected one.
const ONSET_LEAD_DB = 4; // How much less lead over the rest of the spectrum is enough for it.
const ONSET_RISE_DB = 3; // Go back as long as the bass still rose this much per measurement.
const RECENT_TICKS = 64; // a little over 1 s with one measurement every 16 ms
// With lookahead a drop is only reported once the bass stays up afterwards. A single kick drops out
// this way. It is measured unsmoothed and only in the second half of the window. The triggering kick itself
// does not count, otherwise a single long hit would pass too.
const CONFIRM_BASS_DB = 10; // How far the bass may be below the song level on average.
const CONFIRM_SECONDS = 0.25; // Longer windows discard real drops whose bass starts shortly after the first kick.

// Sections.
const DROP_HOLD_DB = 7; // The drop section lasts until the bass falls this far below the song level
const DROP_HOLD_SECONDS = 1.5; // and stays there this long.
const QUIET_DB = 10; // Bass this far below the song level: quiet part.
const QUIET_LEAVE_DB = 8; // Only above this is it over, otherwise the display flickers at the boundary.
const BUILD_WINDOW_SLOTS = 40; // 4 s
const BUILD_MIN_RISE_DB = 4; // How much the overall level or the high band must rise within 4 s
const BUILD_MIN_BASS_RISE_DB = 6; // or the bass, when it is slowly faded in.
const BUILD_HOLD_SECONDS = 2;

const powerOf = (byte) => 10 ** ((-90 + (byte / 255) * 80) / 10);
const POWER = Float32Array.from({ length: 256 }, (_, byte) => powerOf(byte));
const toDb = (power) => 10 * Math.log10(Math.max(power, 1e-12));

class Band {
  constructor([startHz, endHz], hzPerBin, binCount) {
    this.start = Math.max(1, Math.round(startHz / hzPerBin));
    this.end = Math.min(binCount, Math.round(endHz / hzPerBin) + 1);
  }

  power(spectrum) {
    let sum = 0;
    for (let bin = this.start; bin < this.end; bin++) sum += POWER[spectrum[bin]];
    return sum / (this.end - this.start);
  }
}

class History {
  constructor() {
    this.values = new Float32Array(HISTORY_SLOTS);
    this.count = 0;
  }

  push(value) {
    this.values[this.count % HISTORY_SLOTS] = value;
    this.count++;
  }

  // Mean power of the slots `from` to `to` back (0 = the newest), in dB.
  meanDb(from, to) {
    let sum = 0;
    let used = 0;
    for (let back = to; back <= from && back < this.count; back++) {
      sum += this.values[(this.count - 1 - back) % HISTORY_SLOTS];
      used++;
    }
    return used ? toDb(sum / used) : -Infinity;
  }

  reset() {
    this.count = 0;
  }
}

export const SECTIONS = ['quiet', 'build', 'drop', 'normal'];

// Confirmation with lookahead. The rest of the lookahead is left to the visualizers to prepare for the drop
// (about 0.2 s with 0.5 s lookahead, about 0.7 s with 1 s).
export function confirmSecondsFor(lookaheadSeconds) {
  return lookaheadSeconds > 0 ? Math.min(CONFIRM_SECONDS, lookaheadSeconds / 2) : 0;
}

export class SectionDetector {
  // `confirmSeconds`: 0 reports the drop immediately, otherwise only after this confirmation (only useful with lookahead).
  constructor({ sampleRate, fftSize, confirmSeconds = 0 }) {
    this.confirmSeconds = confirmSeconds;
    this.recent = { time: new Float64Array(RECENT_TICKS), fast: new Float32Array(RECENT_TICKS), jump: new Float32Array(RECENT_TICKS), lead: new Float32Array(RECENT_TICKS), count: 0 };
    const hzPerBin = sampleRate / fftSize;
    const binCount = fftSize / 2;
    this.bands = { bass: new Band(BASS_HZ, hzPerBin, binCount), full: new Band(FULL_HZ, hzPerBin, binCount), high: new Band(HIGH_HZ, hzPerBin, binCount) };
    this.history = { bass: new History(), full: new History(), high: new History() };
    this.slot = null;
    this.sums = { bass: 0, full: 0, high: 0, count: 0 };
    this.fastBass = 0;
    this.lastTime = null;
    this.reset();
    // For the visualizers: `section`, `drop` (true only when reported), `dropTime` (the audible onset, often a little
    // before the report), `intensity` (0 to 1). With confirmation also `pending` (onset of a not yet confirmed
    // drop, or null) and `cancelled` (true only in the measurement in which it was discarded).
    this.state = { section: 'quiet', drop: false, dropTime: null, dropStrength: 0, intensity: 0, build: 0, pending: null, cancelled: false };
  }

  reset() {
    this.bassReference = -Infinity;
    this.kickReference = -Infinity;
    this.fullReference = -Infinity;
    this.silentSince = null;
    this.lastDropTime = -Infinity;
    this.dropFadingSince = null;
    this.confirming = null;
    this.candidate = null;
    this.previousDropTime = -Infinity;
    if (this.recent) this.recent.count = 0;
    if (this.state) this.state.pending = null;
    this.lowSlots = 0;
    this.gapEnd = -Infinity;
    this.inDrop = false;
    this.buildUntil = -Infinity;
    for (const history of Object.values(this.history ?? {})) history.reset();
  }

  update(spectrum, time) {
    const deltaSeconds = this.lastTime === null ? 0 : time - this.lastTime;
    this.state.drop = false;
    this.state.cancelled = false;
    if (deltaSeconds <= 0 && this.lastTime !== null) return this.state;
    this.lastTime = time;

    const bass = this.bands.bass.power(spectrum);
    const full = this.bands.full.power(spectrum);
    const high = this.bands.high.power(spectrum);
    this.fullDb = toDb(full);
    // After a gap (hidden window) the history before is missing. Then this value does not count as a drop.
    const gap = deltaSeconds > MAX_GAP_SECONDS;
    this.fastBass = gap ? bass : this.fastBass + (bass - this.fastBass) * (1 - Math.exp(-deltaSeconds / FAST_SECONDS));
    const fastDb = toDb(this.fastBass);
    this.kickReference = Math.max(fastDb, this.kickReference - REFERENCE_FALL_DB_PER_SECOND * deltaSeconds);

    if (gap) this.recent.count = 0;
    else {
      this.#remember(time, fastDb);
      if (this.candidate) this.#confirm(time, bass);
      this.#checkDrop(time, fastDb);
    }

    const slot = Math.floor(time / SLOT_SECONDS);
    if (this.slot === null) this.slot = slot;
    if (slot !== this.slot) {
      this.#closeSlot(time);
      // On gaps (hidden window) the last value also counts for the skipped slots.
      for (let skipped = this.slot + 1; skipped < slot && skipped < this.slot + HISTORY_SLOTS; skipped++) this.#repeatSlot();
      this.slot = slot;
    }
    this.sums.bass += bass;
    this.sums.full += full;
    this.sums.high += high;
    this.sums.count++;
    return this.state;
  }

  // The drop is reported on the first kick already, so the visualizers can react at exactly that moment.
  // If the bass does not stay up afterwards, only the drop section ends again.
  #checkDrop(time, fastDb) {
    const history = this.history.bass;
    if (this.confirming !== null && time - this.confirming >= DROP_CONFIRM_SECONDS) {
      const level = history.meanDb(Math.round(DROP_CONFIRM_SECONDS / SLOT_SECONDS) - 1, 0);
      if (level < this.bassReference - DROP_CONFIRM_DB) this.inDrop = false;
      this.confirming = null;
    }
    if (history.count < BEFORE_FROM_SLOTS || time - this.lastDropTime < DROP_MIN_SECONDS_APART) return;
    if (fastDb < this.kickReference - DROP_KICK_DB) return;
    const lead = fastDb - this.history.full.meanDb(LEVEL_SLOTS - 1, 0);
    if (lead < DROP_MIN_BASS_LEAD_DB) return;
    const lastSecond = history.meanDb(JUMP_SLOTS, 1);
    if (fastDb - lastSecond < DROP_MIN_JUMP_DB) return;
    const musicBefore = this.history.full.meanDb(BEFORE_FROM_SLOTS, BEFORE_TO_SLOTS);
    if (musicBefore < this.fullReference - DROP_MIN_MUSIC_DB || musicBefore < SILENCE_DB) return;

    const before = history.meanDb(BEFORE_FROM_SLOTS, BEFORE_TO_SLOTS);
    const afterQuiet = before <= this.bassReference - DROP_QUIET_BEFORE_DB || fastDb - before >= DROP_KICK_OVER_BEFORE_DB;
    const afterGap =
      !this.inDrop && lead >= GAP_MIN_BASS_LEAD_DB && (time - this.gapEnd <= GAP_RECENT_SECONDS || this.lowSlots >= GAP_MIN_SLOTS);
    const afterBuild = time - this.buildUntil <= BUILD_RECENT_SECONDS && fastDb >= this.kickReference - AFTER_BUILD_KICK_DB;
    if (!afterQuiet && !afterGap && !afterBuild) return;

    this.previousDropTime = this.lastDropTime;
    this.lastDropTime = time;
    this.confirming = time;
    this.inDrop = true;
    this.dropFadingSince = null;
    const onset = this.#onset(time, fastDb);
    // How much louder the bass is now than before, 0 to 1 (full from 30 dB).
    const strength = Math.min(1, (fastDb - Math.min(before, lastSecond)) / 30);
    if (this.confirmSeconds > 0) {
      this.candidate = { time, onset, strength, power: 0, count: 0 };
      this.state.pending = onset;
    } else this.#report(onset, strength);
  }

  #report(onset, strength) {
    this.state.drop = true;
    this.state.dropTime = onset;
    this.state.dropStrength = strength;
  }

  // Does the bass stay up after the report? Measured unsmoothed, otherwise the decay of the smoothing would
  // carry a single hit through.
  #confirm(time, bass) {
    const candidate = this.candidate;
    if (time - candidate.time >= this.confirmSeconds / 2) {
      candidate.power += bass;
      candidate.count++;
    }
    if (time - candidate.time < this.confirmSeconds) return;
    this.candidate = null;
    this.state.pending = null;
    if (candidate.count && toDb(candidate.power / candidate.count) >= this.bassReference - CONFIRM_BASS_DB) {
      this.#report(candidate.onset, candidate.strength);
      return;
    }
    // Discarded: as if it never happened; the next real drop may come right away.
    this.state.cancelled = true;
    this.inDrop = false;
    this.confirming = null;
    this.lastDropTime = this.previousDropTime;
  }

  // Remembers the last measurements to work out the onset of the drop.
  #remember(time, fastDb) {
    const recent = this.recent;
    const index = recent.count % RECENT_TICKS;
    recent.time[index] = time;
    recent.fast[index] = fastDb;
    recent.jump[index] = fastDb - this.history.bass.meanDb(JUMP_SLOTS, 1);
    recent.lead[index] = fastDb - this.history.full.meanDb(LEVEL_SLOTS - 1, 0);
    recent.count++;
  }

  // The audible onset: the first similarly strong kick shortly before, and there the start of its rise.
  // Smoothing and the analysis window would otherwise delay the detection by a few hundredths of a second.
  #onset(time, fastDb) {
    const recent = this.recent;
    const available = Math.min(recent.count, RECENT_TICKS);
    const at = (back) => (recent.count - 1 - back) % RECENT_TICKS;
    let found = 0;
    for (let back = available - 1; back >= 0; back--) {
      const index = at(back);
      if (time - recent.time[index] > ONSET_LOOKBACK_SECONDS) continue;
      if (
        recent.fast[index] >= fastDb - ONSET_NEAR_DB &&
        recent.jump[index] >= DROP_MIN_JUMP_DB &&
        recent.lead[index] >= DROP_MIN_BASS_LEAD_DB - ONSET_LEAD_DB
      ) {
        found = back;
        break;
      }
    }
    // Back to the start of the rise. The loop ends on the old level before; the onset is the measurement after it.
    let start = found;
    while (start + 1 < available && recent.fast[at(start + 1)] < recent.fast[at(start)] - ONSET_RISE_DB) start++;
    if (start > found) start--;
    return available ? recent.time[at(start)] : time;
  }

  #closeSlot(time) {
    const { count } = this.sums;
    if (!count) return;
    for (const name of ['bass', 'full', 'high']) {
      this.history[name].push(this.sums[name] / count);
      this.sums[name] = 0;
    }
    this.sums.count = 0;
    this.#classify(time);
  }

  #repeatSlot() {
    for (const history of Object.values(this.history)) history.push(history.values[(history.count - 1) % HISTORY_SLOTS]);
  }

  #classify(time) {
    const bassLevel = this.history.bass.meanDb(LEVEL_SLOTS - 1, 0);
    const fullLevel = this.history.full.meanDb(LEVEL_SLOTS - 1, 0);

    if (fullLevel < SILENCE_DB) {
      this.silentSince ??= time;
      if (time - this.silentSince >= SILENCE_RESET_SECONDS) {
        const keep = this.state;
        this.reset();
        this.state = keep;
        this.silentSince = time;
      }
    } else {
      this.silentSince = null;
    }

    const fall = REFERENCE_FALL_DB_PER_SECOND * SLOT_SECONDS;
    if (this.history.bass.count >= LEVEL_SLOTS) {
      this.bassReference = Math.max(bassLevel, this.bassReference - fall);
      this.fullReference = Math.max(fullLevel, this.fullReference - fall);
    }

    const below = this.bassReference - bassLevel;

    // Remember pauses in the bass: several slots in a row far below the song level.
    const slotDb = toDb(this.history.bass.values[(this.history.bass.count - 1) % HISTORY_SLOTS]);
    if (slotDb <= this.bassReference - GAP_DB) this.lowSlots++;
    else {
      if (this.lowSlots >= GAP_MIN_SLOTS) this.gapEnd = time;
      this.lowSlots = 0;
    }
    if (this.inDrop && below > DROP_HOLD_DB) {
      this.dropFadingSince ??= time;
      if (time - this.dropFadingSince >= DROP_HOLD_SECONDS) this.inDrop = false;
    } else {
      this.dropFadingSince = null;
    }

    // Build-up: the bass is still missing, but the overall level or the high band rises over a few seconds.
    const window = BUILD_WINDOW_SLOTS;
    let build = 0;
    if (this.history.full.count > window && !this.inDrop && below > DROP_HOLD_DB / 2) {
      const half = window / 2;
      const fullRise = this.history.full.meanDb(half - 1, 0) - this.history.full.meanDb(window - 1, half);
      const highRise = this.history.high.meanDb(half - 1, 0) - this.history.high.meanDb(window - 1, half);
      const bassRise = this.history.bass.meanDb(half - 1, 0) - this.history.bass.meanDb(window - 1, half);
      build = Math.max(fullRise / BUILD_MIN_RISE_DB, highRise / BUILD_MIN_RISE_DB, bassRise / BUILD_MIN_BASS_RISE_DB);
      if (build >= 1) this.buildUntil = time + BUILD_HOLD_SECONDS;
    }

    let section = 'normal';
    if (fullLevel < SILENCE_DB) section = 'quiet';
    else if (this.inDrop) section = 'drop';
    else if (time < this.buildUntil) section = 'build';
    else if (below > (this.state.section === 'quiet' ? QUIET_LEAVE_DB : QUIET_DB)) section = 'quiet';

    this.state.section = section;
    this.state.build = Math.max(0, Math.min(1, build));
    this.state.intensity = Number.isFinite(below) ? Math.max(0, Math.min(1, 1 - below / 24)) : 0;
  }
}
