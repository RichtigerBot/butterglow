// All visualizers. New visualizers are registered here.
//
// `settingsSchema` describes the settings in the menu (see ui/settings-panel.js).
//
// `create({ stage, engine, settings })` is called when first shown, creates its own canvas
// in `stage` and returns an object with:
//   canvas                     its own canvas (shown and hidden when switching)
//   resize(width, height, pixelRatio)
//   render(frame)              once per frame; `frame` comes from AudioEngine.readFrame()
//                              frame.beat contains kick, snare and hat ({ hit, strength, pulse }) and bpm
//                              frame.section: name ('quiet', 'build', 'drop', 'normal'), drop (true only in the
//                              frame of the drop), dropStrength and intensity (0 to 1), build (0 to 1), sinceDrop (s or null)
//                              Only in "Music" mode (lookahead): dropIn (s until a detected drop becomes audible, else null)
//                              and dropConfirmed. An unconfirmed drop can disappear; dropIn is then null again.
//                              `settings` contains the current values and changes at runtime
//   nextPreset(), previousPreset(), presetName   optional, only for visualizers with presets
//   presetNames, selectPreset(name), poolFallback  optional, for the preset browser and collections
//
// `create` also receives `library`, the shared library with favourites and collections (ui/preset-library.js).

import { t } from '../i18n/i18n.js';
import { createMilkdrop, milkdropSettings } from './milkdrop.js';
import { createNeonRing, neonRingSettings } from './neon-ring.js';

export const visualizers = [
  { id: 'milkdrop', name: 'Milkdrop', create: createMilkdrop, settingsSchema: milkdropSettings },
  {
    id: 'neon-ring',
    get name() {
      return t('visualizers.neonRing');
    },
    create: createNeonRing,
    settingsSchema: neonRingSettings,
  },
];
