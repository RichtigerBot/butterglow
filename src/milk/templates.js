// Templates for new presets ("New" button in the editor). Each shows one technique and explains it in comments.
// Names, descriptions and the comments in the code follow the current language; c(en, de) picks the comment.
import { getLanguage, t } from '../i18n/i18n.js';

const c = (en, de) => (getLanguage() === 'de' ? de : en);

const emptyShape = () => ({ baseVals: { enabled: 0 }, init_eqs_eel: '', frame_eqs_eel: '' });
const emptyWave = () => ({ baseVals: { enabled: 0 }, init_eqs_eel: '', frame_eqs_eel: '', point_eqs_eel: '' });
const lines = (...parts) => parts.join('\n');

function preset({ baseVals = {}, init = '', frame = '', pixel = '', shapes = [], waves = [], warp = '', comp = '' }) {
  return {
    version: 2,
    baseVals,
    init_eqs_eel: init,
    frame_eqs_eel: frame,
    pixel_eqs_eel: pixel,
    shapes: [0, 1, 2, 3].map((i) => (shapes[i] ? { ...emptyShape(), ...shapes[i], baseVals: { ...shapes[i].baseVals } } : emptyShape())),
    waves: [0, 1, 2, 3].map((i) => (waves[i] ? { ...emptyWave(), ...waves[i], baseVals: { ...waves[i].baseVals } } : emptyWave())),
    warp,
    comp,
  };
}

// Name and description: templates.<id>.name / .description.
const described = (template) => ({
  ...template,
  get name() {
    return t(`templates.${template.id}.name`);
  },
  get description() {
    return t(`templates.${template.id}.description`);
  },
});

export const TEMPLATES = [
  {
    id: 'empty',
    preset: () =>
      preset({
        baseVals: { decay: 0.96, zoom: 1.01, wave_mode: 0, wave_a: 1, wave_scale: 1 },
        frame: lines(
          c('// Runs every frame. Lines without // take effect immediately.', '// Läuft bei jedem Bild. Zeilen ohne // wirken sofort.'),
          c('// To try something, delete the // in front of a line:', '// Zum Ausprobieren das // vor einer Zeile löschen:'),
          '// zoom = 1 + 0.05*bass;',
          '// rot = 0.01*sin(time);',
          '// wave_r = 0.5 + 0.5*sin(time);',
        ),
      }),
  },
  {
    id: 'tunnel',
    preset: () =>
      preset({
        baseVals: { decay: 0.97, wave_mode: 2, wave_a: 0.9, wave_scale: 1.2, wave_thick: 1, warp: 0.3 },
        frame: lines(
          c('// Basic motion for the whole image', '// Grundbewegung für das ganze Bild'),
          `zoom = 1.02 + 0.04*bass_att;     ${c('// bass pulls in harder', '// Bässe ziehen stärker hinein')}`,
          `rot = 0.004*sin(time*0.3);       ${c('// slow back-and-forth rotation', '// langsames Hin- und Herdrehen')}`,
          '',
          c('// The colour of the main wave moves around the colour wheel', '// Farbe der Hauptwelle wandert durch den Farbkreis'),
          'wave_r = 0.5 + 0.5*sin(time*0.7);',
          'wave_g = 0.5 + 0.5*sin(time*0.9 + 2);',
          'wave_b = 0.5 + 0.5*sin(time*1.1 + 4);',
        ),
        pixel: lines(
          c('// Runs for every grid point. rad is the distance from the centre.', '// Läuft für jeden Gitterpunkt. rad ist der Abstand zur Mitte.'),
          `zoom = zoom + 0.06*rad;          ${c('// zoom more at the edge: tunnel', '// außen stärker zoomen: Tunnel')}`,
          `rot = rot + 0.02*(1 - rad);      ${c('// rotate more in the centre: swirl', '// innen stärker drehen: Strudel')}`,
        ),
      }),
  },
  {
    id: 'shapes',
    preset: () =>
      preset({
        baseVals: { decay: 0.93, zoom: 0.99, wave_a: 0 },
        frame: lines(c('// The shapes have their own equations in the Shapes tab.', '// Die Formen haben eigene Formeln im Reiter Formen.'), 'rot = 0.003;'),
        shapes: [
          {
            baseVals: { enabled: 1, sides: 5, additive: 1, rad: 0.1, a: 1, a2: 0, border_a: 0 },
            frame_eqs_eel: lines(
              c('// Circular path around the centre, size pulses with the bass', '// Kreisbahn um die Mitte, Größe pulsiert mit den Bässen'),
              'x = 0.5 + 0.25*cos(time*0.7);',
              'y = 0.5 + 0.25*sin(time*0.9);',
              'rad = 0.06 + 0.08*bass;',
              'ang = time*0.5;',
              c('// colourful inside, transparent outside', '// innen bunt, außen durchsichtig'),
              'r = 0.5 + 0.5*sin(time);',
              'g = 0.5 + 0.5*sin(time + 2);',
              'b = 0.5 + 0.5*sin(time + 4);',
            ),
          },
          {
            baseVals: { enabled: 1, sides: 40, additive: 1, rad: 0.05, r: 1, g: 1, b: 1, a: 0.8, a2: 0, border_a: 0 },
            frame_eqs_eel: lines(c('// follows another path, reacts to the highs', '// folgt einer anderen Bahn, reagiert auf die Höhen'), 'x = 0.5 + 0.3*sin(time*0.5);', 'y = 0.5 + 0.2*cos(time*1.3);', 'rad = 0.03 + 0.05*treb;'),
          },
        ],
      }),
  },
  {
    id: 'circle-wave',
    preset: () =>
      preset({
        baseVals: { decay: 0.9, zoom: 1.005, wave_a: 0 },
        frame: lines(c('// The wave has its own equations in the Waves tab.', '// Die Welle hat eigene Formeln im Reiter Wellen.'), 'rot = 0.002*sin(time*0.2);'),
        waves: [
          {
            baseVals: { enabled: 1, samples: 512, thick: 1, additive: 1, scaling: 1, smoothing: 0.5 },
            point_eqs_eel: lines(
              c('// Runs for every point. sample goes from 0 to 1 once around.', '// Läuft für jeden Punkt. sample geht von 0 bis 1 einmal rundherum.'),
              'angle = sample*6.283 + time*0.2;',
              `radius = 0.2 + 0.15*value1;      ${c('// the sound bulges the circle', '// der Ton beult den Kreis aus')}`,
              `x = 0.5 + radius*cos(angle)*0.75; ${c('// 0.75 makes up for the wide image', '// 0.75 gleicht das breite Bild aus')}`,
              'y = 0.5 + radius*sin(angle);',
              'r = 0.5 + 0.5*sin(angle + time);',
              'g = 0.5 + 0.5*sin(angle + time + 2);',
              'b = 1;',
            ),
          },
        ],
      }),
  },
  {
    id: 'shader',
    preset: () =>
      preset({
        baseVals: { decay: 1, wave_mode: 6, wave_a: 0.8, wave_scale: 1.5 },
        frame: lines(c('// q variables are the bridge to the shaders', '// q-Variablen sind die Brücke zu den Shadern'), 'q1 = bass_att;', 'q2 = time*0.3;'),
        warp: lines(
          'shader_body {',
          c('  // read the previous image slightly bent and darken it a little: feedback', '  // das vorige Bild leicht verbogen lesen und etwas abdunkeln: Rückkopplung'),
          '  vec2 offset = vec2(sin(uv.y*12.0 + q2), cos(uv.x*12.0 + q2)) * 0.002;',
          '  ret = texture(sampler_main, uv + offset).rgb * 0.96;',
          '}',
        ),
        comp: lines(
          'shader_body {',
          c('  // display only: swap colours with the bass', '  // nur für die Anzeige: Farben mit den Bässen tauschen'),
          '  vec3 image = texture(sampler_main, uv).rgb;',
          '  ret = mix(image, image.gbr, clamp(q1 - 0.5, 0.0, 1.0)) * 1.2;',
          '}',
        ),
      }),
  },
].map(described);
