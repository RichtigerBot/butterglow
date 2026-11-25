// Visconf editor (key T): a timeline for one song with waveform, drops, quiet parts, beat grid and the planned
// preset changes, plus playback of the plan while the song plays in the tab.
//
// The song is identified by title and artist. "This song" takes them from the player; loading a file takes them
// from the file name ("Artist - Title"). Both fields can be corrected by hand. The analysis comes from a loaded
// file or from listening once (record button). Everything is saved per song as it changes (visconf-store.js).
//
// Timing: the tab plays `lookahead` seconds ahead of what is heard and seen. The plan follows what is heard.

import { t, onLanguageChange } from '../i18n/i18n.js';
import { createCuePlayer, createSongClock, resolvePreset } from '../visconf/cue-player.js';
import { analyzeSong, createSongRecorder, decodeSong } from '../visconf/song-analysis.js';
import { addDrop, beatsOf, createTapTempo, removeDrop, removeQuiet, setDownbeat, setTempo } from '../visconf/song-markers.js';
import { LAYOUT, applyDrag, followView, formatTime, fullView, hitTest, insertCue, scrollView, snapTime, timeToX, xToTime, zoomView } from '../visconf/timeline-geometry.js';
import { ALL_PRESETS, FILE_NAME, createVisconf, cueAt, cuesFromMarkers, followMarkers, fromFile, removeCue, sameSong, songKey, songFromFileName, songOf, toFile, updateCue } from '../visconf/visconf-model.js';
import { createVisconfStore } from '../visconf/visconf-store.js';
import { setIcon } from './icons.js';
import { createPresetPicker } from './preset-picker.js';
import { loadPreviews, previewImage } from './preset-previews.js';

const SOFT_BLEND_SECONDS = 3;
const SAVE_DELAY_MS = 400;
const DOUBLE_CLICK_MS = 350;
const DRAG_START_PX = 3;
const HISTORY_LIMIT = 100;
const FIRED_SHOW_MS = 3000; // how long the live line and the timeline show a change that just happened
const NOTE_SHOW_MS = 2500; // how long the badge outside the editor shows a short note
const REACTION_SECONDS = 0.15; // a key press for a change comes this much after the moment that was meant
const APPLY_KEY = 'visconfApply';
const END_KEY = 'visconfEnd';
const END_MODES = ['', 'repeat', 'stop'];
const STOP_BEFORE_END_SECONDS = 0.3; // "Stop at the end" pauses the tab this long before the end of the song
const COLORS = {
  background: 'rgb(255 255 255 / 4%)',
  wave: 'rgb(170 160 255 / 70%)',
  quiet: 'rgb(90 170 255 / 18%)',
  quietEdge: 'rgb(90 170 255 / 70%)',
  drop: 'rgb(255 90 120)',
  beat: 'rgb(255 255 255 / 8%)',
  bar: 'rgb(255 255 255 / 20%)',
  cue: 'rgb(255 205 90)',
  soft: 'rgb(120 230 190)',
  selected: '#fff',
  playhead: 'rgb(255 255 255 / 90%)',
  text: 'rgb(255 255 255 / 60%)',
  sections: ['rgb(255 205 90 / 14%)', 'rgb(160 120 255 / 14%)'],
};

export function createVisconfPanel({ root, badge = null, getMilkdrop, getPlayerState, seek, control, library, nicknames = null, getLookahead, getInputPeak, onChange, store = createVisconfStore() }) {
  const $ = (selector) => root.querySelector(selector);
  const canvas = $('.vc-canvas');
  const tooltip = $('.vc-tooltip');
  const statusLine = $('.vc-status');
  const titleInput = $('.vc-title');
  const artistInput = $('.vc-artist');
  const select = $('.vc-select');
  const nameForm = $('.vc-name-form');
  const playToggle = $('.vc-play input');
  const recordButton = $('.vc-record');
  const tempoInput = $('.vc-tempo');
  const snapToggle = $('.vc-snap input');
  const inspector = $('.vc-inspector');
  const fileInput = $('.vc-file');
  const importInput = $('.vc-import-file');
  const liveLine = $('.vc-live');
  const clockLine = $('.vc-clock');
  const toggleButton = $('.vc-toggle');
  const repeatButton = $('.vc-end-repeat');
  const stopAtEndButton = $('.vc-end-stop');
  setIcon(repeatButton, 'repeat');
  setIcon(stopAtEndButton, 'stopAtEnd');
  setIcon($('.vc-to-start'), 'toStart');
  const markButton = $('.vc-mark');
  let previews = null; // preview images of the presets, loaded when the editor opens first
  let pickingFor = null; // id of the cue the picker chooses a preset for
  const picker = createPresetPicker({
    root: $('.vc-picker'),
    getNames: () => getMilkdrop()?.presetNames ?? [],
    nicknames,
    onPick: (name) => {
      if (visconf?.cues.some((cue) => cue.id === pickingFor)) update({ visconf: updateCue(visconf, pickingFor, { preset: { mode: 'fixed', name } }) });
    },
    onClose: () => (pickingFor = null),
  });
  const shownName = (name) => nicknames?.display(name) ?? name;
  nicknames?.onChange(() => {
    dirty = true;
    renderInspector();
    onChange?.();
  });

  let open = false;
  let song = songOf({});
  let duration = 0;
  let analysis = null;
  let markers = null;
  let visconfs = [];
  let visconf = null;
  let view = fullView(0);
  let selected = null; // { kind: 'cue' | 'drop' | 'quiet', id }
  let hover = null; // { x, y }
  let drag = null;
  let lastClick = { time: 0, x: -99 };
  let saveTimer = null;
  let loadToken = 0; // a newer loadSong() makes older ones stop where they are
  let undoStack = []; // states before each change: { markers, visconfs, visconfId }
  let redoStack = [];
  let analysing = null; // AbortController while a file is analysed
  let recorder = null;
  let recordWaiting = false; // the song was sent back to the start; recording begins once it is there
  let repeatDone = false; // the repeat for this end of the song has happened
  let stopDone = false; // the tab was paused at this end of the song
  // What happens at the end of the song in the tab: '' goes on as the tab does, 'repeat' starts it again from the
  // beginning, 'stop' pauses the tab shortly before the end, so no next song starts (autoplay).
  let endMode = '';
  let clockText = '';
  let status = null; // function, so it follows a language switch
  let dirty = true;
  let playheadX = null;
  const clock = createSongClock();
  const tapper = createTapTempo();
  let lastPlayerState = null;
  let playing = false; // playback of the plan is running
  let held = null; // the Milkdrop instance whose own changes rest during playback
  let fired = null; // { cue, preset, at } of the last change the plan made
  let liveText = '';
  let lastTabKey = null; // songKey of the song the tab played at the last frame
  let badgeNote = null; // { text, until }: a short note on the badge while the editor is closed
  let badgeText = '';
  let anyPlans = false; // some song has a visconf: the player state is needed even with the player hidden
  Promise.resolve(store.all?.() ?? [])
    .then((all) => (anyPlans = anyPlans || all.length > 0))
    .catch(() => {});
  const cuePlayer = createCuePlayer({
    resolvePreset: (cue) => {
      const milkdrop = getMilkdrop();
      if (!milkdrop) return null;
      return resolvePreset(cue, { allNames: milkdrop.presetNames, namesOf: (pool) => library.namesOf(pool, milkdrop.presetNames), current: milkdrop.presetName });
    },
  });

  const setStatus = (message) => {
    status = message;
    statusLine.textContent = message ? message() : '';
  };
  const changed = () => {
    dirty = true;
    onChange?.();
  };

  // --- Song, data and saving ---

  const tabSong = () => {
    const state = getPlayerState();
    return state && !state.unavailable && state.title ? songOf(state) : null;
  };
  const isTabSong = () => {
    const current = tabSong();
    return Boolean(current && song.title && sameSong(current, song));
  };

  async function loadSong(next) {
    const token = ++loadToken;
    stopRecording(false);
    if (saveTimer) await saveNow(); // changes to the previous song are saved first
    const nextSong = songOf(next);
    titleInput.value = nextSong.title;
    artistInput.value = nextSong.artist;
    const [nextAnalysis, nextMarkers, nextVisconfs] = nextSong.title
      ? await Promise.all([store.analysisFor(nextSong), store.markersFor(nextSong), store.forSong(nextSong)])
      : [null, null, []];
    if (token !== loadToken) return;
    song = nextSong;
    analysis = nextAnalysis;
    markers = nextMarkers;
    duration = analysis?.duration || markers?.duration || song.duration || 0;
    visconfs = nextVisconfs;
    visconf = visconfs[0] ?? null;
    undoStack = [];
    redoStack = [];
    renderHistory();
    view = fullView(duration);
    selected = null;
    cuePlayer.load(visconf);
    renderSelect();
    renderInspector();
    renderTools();
    setStatus(song.title && !analysis ? () => t('visconf.needAnalysis') : null);
    changed();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    // What is saved is taken now: the song or the visconf may change while the storage is busy.
    const target = { song, markers, visconf };
    if (!target.song.title) return;
    try {
      if (target.markers) await store.saveMarkers(target.song, target.markers);
      if (target.visconf) {
        await store.save(target.visconf);
        anyPlans = true;
      }
    } catch (error) {
      console.error(error);
      setStatus(() => t('visconf.saveFailed', { error: error.message }));
    }
  }

  // Applies a change to markers and/or the visconf. `save`: false while dragging, saved on release.
  // `record`: false if the state before was already put on the undo stack (drag, second half of a change).
  function update(next, { save = true, record = save } = {}) {
    if (record) remember();
    if (next.markers !== undefined) markers = next.markers;
    if (next.visconf !== undefined && next.visconf !== visconf) {
      visconf = next.visconf;
      if (visconf) {
        const id = visconf.id;
        visconfs = visconfs.some((entry) => entry.id === id) ? visconfs.map((entry) => (entry.id === id ? visconf : entry)) : [visconf, ...visconfs];
      }
      cuePlayer.load(visconf);
    }
    if (save) scheduleSave();
    renderInspector();
    renderTools();
    changed();
  }

  function ensureVisconf({ record = true } = {}) {
    if (visconf || !song.title) return visconf;
    update({ visconf: createVisconf({ name: t('visconf.defaultName', { number: 1 }), song: { ...song, duration } }) }, { record });
    renderSelect();
    return visconf;
  }

  // A change of the markers, with the cues that follow them (followMarkers). `base`: the state the change was made
  // from. Without a visconf, the first new marker makes one, with a cue on every marker.
  function markerChange(nextMarkers, base = { markers, visconf }) {
    if (base.visconf) return { markers: nextMarkers, visconf: followMarkers(base.visconf, base.markers, nextMarkers) };
    const added = nextMarkers.drops.length + nextMarkers.quiet.length > (base.markers?.drops.length ?? 0) + (base.markers?.quiet.length ?? 0);
    if (!added || !song.title) return { markers: nextMarkers };
    return { markers: nextMarkers, visconf: createVisconf({ name: t('visconf.defaultName', { number: 1 }), song: { ...song, duration }, cues: cuesFromMarkers(nextMarkers) }) };
  }

  // --- Undo and redo (Ctrl+Z, Ctrl+Y) ---

  const snapshot = () => ({ markers, visconfs, visconfId: visconf?.id ?? null });
  function renderHistory() {
    $('.vc-undo').disabled = undoStack.length === 0;
    $('.vc-redo').disabled = redoStack.length === 0;
    applyLock();
  }
  function remember() {
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    renderHistory();
  }
  async function restoreState(state) {
    const removed = visconfs.filter((entry) => !state.visconfs.some((kept) => kept.id === entry.id));
    const changedOnes = state.visconfs.filter((entry) => !visconfs.includes(entry));
    markers = state.markers;
    visconfs = state.visconfs;
    visconf = visconfs.find((entry) => entry.id === state.visconfId) ?? visconfs[0] ?? null;
    if (selected && !(selected.kind === 'cue' ? visconf?.cues : selected.kind === 'drop' ? markers?.drops : markers?.quiet)?.some((entry) => entry.id === selected.id)) selected = null;
    cuePlayer.load(visconf);
    renderSelect();
    renderTools();
    renderInspector();
    changed();
    clearTimeout(saveTimer);
    saveTimer = null;
    const target = song;
    try {
      for (const entry of removed) await store.remove(entry.id);
      for (const entry of changedOnes) await store.save(entry);
      if (state.markers) await store.saveMarkers(target, state.markers);
    } catch (error) {
      console.error(error);
      setStatus(() => t('visconf.saveFailed', { error: error.message }));
    }
  }
  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(snapshot());
    restoreState(undoStack.pop());
    renderHistory();
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    restoreState(redoStack.pop());
    renderHistory();
    return true;
  }

  async function useAnalysis(result) {
    analysis = result;
    setStatus(null);
    duration = result.duration;
    song = { ...song, duration: song.duration || duration };
    await store.saveAnalysis(song, result);
    markers = await store.markersFor(song);
    view = fullView(duration);
    if (!visconf && song.title) {
      update({ visconf: createVisconf({ name: t('visconf.defaultName', { number: 1 }), song: { ...song, duration }, cues: cuesFromMarkers(markers) }) }, { record: false });
      renderSelect();
    }
    renderTools();
    changed();
  }

  // --- Loading a file and listening once ---

  async function loadFile(file) {
    analysing?.abort();
    const controller = new AbortController();
    analysing = controller;
    const fromName = songFromFileName(file.name);
    // If the player shows the same song, keep its spelling, so the plan is found while it plays.
    const current = tabSong();
    const next = current && sameSong(current, fromName) ? current : fromName;
    await loadSong(next);
    try {
      setStatus(() => t('visconf.decoding'));
      const { samples, sampleRate } = await decodeSong(await file.arrayBuffer());
      const result = await analyzeSong(samples, sampleRate, {
        signal: controller.signal,
        onProgress: (fraction) => setStatus(() => t('visconf.analysing', { percent: Math.round(fraction * 100) })),
      });
      if (analysing !== controller) return;
      await useAnalysis(result);
      setStatus(() => t('visconf.analysed', { drops: result.drops.length, bpm: result.bpm ?? '–' }));
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      setStatus(() => t('visconf.decodeFailed', { error: error.message }));
    } finally {
      if (analysing === controller) analysing = null;
    }
  }

  // "Record current song": the song in the tab starts from the beginning and plays once while it is analysed.
  // Everything except stop and close is locked until the end; the editor can be closed meanwhile.
  function startRecording() {
    const current = tabSong();
    if (!current) {
      setStatus(() => t('visconf.noTabSong'));
      return;
    }
    const begin = async () => {
      picker.close();
      const state = getPlayerState();
      const canSeek = Boolean(state?.canSeek);
      recorder = createSongRecorder();
      recordWaiting = canSeek && state.position > 1;
      repeatDone = false;
      renderAll();
      setStatus(() => t(canSeek ? 'visconf.recording' : 'visconf.noSeekRecord'));
      if (canSeek) await seek(0);
      await control?.play?.();
    };
    if (!sameSong(current, song)) loadSong(current).then(begin);
    else begin();
  }

  async function stopRecording(keep = true) {
    if (!recorder) return;
    const finished = recorder;
    recorder = null;
    recordWaiting = false;
    unlock();
    renderAll();
    if (!keep) return;
    const state = getPlayerState();
    const length = state?.duration || clock.position(performance.now() / 1000);
    if (!(length > 1)) return;
    await useAnalysis(finished.finish(length));
    setStatus(() => t('visconf.recorded'));
  }

  // "Change here" (key C): a new change where the song is heard right now, while listening. Works with the editor
  // closed too, and during a recording, so the changes can be tapped in while the song is analysed.
  function markChange() {
    const position = playheadTime();
    if (position === null || !song.title) {
      note(() => t(tabSong() ? 'visconf.markOtherSong' : 'visconf.noTabSong'));
      return false;
    }
    const time = snapTime(Math.max(0, position - REACTION_SECONDS), markers, snapToggle.checked);
    if (visconf?.cues.some((cue) => Math.abs(cue.time - time) < 0.05)) {
      note(() => t('visconf.markExists'));
      return false;
    }
    remember();
    ensureVisconf({ record: false });
    const known = new Set(visconf.cues.map((cue) => cue.id));
    update({ visconf: insertCue(visconf, time, { markers }) }, { record: false });
    const added = visconf.cues.find((cue) => !known.has(cue.id));
    if (!added) {
      note(() => t('visconf.markExists'));
      return false;
    }
    if (!recorder) selected = { kind: 'cue', id: added.id };
    renderSelect();
    renderInspector();
    note(() => t('visconf.marked', { time: formatTime(added.time) }));
    return true;
  }
  // A note in the status line, and on the badge while the editor is closed.
  function note(message) {
    setStatus(message);
    badgeNote = { text: message(), until: performance.now() + NOTE_SHOW_MS };
  }

  // Outside the editor: a recording runs, or a short note (a change was set with C).
  function renderBadge(nowMs, position) {
    if (!badge) return;
    const parts = [];
    if (!open && recorder) parts.push(t('visconf.badgeRecording', { time: formatTime(position ?? 0).replace(/\.\d$/, '') }));
    if (!open && badgeNote && nowMs < badgeNote.until) parts.push(badgeNote.text);
    const text = parts.join(' · ');
    if (text === badgeText) return;
    badgeText = text;
    badge.textContent = text;
    badge.hidden = !text;
    badge.classList.toggle('is-recording', !open && Boolean(recorder));
  }

  // --- Drawing ---

  function resizeCanvas() {
    const width = canvas.clientWidth;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(LAYOUT.height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(LAYOUT.height * ratio);
      dirty = true;
    }
    return { width, ratio };
  }

  function draw(position) {
    const { width, ratio } = resizeCanvas();
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, LAYOUT.height);
    const x = (time) => timeToX(view, width, time);
    const { wave, cues: cueLane, ruler } = LAYOUT;

    context.fillStyle = COLORS.background;
    context.fillRect(0, wave.top, width, wave.bottom - wave.top);
    context.fillRect(0, cueLane.top, width, cueLane.bottom - cueLane.top);
    if (!duration) {
      context.fillStyle = COLORS.text;
      context.font = '12px system-ui, sans-serif';
      context.fillText(song.title ? t('visconf.emptyTimeline') : t('visconf.noSong'), 10, wave.top + 30);
      return;
    }

    // Sections of the visconf, alternating colours, so the boundaries are easy to see.
    (visconf?.cues ?? []).forEach((cue, index, cues) => {
      const end = cues[index + 1]?.time ?? duration;
      context.fillStyle = COLORS.sections[index % 2];
      context.fillRect(x(cue.time), cueLane.top, x(end) - x(cue.time), cueLane.bottom - cueLane.top);
    });

    // Quiet parts.
    for (const part of markers?.quiet ?? []) {
      const isSelected = selected?.kind === 'quiet' && selected.id === part.id;
      context.fillStyle = COLORS.quiet;
      context.fillRect(x(part.start), wave.top, x(part.end) - x(part.start), wave.bottom - wave.top);
      context.fillStyle = isSelected ? COLORS.selected : COLORS.quietEdge;
      context.fillRect(x(part.start) - 1, wave.top, 2, wave.bottom - wave.top);
      context.fillRect(x(part.end) - 1, wave.top, 2, wave.bottom - wave.top);
    }

    // Beat grid: every beat faint, every fourth (bar) a little stronger. Only when the beats are far enough apart.
    if (markers?.grid?.bpm) {
      const beats = beatsOf(markers.grid, view.end).filter((time) => time >= view.start);
      const spacing = (width / (view.end - view.start)) * (60 / markers.grid.bpm);
      const firstIndex = Math.round((beats[0] - markers.grid.offset) / (60 / markers.grid.bpm));
      beats.forEach((time, index) => {
        const isBar = (firstIndex + index) % 4 === 0;
        if (!isBar && spacing < 4) return;
        if (isBar && spacing * 4 < 4) return;
        context.fillStyle = isBar ? COLORS.bar : COLORS.beat;
        context.fillRect(Math.round(x(time)), isBar ? ruler.top + 6 : ruler.top + 11, 1, isBar ? wave.bottom - ruler.top - 6 : wave.bottom - ruler.top - 11);
      });
    }

    // Waveform: per pixel column the highest peak of the columns it covers.
    const peaks = analysis?.waveform?.peaks ?? [];
    const perSecond = analysis?.waveform?.perSecond ?? 20;
    const middle = (wave.top + wave.bottom) / 2;
    const half = (wave.bottom - wave.top) / 2 - 2;
    context.fillStyle = COLORS.wave;
    for (let column = 0; column < width; column++) {
      const from = Math.max(0, Math.floor(xToTime(view, width, column) * perSecond));
      const to = Math.min(peaks.length, Math.max(from + 1, Math.ceil(xToTime(view, width, column + 1) * perSecond)));
      let peak = 0;
      for (let i = from; i < to; i++) if (peaks[i] > peak) peak = peaks[i];
      const height = Math.max(1, (peak / 255) * half);
      context.fillRect(column, middle - height, 1, height * 2);
    }

    // Drops.
    for (const drop of markers?.drops ?? []) {
      const isSelected = selected?.kind === 'drop' && selected.id === drop.id;
      const at = Math.round(x(drop.time));
      context.fillStyle = isSelected ? COLORS.selected : COLORS.drop;
      context.fillRect(at - 1, wave.top, 2, wave.bottom - wave.top);
      context.beginPath();
      context.moveTo(at - 5, wave.top);
      context.lineTo(at + 5, wave.top);
      context.lineTo(at, wave.top + 7);
      context.fill();
    }

    // Cues with a short label: the preset or the collection.
    context.font = '11px system-ui, sans-serif';
    (visconf?.cues ?? []).forEach((cue, index, cues) => {
      const isSelected = selected?.kind === 'cue' && selected.id === cue.id;
      const at = Math.round(x(cue.time));
      context.fillStyle = isSelected ? COLORS.selected : cue.transition === 'soft' ? COLORS.soft : COLORS.cue;
      context.fillRect(at - 1, cueLane.top, 2, cueLane.bottom - cueLane.top);
      context.fillRect(at - 1, cueLane.top, 9, 8);
      const room = x(cues[index + 1]?.time ?? duration) - at - 14;
      if (room > 30) {
        context.fillStyle = COLORS.text;
        context.fillText(fitText(context, cue.label || presetText(cue), room), at + 12, cueLane.top + 24);
      }
    });

    // Time on the ruler.
    context.fillStyle = COLORS.text;
    context.font = '10px system-ui, sans-serif';
    const step = niceStep((view.end - view.start) / Math.max(1, width / 80));
    for (let time = Math.ceil(view.start / step) * step; time <= view.end; time += step) {
      context.fillText(formatTime(time).replace(/\.0$/, ''), x(time) + 3, ruler.top + 10);
    }

    // The section that plays right now, and a flash where the plan just changed the preset.
    const active = playing ? cuePlayer.active : null;
    if (active) {
      const end = visconf.cues.find((cue) => cue.time > active.time)?.time ?? duration;
      context.strokeStyle = COLORS.selected;
      context.lineWidth = 1;
      context.strokeRect(x(active.time) + 0.5, cueLane.top + 0.5, x(end) - x(active.time) - 1, cueLane.bottom - cueLane.top - 1);
    }
    if (fired && performance.now() - fired.at < FIRED_SHOW_MS) {
      const fade = 1 - (performance.now() - fired.at) / FIRED_SHOW_MS;
      context.fillStyle = `rgb(255 255 255 / ${Math.round(fade * 60)}%)`;
      context.fillRect(Math.round(x(fired.cue.time)) - 3, wave.top, 6, cueLane.bottom - wave.top);
      dirty = true; // keep fading
    }

    // What the two lanes are.
    context.font = '10px system-ui, sans-serif';
    for (const [label, top] of [
      [t('visconf.laneMarkers'), wave.top],
      [t('visconf.laneCues'), cueLane.top],
    ]) {
      const labelWidth = context.measureText(label).width + 8;
      context.fillStyle = 'rgb(0 0 0 / 55%)';
      context.fillRect(width - labelWidth - 2, top + 2, labelWidth, 13);
      context.fillStyle = COLORS.text;
      context.fillText(label, width - labelWidth + 2, top + 12);
    }

    // Playhead.
    if (position !== null) {
      context.fillStyle = COLORS.playhead;
      context.fillRect(Math.round(x(position)), 0, 1, LAYOUT.height);
    }
  }

  const niceStep = (seconds) => [1, 2, 5, 10, 15, 30, 60, 120, 300].find((step) => step >= seconds) ?? 600;

  function fitText(context, text, room) {
    if (context.measureText(text).width <= room) return text;
    let short = text;
    while (short.length > 1 && context.measureText(`${short}…`).width > room) short = short.slice(0, -1);
    return `${short}…`;
  }

  function presetText(cue) {
    if (cue.preset.mode === 'fixed') return shownName(cue.preset.name);
    const collection = library.collections.find((entry) => entry.id === cue.preset.pool);
    return t('visconf.randomFrom', { collection: collection?.name ?? t('library.all') });
  }

  // --- Mouse ---

  const pointerTime = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width };
  };
  const hitAt = ({ x, y, width }) => hitTest({ markers, visconf, view, width, x, y });

  canvas.addEventListener('pointerdown', (event) => {
    if (!duration || event.button !== 0 || recorder) return;
    const point = pointerTime(event);
    const hit = hitAt(point);
    if (!hit) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { hit, point, from: hit.time, start: { markers, visconf }, moved: false, newQuiet: event.shiftKey && hit.kind === 'wave' };
    if (['cue', 'drop'].includes(hit.kind)) selected = { kind: hit.kind, id: hit.id };
    else if (hit.kind.startsWith('quiet')) selected = { kind: 'quiet', id: hit.id };
    renderInspector();
    dirty = true;
  });

  canvas.addEventListener('pointermove', (event) => {
    const point = pointerTime(event);
    hover = point;
    if (drag) {
      if (!drag.moved && Math.abs(point.x - drag.point.x) < DRAG_START_PX) return;
      if (!drag.moved) remember();
      drag.moved = true;
      const to = xToTime(view, point.width, Math.max(0, Math.min(point.width, point.x)));
      const result = applyDrag(drag.start, drag.hit, drag.from, to, { snap: snapToggle.checked, newQuiet: drag.newQuiet });
      // Cues follow their markers. A new visconf (first marker drawn without one) is only made on release.
      const next = drag.start.visconf ? markerChange(result.markers, { markers: drag.start.markers, visconf: result.visconf }) : { markers: result.markers };
      update(next, { save: false });
    }
    showTooltip(point);
    dirty = true;
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const { hit, moved, point, start: drag0 } = drag;
    drag = null;
    if (moved) {
      if (!visconf && markers) {
        const next = markerChange(markers, { markers: drag0.markers, visconf: null });
        if (next.visconf) {
          update(next, { record: false });
          renderSelect();
        }
      }
      scheduleSave();
      return;
    }
    const now = performance.now();
    const double = now - lastClick.time < DOUBLE_CLICK_MS && Math.abs(point.x - lastClick.x) < 6;
    lastClick = { time: now, x: point.x };
    if (double && hit.kind === 'wave' && markers) {
      const known = new Set(markers.drops.map((drop) => drop.id));
      const hadVisconf = Boolean(visconf);
      update(markerChange(addDrop(markers, snapTime(hit.time, markers, snapToggle.checked))));
      if (!hadVisconf) renderSelect();
      selected = { kind: 'drop', id: markers.drops.find((drop) => !known.has(drop.id))?.id };
      renderInspector();
      return;
    }
    if (double && hit.kind === 'cues' && song.title) {
      remember();
      ensureVisconf({ record: false });
      const known = new Set(visconf.cues.map((cue) => cue.id));
      update({ visconf: insertCue(visconf, hit.time, { markers, snap: snapToggle.checked }) }, { record: false });
      selected = { kind: 'cue', id: visconf.cues.find((cue) => !known.has(cue.id))?.id };
      renderInspector();
      return;
    }
    if (['ruler', 'wave', 'cues'].includes(hit.kind)) {
      selected = null;
      renderInspector();
      if (isTabSong()) seek(Math.max(0, Math.min(1, (hit.time + getLookahead()) / (getPlayerState()?.duration || duration))));
    }
    dirty = true;
  });

  canvas.addEventListener('pointerleave', () => {
    hover = null;
    tooltip.hidden = true;
    dirty = true;
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!duration) return;
      event.preventDefault();
      const point = pointerTime(event);
      const span = view.end - view.start;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        view = scrollView(view, duration, ((event.deltaX || event.deltaY) / point.width) * span);
      } else {
        view = zoomView(view, duration, xToTime(view, point.width, point.x), Math.exp(event.deltaY * 0.002));
      }
      dirty = true;
    },
    { passive: false },
  );

  function showTooltip({ x, y, width }) {
    if (!duration || drag?.moved === false) return;
    const time = Math.max(0, Math.min(duration, xToTime(view, width, x)));
    const hit = hitAt({ x, y, width });
    const lines = [formatTime(time)];
    if (hit?.kind === 'drop') lines.push(t('visconf.tipDrop'));
    else if (hit?.kind?.startsWith('quiet')) lines.push(t('visconf.tipQuiet'));
    else if (hit?.kind === 'ruler' && markers?.grid?.bpm) lines.push(t('visconf.tipRuler'));
    const cue = visconf ? cueAt(visconf, time) : null;
    if (cue) lines.push(t('visconf.tipSection', { preset: `${cue.label ? `${cue.label}: ` : ''}${presetText(cue)} (${t(cue.transition === 'soft' ? 'visconf.soft' : 'visconf.cut')})` }));
    // The picture of the preset in this section: the fixed one, or for a random one the preset showing right now,
    // if this is the section that plays. Otherwise it is only decided when the change comes.
    const pictured = cue?.preset.mode === 'fixed' ? cue.preset.name : playing && cuePlayer.active?.id === cue?.id ? getMilkdrop()?.presetName : null;
    const thumb = tooltip.querySelector('.vc-tooltip-thumb') ?? document.createElement('span');
    thumb.className = 'vc-tooltip-thumb';
    const caption = tooltip.querySelector('.vc-tooltip-text') ?? document.createElement('span');
    caption.className = 'vc-tooltip-text';
    caption.textContent = lines.join(' · ');
    thumb.hidden = !pictured;
    if (pictured) thumb.style.backgroundImage = previewImage(previews, pictured);
    if (!tooltip.contains(caption)) tooltip.replaceChildren(thumb, caption);
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(x + 12, width - tooltip.offsetWidth - 4)}px`;
    tooltip.style.top = `${y < LAYOUT.height / 2 ? y + 16 : y - tooltip.offsetHeight - 8}px`;
  }

  // --- Toolbar, selection and inspector ---

  // While recording, everything except stop and close is disabled. Called at the end of every render function,
  // so nothing they enable slips through; after the recording they set the real states again (renderAll).
  function applyLock() {
    const locked = Boolean(recorder);
    root.classList.toggle('is-recording', locked);
    if (!locked) return;
    for (const element of root.querySelectorAll('button, input, select')) {
      if (element === recordButton || element === markButton || element === stopAtEndButton || element.classList.contains('vc-close') || element.disabled) continue;
      element.disabled = true;
      element.dataset.locked = '';
    }
  }
  function unlock() {
    for (const element of root.querySelectorAll('[data-locked]')) {
      element.disabled = false;
      delete element.dataset.locked;
    }
  }
  function renderAll() {
    renderSelect();
    renderTools();
    renderInspector();
    renderHistory();
    renderTransport();
    changed();
  }
  function renderTransport() {
    const state = getPlayerState();
    const hasTab = Boolean(tabSong());
    const canSeek = hasTab && Boolean(state?.canSeek);
    toggleButton.disabled = !hasTab;
    for (const selector of ['.vc-to-start', '.vc-back', '.vc-forward']) $(selector).disabled = !canSeek;
    repeatButton.disabled = !canSeek;
    stopAtEndButton.disabled = !hasTab;
    repeatButton.setAttribute('aria-pressed', String(endMode === 'repeat'));
    stopAtEndButton.setAttribute('aria-pressed', String(endMode === 'stop'));
    recordButton.disabled = !recorder && !hasTab;
    markButton.disabled = !isTabSong();
    setIcon(toggleButton, clock.playing ? 'pause' : 'play');
    applyLock();
  }

  function renderSelect() {
    select.replaceChildren(
      ...visconfs.map((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        return option;
      }),
    );
    select.disabled = visconfs.length === 0;
    if (visconf) select.value = visconf.id;
    $('.vc-rename').disabled = !visconf;
    $('.vc-delete').disabled = !visconf;
    $('.vc-new').disabled = !song.title;
    applyLock();
  }

  function renderTools() {
    const hasMarkers = Boolean(markers);
    tempoInput.disabled = !hasMarkers;
    if (document.activeElement !== tempoInput) tempoInput.value = markers?.grid?.bpm ? String(markers.grid.bpm) : '';
    for (const selector of ['.vc-tap', '.vc-downbeat', '.vc-draft', '.vc-restore']) $(selector).disabled = !hasMarkers;
    $('.vc-restore').disabled = !analysis;
    recordButton.setAttribute('aria-pressed', String(Boolean(recorder)));
    setIcon(recordButton, recorder ? 'stop' : 'record', t(recorder ? 'visconf.stopRecording' : 'visconf.record'));
    $('.vc-export').disabled = visconfs.length === 0 && !markers;
    applyLock();
  }

  // The inspector shows what is selected: a cue with its preset choice, or a marker with a delete button.
  function renderInspector() {
    renderInspectorParts();
    applyLock();
  }
  function renderInspectorParts() {
    inspector.replaceChildren();
    const cue = selected?.kind === 'cue' ? visconf?.cues.find((entry) => entry.id === selected.id) : null;
    if (selected && !cue && !(markers && (selected.kind === 'drop' ? markers.drops : markers.quiet).some((entry) => entry.id === selected.id))) selected = null;
    if (!selected) {
      inspector.append(text('p', t(duration ? 'visconf.help' : 'visconf.helpEmpty'), 'vc-help'));
      return;
    }
    if (!cue) {
      const isDrop = selected.kind === 'drop';
      const entry = (isDrop ? markers.drops : markers.quiet).find((item) => item.id === selected.id);
      inspector.append(
        text('span', isDrop ? t('visconf.dropAt', { time: formatTime(entry.time) }) : t('visconf.quietFromTo', { start: formatTime(entry.start), end: formatTime(entry.end) })),
        text('span', t(entry.manual ? 'visconf.byHand' : 'visconf.automatic'), 'vc-origin'),
        button(t('visconf.delete'), () => {
          update(markerChange(isDrop ? removeDrop(markers, entry.id) : removeQuiet(markers, entry.id)));
          selected = null;
          renderInspector();
        }),
      );
      return;
    }

    const mode = selectBox(
      [
        ['random', t('visconf.random')],
        ['fixed', t('visconf.fixed')],
      ],
      cue.preset.mode,
      (value) => update({ visconf: updateCue(visconf, cue.id, { preset: value === 'fixed' ? { mode: 'fixed', name: cue.preset.name ?? getMilkdrop()?.presetName ?? '' } : { mode: 'random', pool: ALL_PRESETS } }) }),
    );
    const parts = [text('span', formatTime(cue.time), 'vc-time')];
    // The picture of the fixed preset; a click opens the picker. For a random one the picker makes it fixed.
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'vc-pick';
    pick.title = t('visconf.pickTitle');
    pick.setAttribute('aria-label', t('visconf.pickTitle'));
    if (cue.preset.mode === 'fixed' && cue.preset.name) pick.style.backgroundImage = previewImage(previews, cue.preset.name);
    else pick.textContent = t('visconf.pick');
    pick.addEventListener('click', () => {
      pickingFor = cue.id;
      picker.show(cue.preset.mode === 'fixed' ? cue.preset.name : getMilkdrop()?.presetName);
    });
    parts.push(pick, mode);
    if (cue.preset.mode === 'random') {
      parts.push(
        selectBox(
          library.collections.map(({ id, name }) => [id, name]),
          cue.preset.pool,
          (pool) => update({ visconf: updateCue(visconf, cue.id, { preset: { mode: 'random', pool } }) }),
        ),
      );
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'vc-preset';
      input.value = cue.preset.name ?? '';
      input.title = nicknames?.get(cue.preset.name) ? `${nicknames.get(cue.preset.name)} · ${cue.preset.name}` : (cue.preset.name ?? '');
      input.setAttribute('list', 'vc-preset-names');
      input.setAttribute('aria-label', t('visconf.preset'));
      input.addEventListener('change', () => update({ visconf: updateCue(visconf, cue.id, { preset: { mode: 'fixed', name: input.value } }) }));
      parts.push(
        input,
        button(t('visconf.takeCurrent'), () => {
          const name = getMilkdrop()?.presetName;
          if (name) update({ visconf: updateCue(visconf, cue.id, { preset: { mode: 'fixed', name } }) });
        }),
      );
      fillPresetNames();
    }
    parts.push(
      selectBox(
        [
          ['cut', t('visconf.cut')],
          ['soft', t('visconf.soft')],
        ],
        cue.transition,
        (transition) => update({ visconf: updateCue(visconf, cue.id, { transition }) }),
      ),
    );
    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'vc-label';
    label.maxLength = 80;
    label.placeholder = t('visconf.label');
    label.setAttribute('aria-label', t('visconf.label'));
    label.value = cue.label;
    label.addEventListener('change', () => update({ visconf: updateCue(visconf, cue.id, { label: label.value }) }));
    parts.push(
      label,
      button(t('visconf.preview'), () => {
        const name = resolveFor(cue);
        if (name) getMilkdrop()?.selectPreset(name, { blendSeconds: cue.transition === 'soft' ? SOFT_BLEND_SECONDS : 0 });
      }),
      button(t('visconf.delete'), () => {
        update({ visconf: removeCue(visconf, cue.id) });
        selected = null;
        renderInspector();
      }),
    );
    inspector.append(...parts);
  }

  const resolveFor = (cue) => {
    const milkdrop = getMilkdrop();
    return milkdrop ? resolvePreset(cue, { allNames: milkdrop.presetNames, namesOf: (pool) => library.namesOf(pool, milkdrop.presetNames), current: milkdrop.presetName }) : null;
  };

  function fillPresetNames() {
    const list = document.getElementById('vc-preset-names');
    const names = getMilkdrop()?.presetNames ?? [];
    if (list.childElementCount === names.length) return;
    list.replaceChildren(
      ...names.map((name) => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      }),
    );
  }

  function text(tag, content, className) {
    const element = document.createElement(tag);
    element.textContent = content;
    if (className) element.className = className;
    return element;
  }
  function button(label, onClick) {
    const element = text('button', label, 'pb-tool');
    element.type = 'button';
    element.addEventListener('click', onClick);
    return element;
  }
  function selectBox(options, value, onSelect) {
    const element = document.createElement('select');
    for (const [optionValue, label] of options) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      element.append(option);
    }
    element.value = value;
    element.addEventListener('change', () => onSelect(element.value));
    return element;
  }

  // --- Buttons ---

  $('.vc-close').addEventListener('click', () => api.close());
  $('.vc-use-tab').addEventListener('click', () => {
    const current = tabSong();
    if (current) loadSong(current);
    else setStatus(() => t('visconf.noTabSong'));
  });
  $('.vc-load').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (file) loadFile(file);
  });
  for (const input of [titleInput, artistInput]) {
    input.addEventListener('change', () => loadSong({ title: titleInput.value, artist: artistInput.value, duration: song.duration }));
  }
  recordButton.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));
  markButton.addEventListener('click', () => markChange());
  badge?.addEventListener('click', () => api.show());
  const tabPosition = () => clock.position(performance.now() / 1000);
  const seekTo = (seconds) => {
    const length = getPlayerState()?.duration;
    if (length > 0) seek(Math.max(0, Math.min(1, seconds / length)));
  };
  $('.vc-to-start').addEventListener('click', () => seekTo(0));
  $('.vc-back').addEventListener('click', () => seekTo(tabPosition() - 5));
  $('.vc-forward').addEventListener('click', () => seekTo(tabPosition() + 5));
  toggleButton.addEventListener('click', () => control?.toggle?.());
  // The two end buttons work like a pair of radio buttons that can also both be off: a click on the pressed one
  // turns it off again.
  function setEndMode(mode) {
    endMode = END_MODES.includes(mode) ? mode : '';
    globalThis.chrome?.storage?.local?.set({ [END_KEY]: endMode }).catch?.(() => {});
    renderTransport();
  }
  repeatButton.addEventListener('click', () => setEndMode(endMode === 'repeat' ? '' : 'repeat'));
  stopAtEndButton.addEventListener('click', () => setEndMode(endMode === 'stop' ? '' : 'stop'));
  globalThis.chrome?.storage?.local
    ?.get([END_KEY, 'visconfRepeat'])
    .then((stored) => {
      // Before 0.1.3 there was only "Repeat", stored as visconfRepeat: true.
      const mode = stored?.[END_KEY] ?? (stored?.visconfRepeat === true ? 'repeat' : '');
      if (END_MODES.includes(mode) && mode !== endMode) {
        endMode = mode;
        renderTransport();
      }
    })
    .catch?.(() => {});
  playToggle.addEventListener('change', () => {
    if (!playToggle.checked) stopPlayback();
    globalThis.chrome?.storage?.local?.set({ [APPLY_KEY]: playToggle.checked }).catch?.(() => {});
    changed();
  });
  globalThis.chrome?.storage?.local
    ?.get(APPLY_KEY)
    .then((stored) => {
      if (stored?.[APPLY_KEY] === false) playToggle.checked = false;
    })
    .catch?.(() => {});

  select.addEventListener('change', () => {
    visconf = visconfs.find((entry) => entry.id === select.value) ?? null;
    selected = null;
    cuePlayer.load(visconf);
    renderInspector();
    changed();
  });
  $('.vc-new').addEventListener('click', () => {
    if (!song.title) return;
    const created = createVisconf({ name: t('visconf.defaultName', { number: visconfs.length + 1 }), song: { ...song, duration }, cues: cuesFromMarkers(markers) });
    update({ visconf: created });
    renderSelect();
  });
  $('.vc-rename').addEventListener('click', () => {
    if (!visconf) return;
    nameForm.hidden = false;
    const input = nameForm.querySelector('input');
    input.value = visconf.name;
    input.focus();
    input.select();
  });
  nameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = nameForm.querySelector('input').value.trim();
    nameForm.hidden = true;
    if (name && visconf) {
      update({ visconf: { ...visconf, name, updated: Date.now() } });
      renderSelect();
    }
  });
  nameForm.querySelector('[data-action="cancel"]').addEventListener('click', () => (nameForm.hidden = true));
  let deleteArmed = null;
  $('.vc-delete').addEventListener('click', async (event) => {
    if (!visconf) return;
    // A second click within 3 s confirms; a visconf can hold a lot of work.
    if (deleteArmed !== visconf.id) {
      deleteArmed = visconf.id;
      event.currentTarget.textContent = t('visconf.confirmDelete');
      setTimeout(() => {
        deleteArmed = null;
        $('.vc-delete').textContent = '🗑';
      }, 3000);
      return;
    }
    deleteArmed = null;
    $('.vc-delete').textContent = '🗑';
    remember();
    await store.remove(visconf.id);
    visconfs = visconfs.filter((entry) => entry.id !== visconf.id);
    visconf = visconfs[0] ?? null;
    if (!visconfs.length) anyPlans = (await store.all()).length > 0;
    selected = null;
    cuePlayer.load(visconf);
    renderSelect();
    renderInspector();
    changed();
  });

  tempoInput.addEventListener('change', () => {
    const bpm = Number(tempoInput.value);
    if (markers && bpm > 0) update({ markers: setTempo(markers, bpm, playheadTime() ?? markers.grid.offset) });
  });
  $('.vc-tap').addEventListener('click', () => {
    if (!markers) return;
    const bpm = tapper.tap(performance.now() / 1000);
    if (bpm) update({ markers: setTempo(markers, bpm) });
    // The last tap lands on a beat: during playback the grid follows the taps.
    const position = playheadTime();
    if (bpm && position !== null) update({ markers: setDownbeat(markers, position) }, { record: false });
  });
  $('.vc-downbeat').addEventListener('click', () => {
    const position = playheadTime();
    if (markers && position !== null) update({ markers: setDownbeat(markers, position) });
    else setStatus(() => t('visconf.needPlayhead'));
  });
  $('.vc-draft').addEventListener('click', () => {
    if (!markers || !song.title) return;
    remember();
    ensureVisconf({ record: false });
    // An existing plan is not overwritten: the draft becomes a new visconf.
    if (visconf.cues.length > 0) {
      update({ visconf: createVisconf({ name: t('visconf.draftName'), song: { ...song, duration }, cues: cuesFromMarkers(markers) }) }, { record: false });
      renderSelect();
    } else update({ visconf: { ...visconf, cues: cuesFromMarkers(markers) } }, { record: false });
  });
  $('.vc-restore').addEventListener('click', async () => {
    remember();
    markers = await store.resetMarkers(song);
    selected = null;
    renderInspector();
    renderTools();
    changed();
  });
  $('.vc-undo').addEventListener('click', () => undo());
  $('.vc-redo').addEventListener('click', () => redo());
  $('.vc-fit').addEventListener('click', () => {
    view = fullView(duration);
    changed();
  });
  $('.vc-export').addEventListener('click', async () => {
    await saveNow();
    const file = toFile(await store.all(), await store.analyses(), await store.markers());
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
    link.download = FILE_NAME;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  $('.vc-import').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const [file] = importInput.files;
    importInput.value = '';
    if (!file) return;
    try {
      const count = await store.merge(fromFile(await file.text()));
      await loadSong(song); // also starts a new undo history: the import is saved already
      setStatus(() => t('visconf.imported', { count }));
    } catch (error) {
      const reason = { 'not-json': 'visconf.importNotJson', 'not-visconfs': 'visconf.importWrongFile', 'too-new': 'visconf.importTooNew' }[error.message];
      setStatus(() => (reason ? t(reason) : t('visconf.importFailed', { error: error.message })));
    }
  });

  const typing = (target) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  window.addEventListener('keydown', (event) => {
    if (!open || recorder || typing(event.target) || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const wantsUndo = key === 'z' && !event.shiftKey;
    const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
    if (!wantsUndo && !wantsRedo) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const done = wantsUndo ? undo() : redo();
    setStatus(() => t(done ? (wantsUndo ? 'visconf.undone' : 'visconf.redone') : wantsUndo ? 'visconf.nothingToUndo' : 'visconf.nothingToRedo'));
  });
  window.addEventListener('keydown', (event) => {
    if (!open || recorder || !selected || !['Delete', 'Backspace'].includes(event.key)) return;
    if (typing(event.target)) return;
    event.preventDefault();
    if (selected.kind === 'cue') update({ visconf: removeCue(visconf, selected.id) });
    else if (selected.kind === 'drop') update(markerChange(removeDrop(markers, selected.id)));
    else update(markerChange(removeQuiet(markers, selected.id)));
    selected = null;
    renderInspector();
  });

  onLanguageChange(() => {
    renderSelect();
    renderTools();
    renderInspector();
    if (status) statusLine.textContent = status();
    dirty = true;
  });

  // --- Playback ---

  // Position in the song of what is heard right now, or null if the player does not play this song.
  function playheadTime(now = performance.now() / 1000) {
    if (!isTabSong()) return null;
    return Math.max(0, clock.position(now) - getLookahead());
  }

  function stopPlayback() {
    if (!playing) return;
    playing = false;
    held?.holdAutoAdvance(false, 'visconf');
    held = null;
    cuePlayer.load(visconf);
  }

  // One line that says whether the plan is running, and if not, why.
  function renderLive(position, nowMs) {
    const current = tabSong();
    let message;
    let running = false;
    if (!visconf) message = t('visconf.liveNoPlan');
    else if (!playToggle.checked) message = t('visconf.liveOff');
    else if (visconf.cues.length === 0) message = t('visconf.liveNoCues');
    else if (!current) message = t('visconf.liveNoTab');
    else if (position === null) message = t('visconf.liveOtherSong', { title: current.title });
    else if (!clock.playing) message = t('visconf.livePaused');
    else if (!getMilkdrop()) message = t('visconf.liveNoMilkdrop');
    else {
      running = true;
      const next = cuePlayer.upcoming(position);
      if (fired && nowMs - fired.at < FIRED_SHOW_MS) message = t('visconf.liveFired', { time: formatTime(fired.cue.time), preset: shownName(fired.preset) });
      else message = next ? t('visconf.liveNext', { seconds: Math.ceil(next.inSeconds) }) : t('visconf.liveLast');
    }
    if (message === liveText) return;
    liveText = message;
    liveLine.textContent = message;
    liveLine.title = message;
    liveLine.classList.toggle('is-running', running);
  }

  const api = {
    get open() {
      return open;
    },
    // true while the plan decides the presets: the automatic changes of Milkdrop and the visualizer switch rest.
    get playing() {
      return playing;
    },
    toggle() {
      if (open) api.close();
      else api.show();
    },
    async show() {
      open = true;
      root.hidden = false;
      renderBadge(performance.now(), null);
      if (!previews) {
        loadPreviews().then((data) => {
          previews = data;
          dirty = true;
          renderInspector();
        });
      }
      if (!song.title) {
        const current = tabSong();
        if (current) await loadSong(current);
      }
      renderAll();
    },
    // Only hides the editor: a running recording, the plan and the repeat go on.
    close() {
      open = false;
      picker.close();
      root.hidden = true;
      tooltip.hidden = true;
      nameForm.hidden = true;
      saveNow();
      onChange?.();
    },

    // Once per frame from the visualizer.
    frame(frame, nowMs) {
      const now = nowMs / 1000;
      const state = getPlayerState();
      if (state && state !== lastPlayerState && !state.unavailable) {
        lastPlayerState = state;
        clock.sync({ position: state.position, playing: state.playing }, now);
      }
      const position = playheadTime(now);

      // The end of the song: what is heard reached the end, or the tab stopped at its end.
      const length = state?.duration || 0;
      const atEnd = length > 0 && position !== null && (position >= length - 0.5 || (!clock.playing && clock.position(now) >= length - 1));
      if (recordWaiting && state && state.position <= 1) recordWaiting = false;
      if (recorder && !recordWaiting && position !== null && clock.playing) {
        recorder.frame(position, { peak: getInputPeak(), section: frame.section.name, bpm: frame.beat.bpm, kick: frame.beat.kick.hit });
        if (frame.section.drop) recorder.drop(position, frame.section.dropStrength ?? 1);
      }
      if (recorder && !recordWaiting && atEnd) stopRecording();
      if (atEnd && endMode === 'repeat' && !repeatDone && !recorder && state?.canSeek) {
        repeatDone = true;
        seek(0).then(() => control?.play?.());
      }
      // Stop at the end: the tab itself has to pause before it reaches the end, or the next song starts. A short
      // moment before is enough; the very end of a song is nearly always silent.
      if (endMode === 'stop' && !stopDone && length > 0 && clock.playing && tabPosition() >= length - STOP_BEFORE_END_SECONDS) {
        stopDone = true;
        control?.pause?.();
      }
      if (position !== null && length > 0 && position < length - 2) {
        repeatDone = false;
        stopDone = false;
      }

      const shouldPlay = playToggle.checked && visconf && position !== null && clock.playing;
      if (shouldPlay && !playing) playing = true;
      else if (!shouldPlay && playing) stopPlayback();
      if (playing && getMilkdrop() !== held) {
        // Switched to or away from Milkdrop meanwhile: the hold moves along.
        held?.holdAutoAdvance(false, 'visconf');
        held = getMilkdrop();
        held?.holdAutoAdvance(true, 'visconf');
      }
      if (playing) {
        const event = cuePlayer.update(position);
        if (event?.preset) {
          getMilkdrop()?.selectPreset(event.preset, { blendSeconds: event.transition === 'soft' ? SOFT_BLEND_SECONDS : 0 });
          fired = { cue: event.cue, preset: event.preset, at: nowMs };
          dirty = true;
        }
      }

      // The editor follows the song in the tab, so timeline and plan always belong to what plays (a playlist or
      // YouTube moving on to the next song). Open, it only follows a change in the tab: a file loaded for another
      // song stays until the tab moves on. "Repeat" keeps the song, and with it the editor, where it is.
      const current = tabSong();
      const tabKey = current ? songKey(current) : null;
      if (current && tabKey !== lastTabKey) {
        const previous = lastTabKey;
        lastTabKey = tabKey;
        if (!sameSong(current, song) && (!open || previous !== null || !song.title)) {
          const wasRecording = Boolean(recorder);
          loadSong(current).then(() => {
            if (wasRecording) setStatus(() => t('visconf.recordSongChanged'));
          });
        }
      }

      renderBadge(nowMs, position);
      if (!open) return;
      renderLive(position, nowMs);
      const heard = position ?? 0;
      const text = `${formatTime(heard)} / ${formatTime(length || duration)}`;
      if (text !== clockText) {
        clockText = text;
        clockLine.textContent = text;
        renderTransport();
      }
      if (position !== null && duration && !drag) {
        const followed = followView(view, duration, position);
        if (followed !== view) {
          view = followed;
          dirty = true;
        }
      }
      const x = position === null ? null : Math.round(timeToX(view, canvas.clientWidth, position));
      if (x !== playheadX) {
        playheadX = x;
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        draw(position);
      }
    },

    // The player asks for the state of the tab even while it is hidden, if the editor needs it.
    get needsPlayerState() {
      return open || Boolean(recorder) || (playToggle.checked && anyPlans);
    },
    markChange,
    get picker() {
      return picker;
    },

    // For the smoke test and DevTools.
    get recording() {
      return Boolean(recorder);
    },
    get state() {
      return { song, duration, analysis, markers, visconf, visconfs, view, selected, recording: Boolean(recorder), live: liveText };
    },
    loadSong,
    useAnalysis,
    loadFile,
    update,
    undo,
    redo,
    setPlay(on) {
      playToggle.checked = on;
      if (!on) stopPlayback();
    },
    saveNow,
  };
  return api;
}

