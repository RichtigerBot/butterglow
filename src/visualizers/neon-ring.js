// Own visualizer and at the same time the template for more: a glowing frequency ring that reacts to the beats.
// Kick: the ring jumps and sends out a shockwave. Snare: the colours turn further and a
// soft halo swells. Hi-hat: sparks at the edge. Deliberately without flashing the whole picture.
// Drop: several wide shockwaves in a row, a shower of sparks and a colour jump.
// With lookahead ("Music" mode) the ring charges up before the drop: it contracts, the picture gets darker
// and the bars brighter. On the drop this discharges into the shockwaves.

import { waterToggle } from '../effects/water.js';

const BAR_COUNT = 96;
const FIRST_BIN = 2;
const SHOCKWAVE_SECONDS = 0.9;
const SPARK_SECONDS = 0.35;
const SPARKS_PER_HAT = 10;
const SNARE_HUE_STEP = 24;
const HUE_EASE_SECONDS = 0.25;
const HALO_RISE_SECONDS = 0.05;
const HALO_FALL_SECONDS = 0.45;
const DROP_WAVES = 4;
const DROP_WAVE_GAP_SECONDS = 0.09;
const DROP_SPARKS = 90;
const DROP_HUE_STEP = 150;
const DROP_SWELL_SECONDS = 1.2; // How long the ring stays larger after the drop.
const CHARGE_SECONDS = 0.5; // How long before the drop the charging starts.
const CHARGE_RELEASE_SECONDS = 0.25; // If a drop is discarded, the ring relaxes again this quickly.
const CHARGE_SHRINK = 0.3;
const CHARGE_DARKEN = 0.35;

export const neonRingSettings = [
  { id: 'halo', label: 'settings.neonRing.halo', type: 'range', min: 0, max: 100, default: 50, unit: ' %' },
  { id: 'shockwaves', label: 'settings.neonRing.shockwaves', type: 'toggle', default: true },
  { id: 'sparks', label: 'settings.neonRing.sparks', type: 'toggle', default: true },
  { id: 'dropBurst', label: 'settings.neonRing.dropBurst', type: 'toggle', default: true },
  waterToggle(true),
];

export function createNeonRing({ stage, engine, settings }) {
  const canvas = document.createElement('canvas');
  stage.append(canvas);
  const context = canvas.getContext('2d');

  // Logarithmic distribution, so bass and mids get as much room as the highs.
  const lastBin = engine.frequency.length * 0.75;
  const bins = Array.from({ length: BAR_COUNT }, (_, i) =>
    Math.floor(FIRST_BIN * (lastBin / FIRST_BIN) ** (i / BAR_COUNT)),
  );

  let shockwaves = [];
  let sparks = [];
  let hueOffset = 0;
  let hueOffsetTarget = 0;
  let halo = 0;
  let dropSwell = 0;
  let charge = 0;
  let lastTime = performance.now() / 1000;

  return {
    canvas,
    resize(width, height, pixelRatio) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    },
    render({ frequency, waveform, bass, treble, beat, section }) {
      const { width, height } = canvas;
      const centerX = width / 2;
      const centerY = height / 2;
      const size = Math.min(width, height);
      const now = performance.now() / 1000;
      const deltaSeconds = Math.max(0, now - lastTime);
      lastTime = now;

      // Soft envelope instead of the short pulse, so the halo swells and does not flash.
      if (beat.snare.hit) hueOffsetTarget += SNARE_HUE_STEP;
      hueOffset += (hueOffsetTarget - hueOffset) * (1 - Math.exp(-deltaSeconds / HUE_EASE_SECONDS));
      const haloTarget = beat.snare.pulse > 0.3 ? 1 : 0;
      const haloSeconds = haloTarget > halo ? HALO_RISE_SECONDS : HALO_FALL_SECONDS;
      halo += (haloTarget - halo) * (1 - Math.exp(-deltaSeconds / haloSeconds));

      const hue = now * 25 + hueOffset;

      // Paint over semi-transparently; this creates light trails.
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = 'rgb(5 3 15 / 22%)';
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      const drop = section?.drop && settings.dropBurst;
      if (drop) {
        hueOffsetTarget += DROP_HUE_STEP;
        dropSwell = 1;
        charge = 0;
      }
      dropSwell *= Math.exp(-deltaSeconds / DROP_SWELL_SECONDS);
      // Charging follows exactly the time until the drop; a discarded drop fades out softly.
      const chargeTarget = settings.dropBurst && section?.dropIn != null ? Math.max(0, Math.min(1, 1 - section.dropIn / CHARGE_SECONDS)) : 0;
      charge = chargeTarget >= charge ? chargeTarget : charge + (chargeTarget - charge) * (1 - Math.exp(-deltaSeconds / CHARGE_RELEASE_SECONDS));
      const tension = charge * charge; // strongest shortly before the drop
      if (tension > 0.01) {
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = `rgb(0 0 0 / ${tension * CHARGE_DARKEN})`;
        context.fillRect(0, 0, width, height);
        context.globalCompositeOperation = 'lighter';
      }
      const radius = size * (0.18 + bass * 0.08 + beat.kick.pulse * 0.07 + dropSwell * 0.05) * (1 - tension * CHARGE_SHRINK);

      if (drop) {
        for (let i = 0; i < DROP_WAVES; i++) shockwaves.push({ start: now + i * DROP_WAVE_GAP_SECONDS, radius, hue: hue + i * 40, width: 2.5 - i * 0.4 });
        for (let i = 0; i < DROP_SPARKS; i++) {
          sparks.push({ start: now, angle: Math.random() * Math.PI * 2, speed: 1 + Math.random() * 2 });
        }
      }

      if (beat.kick.hit && settings.shockwaves) shockwaves.push({ start: now, radius, hue });
      if (beat.hat.hit && settings.sparks) {
        for (let i = 0; i < SPARKS_PER_HAT; i++) {
          sparks.push({ start: now, angle: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.6 });
        }
      }
      shockwaves = shockwaves.filter((wave) => now - wave.start < SHOCKWAVE_SECONDS);
      sparks = sparks.filter((spark) => now - spark.start < SPARK_SECONDS);

      if (halo > 0.01) {
        const glow = context.createRadialGradient(centerX, centerY, radius * 0.8, centerX, centerY, radius * 2.2);
        glow.addColorStop(0, `hsl(${hue + 180} 90% 60% / ${halo * settings.halo * 0.004})`);
        glow.addColorStop(1, `hsl(${hue + 180} 90% 60% / 0)`);
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }

      for (const wave of shockwaves) {
        const progress = (now - wave.start) / SHOCKWAVE_SECONDS;
        if (progress < 0) continue;
        context.strokeStyle = `hsl(${wave.hue} 100% 65% / ${(1 - progress) ** 2})`;
        context.lineWidth = size * 0.012 * (wave.width ?? 1) * (1 - progress);
        context.beginPath();
        context.arc(centerX, centerY, wave.radius + progress * size * 0.6, 0, Math.PI * 2);
        context.stroke();
      }

      context.fillStyle = 'rgb(255 240 170)';
      for (const spark of sparks) {
        const age = (now - spark.start) / SPARK_SECONDS;
        const distance = radius + size * (0.08 + spark.speed * age * 0.3);
        const dot = size * 0.004 * (1 - age);
        context.fillRect(
          centerX + Math.cos(spark.angle) * distance - dot / 2,
          centerY + Math.sin(spark.angle) * distance - dot / 2,
          dot,
          dot,
        );
      }

      context.lineCap = 'round';
      context.lineWidth = size * 0.007;

      // Mirroring gives a closed ring without a jump between bass and highs.
      for (let i = 0; i < BAR_COUNT; i++) {
        const value = frequency[bins[i]] / 255;
        const length = size * 0.28 * value ** 1.6;
        const color = `hsl(${hue + i * 2.5} 100% ${50 + value * 25 + tension * 20}%)`;

        for (const side of [-1, 1]) {
          const angle = -Math.PI / 2 + side * ((i + 0.5) / BAR_COUNT) * Math.PI;
          const x = Math.cos(angle);
          const y = Math.sin(angle);
          context.strokeStyle = color;
          context.beginPath();
          context.moveTo(centerX + x * radius, centerY + y * radius);
          context.lineTo(centerX + x * (radius + length), centerY + y * (radius + length));
          context.stroke();
        }
      }

      // The waveform runs as a trembling circle inside the ring.
      context.strokeStyle = `hsl(${hue + 180} 100% ${60 + treble * 30}%)`;
      context.lineWidth = size * 0.003;
      context.beginPath();
      const step = Math.floor(waveform.length / 256);
      for (let i = 0; i <= 256; i++) {
        const sample = (waveform[(i % 256) * step] - 128) / 128;
        const ringRadius = radius * (0.85 + sample * 0.3);
        const angle = (i / 256) * Math.PI * 2;
        context.lineTo(centerX + Math.cos(angle) * ringRadius, centerY + Math.sin(angle) * ringRadius);
      }
      context.stroke();
    },
  };
}
