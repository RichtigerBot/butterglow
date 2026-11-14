// Switches the visualizer automatically at musically fitting moments: on the drop, optionally also at the
// start of a quiet part, and at the latest after an adjustable time on the next kick.
// With lookahead (Sound → "Music" mode) the short cross-fade starts earlier and finishes exactly on the drop.
// The decision is made here and can be tested without a browser. visualizer.js does the switching.

import { t } from '../i18n/i18n.js';

const DROP_BLEND_MS = 300;
const EARLY_BLEND_MS = { min: 100, max: 500 };

// The list depends on the visualizers: for each one there is a toggle whether it takes part.
export function autoSwitchSettingsFor(visualizers) {
  return [
    {
      id: 'mode',
      label: 'settings.autoSwitch.mode',
      type: 'select',
      default: 'off',
      options: [
        { value: 'off', label: 'settings.off' },
        { value: 'drop', label: 'settings.autoSwitch.drop' },
        { value: 'sections', label: 'settings.autoSwitch.sections' },
      ],
    },
    {
      id: 'minSeconds',
      label: 'settings.autoSwitch.minSeconds',
      type: 'select',
      default: 20,
      options: [
        { value: 10, label: () => '10 s' },
        { value: 20, label: () => '20 s' },
        { value: 45, label: () => '45 s' },
        { value: 90, label: () => '90 s' },
      ],
      custom: { label: 'settings.customTime', min: 2, max: 3600, default: 30, unit: ' s' },
    },
    {
      id: 'maxSeconds',
      label: 'settings.autoSwitch.maxSeconds',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'settings.autoSwitch.never' },
        { value: 120, label: () => '2 min' },
        { value: 300, label: () => '5 min' },
      ],
      custom: { label: 'settings.customTime', min: 10, max: 3600, default: 180, unit: ' s' },
    },
    {
      id: 'dropTransition',
      label: 'settings.autoSwitch.dropTransition',
      type: 'select',
      default: 'short',
      options: [
        { value: 'cut', label: 'settings.autoSwitch.cut' },
        { value: 'short', label: 'settings.autoSwitch.short' },
      ],
    },
    ...visualizers.map((visualizer) => ({ id: `use-${visualizer.id}`, label: () => t('settings.autoSwitch.use', { name: visualizer.name }), type: 'toggle', default: true })),
  ];
}

// `settings`: the values from autoSwitchSettingsFor. `transitionMs()`: the normal cross-fade (Display → Cross-fade).
export function createAutoSwitch({ visualizers, settings, transitionMs }) {
  let lastSwitch = null; // seconds
  let lastSection = null;
  let prepared = false; // the cross-fade for the upcoming drop is already running

  const enabled = () => visualizers.map((visualizer, index) => ({ visualizer, index })).filter(({ visualizer }) => settings[`use-${visualizer.id}`] !== false);

  function next(current) {
    const pool = enabled();
    if (pool.length === 0 || (pool.length === 1 && pool[0].index === current)) return null;
    const after = pool.find(({ index }) => index > current) ?? pool[0];
    return after.index === current ? null : after.index;
  }

  return {
    // After every switch, manual ones too (V key, menu). The time until the next automatic one starts again.
    noteSwitch(nowSeconds) {
      lastSwitch = nowSeconds;
      prepared = false;
    },

    // Once per frame. Returns { index, durationMs, reason } for a switch, otherwise null.
    // `busy`: do not switch right now (cross-fade running, editor or preset browser open).
    update({ section, beat }, nowSeconds, { current, busy = false }) {
      const previousSection = lastSection;
      lastSection = section.name;
      lastSwitch ??= nowSeconds;
      if (settings.mode === 'off' || busy) {
        prepared = false;
        return null;
      }
      const target = next(current);
      if (target === null) return null;
      const since = nowSeconds - lastSwitch;
      const ready = since >= settings.minSeconds;
      const decide = (durationMs, reason) => {
        lastSwitch = nowSeconds;
        return { index: target, durationMs, reason };
      };

      if (prepared) {
        // The switch is already running and ends with the drop. If the drop no longer comes (lookahead changed), it has happened anyway.
        if (section.drop || section.dropIn === null) prepared = false;
        return null;
      }
      if (ready && settings.dropTransition === 'short' && section.dropConfirmed && section.dropIn !== null) {
        prepared = true;
        const duration = Math.min(EARLY_BLEND_MS.max, Math.max(EARLY_BLEND_MS.min, section.dropIn * 1000));
        return decide(duration, 'drop');
      }
      if (ready && section.drop) return decide(settings.dropTransition === 'cut' ? 0 : DROP_BLEND_MS, 'drop');
      const quietStarts = section.name === 'quiet' && previousSection !== null && previousSection !== 'quiet';
      if (ready && settings.mode === 'sections' && quietStarts) return decide(transitionMs(), 'quiet');
      if (settings.maxSeconds > 0 && since >= settings.maxSeconds && beat?.kick?.hit) return decide(transitionMs(), 'time');
      return null;
    },
  };
}
