// Equalizer interface: sliders, curve over the live spectrum, presets and persistent storage.
import { EQ_FREQUENCIES } from '../audio/engine.js';
import { onLanguageChange, t } from '../i18n/i18n.js';

const STORAGE_KEY = 'equalizer';
const SAVE_DELAY_MS = 300;
const MAX_DB = 12;
const MIN_HZ = 20;
const MAX_HZ = 20000;
const CURVE_POINTS = 256;

// Names: eq.presets.<id>.
const PRESETS = {
  neutral: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  moreBass: [7, 6, 4, 1, 0, 0, 0, 0, 0, 0],
  club: [6, 5, 2, 0, -2, -1, 0, 2, 3, 3],
  warm: [3, 3, 2, 1, 0, 0, -1, -2, -3, -4],
  clear: [-2, -1, 0, 0, 0, 1, 2, 3, 4, 4],
  voice: [-3, -2, -1, 1, 3, 4, 3, 1, 0, -1],
};

function formatHz(hz) {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

function formatDb(value) {
  return `${value > 0 ? '+' : ''}${value}`;
}

function hzToX(hz, width) {
  return (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * width;
}

function sanitizeGains(gains) {
  if (!Array.isArray(gains) || gains.length !== EQ_FREQUENCIES.length) return PRESETS.neutral;
  return gains.map((gain) => (Number.isFinite(gain) ? Math.max(-MAX_DB, Math.min(MAX_DB, gain)) : 0));
}

export async function createEqualizerPanel({ root, engine, onVisibilityChange }) {
  const presetRow = root.querySelector('#eq-presets');
  const sliderRow = root.querySelector('#eq-sliders');
  const enabledInput = root.querySelector('#eq-enabled');
  const bassInput = root.querySelector('#eq-bass input');
  const bassOutput = root.querySelector('#eq-bass output');
  const canvas = root.querySelector('#eq-curve');
  const context = canvas.getContext('2d');

  const { [STORAGE_KEY]: saved } = await chrome.storage.local.get(STORAGE_KEY);
  let gains = sanitizeGains(saved?.gains);
  let enabled = saved?.enabled !== false;
  // Bass boost in percent, 0 to 100 (see AudioEngine.setBassBoost)
  let bassBoost = Number.isFinite(saved?.bassBoost) ? Math.max(0, Math.min(100, saved.bassBoost)) : 0;
  let saveTimer;

  const curveFrequencies = Float32Array.from(
    { length: CURVE_POINTS },
    (_, i) => MIN_HZ * (MAX_HZ / MIN_HZ) ** (i / (CURVE_POINTS - 1)),
  );
  const curve = new Float32Array(CURVE_POINTS);

  const presetButtons = Object.keys(PRESETS).map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t(`eq.presets.${name}`);
    button.dataset.preset = name;
    button.addEventListener('click', () => setGains(PRESETS[name]));
    presetRow.append(button);
    return { name, button };
  });
  onLanguageChange(() => {
    for (const { name, button } of presetButtons) button.textContent = t(`eq.presets.${name}`);
    updateControls();
  });

  const sliders = EQ_FREQUENCIES.map((frequency, index) => {
    const label = document.createElement('label');
    label.className = 'eq-band';

    const value = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = -MAX_DB;
    input.max = MAX_DB;
    input.step = 1;
    input.setAttribute('aria-label', `${formatHz(frequency)} Hertz`);
    input.addEventListener('input', () => {
      gains[index] = Number(input.value);
      applyGains();
    });
    input.addEventListener('dblclick', () => {
      gains[index] = 0;
      applyGains();
    });

    const name = document.createElement('span');
    name.textContent = formatHz(frequency);

    label.append(value, input, name);
    sliderRow.append(label);
    return { input, value };
  });

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ [STORAGE_KEY]: { gains, enabled, bassBoost } }), SAVE_DELAY_MS);
  }

  function updateControls() {
    sliders.forEach(({ input, value }, index) => {
      input.value = gains[index];
      value.textContent = formatDb(gains[index]);
    });
    for (const { name, button } of presetButtons) {
      button.classList.toggle('active', PRESETS[name].every((gain, index) => gain === gains[index]));
    }
    bassInput.value = bassBoost;
    bassOutput.textContent = bassBoost > 0 ? `${bassBoost} %` : t('debug.off');
    enabledInput.checked = enabled;
    root.classList.toggle('bypassed', !enabled);
  }

  function applyGains() {
    engine.setEqGains(gains);
    updateControls();
    save();
  }

  function setGains(next) {
    gains = [...next];
    applyGains();
  }

  enabledInput.addEventListener('change', () => {
    enabled = enabledInput.checked;
    engine.setEqEnabled(enabled);
    updateControls();
    save();
  });

  function setBassBoost(value) {
    bassBoost = value;
    engine.setBassBoost(bassBoost / 100);
    updateControls();
    save();
  }
  bassInput.addEventListener('input', () => setBassBoost(Number(bassInput.value)));
  bassInput.addEventListener('dblclick', () => setBassBoost(0));

  engine.setEqGains(gains);
  engine.setEqEnabled(enabled);
  engine.setBassBoost(bassBoost / 100);
  updateControls();

  function drawSpectrum(frequency, width, height) {
    const hzPerBin = engine.context.sampleRate / engine.analyser.fftSize;
    const bar = Math.max(2, Math.round(width / 96));
    context.fillStyle = 'rgb(255 79 216 / 30%)';
    for (let x = 0; x < width; x += bar) {
      const hz = MIN_HZ * (MAX_HZ / MIN_HZ) ** (x / width);
      const value = frequency[Math.min(frequency.length - 1, Math.round(hz / hzPerBin))] / 255;
      context.fillRect(x, height * (1 - value), bar - 1, height * value);
    }
  }

  function drawCurve(width, height) {
    engine.getEqResponse(curveFrequencies, curve);
    const toY = (decibels) => height / 2 - (decibels / MAX_DB) * (height / 2);

    context.strokeStyle = 'rgb(255 255 255 / 18%)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    context.strokeStyle = enabled ? '#4fd8ff' : 'rgb(255 255 255 / 40%)';
    context.lineWidth = Math.max(2, height / 60);
    context.beginPath();
    curve.forEach((decibels, i) => {
      const x = hzToX(curveFrequencies[i], width);
      const y = toY(Math.max(-MAX_DB, Math.min(MAX_DB, decibels)));
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  return {
    get open() {
      return !root.hidden;
    },
    toggle() {
      root.hidden = !root.hidden;
      onVisibilityChange();
    },
    render({ frequency }) {
      if (root.hidden) return;
      const ratio = window.devicePixelRatio;
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      drawSpectrum(frequency, width, height);
      drawCurve(width, height);
    },
  };
}
