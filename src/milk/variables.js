// Milkdrop variables and functions with short explanations. For the help in the editor, the syntax colouring and the
// description of the base values. Source: MilkDrop Preset Authoring Guide (Ryan Geiss) and the Butterchurn code.
//
// Each entry is [name, English, German]. helpFor() and valueInfo() return the texts in the current language.
import { getLanguage, t } from '../i18n/i18n.js';

const AUDIO = [
  ['bass', 'Loudness of the bass, around 1 at normal volume', 'Lautstärke der Bässe, um 1 bei normaler Lautstärke'],
  ['mid', 'Loudness of the mids, around 1', 'Lautstärke der Mitten, um 1'],
  ['treb', 'Loudness of the highs, around 1', 'Lautstärke der Höhen, um 1'],
  ['bass_att', 'Bass, smoothed (reacts more slowly)', 'Bässe, geglättet (reagiert träger)'],
  ['mid_att', 'Mids, smoothed', 'Mitten, geglättet'],
  ['treb_att', 'Highs, smoothed', 'Höhen, geglättet'],
];

const TIME = [
  ['time', 'Seconds since the start', 'Sekunden seit dem Start'],
  ['fps', 'Current frames per second', 'Bilder pro Sekunde gerade'],
  ['frame', 'Number of the frame since the start', 'Nummer des Bildes seit dem Start'],
];

const Q = [['q1 … q32', 'Bridge to shapes, waves and shaders: set in frame, read there', 'Brücke zu Formen, Wellen und Shadern: im Frame setzen, dort lesen']];
const T = [['t1 … t8', 'Bridge from init/frame of a shape or wave to its point equations', 'Brücke von Init/Frame einer Form oder Welle zu ihren Punkt-Formeln']];

const MOTION = [
  ['zoom', 'Zoom per frame: above 1 pulls inwards, below 1 outwards', 'Zoom pro Bild: über 1 nach innen ziehen, unter 1 nach außen'],
  ['zoomexp', 'How much the zoom increases towards the edge', 'Wie stark der Zoom zum Rand hin zunimmt'],
  ['rot', 'Rotation per frame (radians, 0.01 is slow)', 'Drehung pro Bild (Bogenmaß, 0.01 ist langsam)'],
  ['warp', 'Strength of the warping', 'Stärke des Waberns'],
  ['cx', 'Centre for zoom and rotation, horizontal (0 to 1)', 'Mitte für Zoom und Drehung, waagerecht (0 bis 1)'],
  ['cy', 'Centre for zoom and rotation, vertical (0 to 1)', 'Mitte für Zoom und Drehung, senkrecht (0 bis 1)'],
  ['dx', 'Shift per frame, horizontal', 'Verschieben pro Bild, waagerecht'],
  ['dy', 'Shift per frame, vertical', 'Verschieben pro Bild, senkrecht'],
  ['sx', 'Stretch horizontally (1 = unchanged)', 'Strecken waagerecht (1 = unverändert)'],
  ['sy', 'Stretch vertically', 'Strecken senkrecht'],
];

const FRAME_ONLY = [
  ['decay', 'How much of the previous image remains (0.98 = long afterglow)', 'Wie viel vom vorigen Bild bleibt (0.98 = langes Nachleuchten)'],
  ['wave_r', 'Main wave: red (0 to 1)', 'Hauptwelle: Rot (0 bis 1)'],
  ['wave_g', 'Main wave: green', 'Hauptwelle: Grün'],
  ['wave_b', 'Main wave: blue', 'Hauptwelle: Blau'],
  ['wave_a', 'Main wave: opacity', 'Hauptwelle: Deckkraft'],
  ['wave_x', 'Main wave: horizontal position', 'Hauptwelle: Lage waagerecht'],
  ['wave_y', 'Main wave: vertical position', 'Hauptwelle: Lage senkrecht'],
  ['wave_mode', 'Main wave: shape (0 to 7)', 'Hauptwelle: Form (0 bis 7)'],
  ['wave_mystery', 'Main wave: extra value, depends on the shape', 'Hauptwelle: Zusatzwert, je nach Form unterschiedlich'],
  ['ob_size', 'Outer border: width', 'Äußerer Rahmen: Breite'],
  ['ob_r', 'Outer border: red (ob_g, ob_b, ob_a likewise)', 'Äußerer Rahmen: Rot (ob_g, ob_b, ob_a entsprechend)'],
  ['ib_size', 'Inner border: width', 'Innerer Rahmen: Breite'],
  ['ib_r', 'Inner border: red (ib_g, ib_b, ib_a likewise)', 'Innerer Rahmen: Rot (ib_g, ib_b, ib_a entsprechend)'],
  ['echo_zoom', 'Echo: size of the second image', 'Echo: Größe des zweiten Bildes'],
  ['echo_alpha', 'Echo: opacity of the second image', 'Echo: Deckkraft des zweiten Bildes'],
  ['monitor', 'Value shown for testing in MilkDrop (Butterchurn does not show it)', 'Anzeige zum Testen in MilkDrop (Butterchurn zeigt sie nicht)'],
  ['meshx', 'Number of grid points horizontally (read only)', 'Anzahl Gitterpunkte waagerecht (nur lesen)'],
  ['meshy', 'Number of grid points vertically (read only)', 'Anzahl Gitterpunkte senkrecht (nur lesen)'],
  ['aspectx', 'Aspect ratio correction, horizontal (read only)', 'Seitenverhältnis-Ausgleich waagerecht (nur lesen)'],
  ['aspecty', 'Aspect ratio correction, vertical (read only)', 'Seitenverhältnis-Ausgleich senkrecht (nur lesen)'],
];

const PIXEL_ONLY = [
  ['x', 'Horizontal position of the grid point (0 left to 1 right, read only)', 'Lage des Gitterpunkts waagerecht (0 links bis 1 rechts, nur lesen)'],
  ['y', 'Vertical position of the grid point (0 top to 1 bottom, read only)', 'Lage des Gitterpunkts senkrecht (0 oben bis 1 unten, nur lesen)'],
  ['rad', 'Distance from the centre (0 centre to about 1 corner, read only)', 'Abstand zur Mitte (0 Mitte bis etwa 1 Ecke, nur lesen)'],
  ['ang', 'Angle around the centre (radians, read only)', 'Winkel um die Mitte (Bogenmaß, nur lesen)'],
];

const SHAPE = [
  ['x', 'Centre of the shape, horizontal (0 to 1)', 'Mitte der Form waagerecht (0 bis 1)'],
  ['y', 'Centre of the shape, vertical (0 to 1)', 'Mitte der Form senkrecht (0 bis 1)'],
  ['rad', 'Size (radius)', 'Größe (Radius)'],
  ['ang', 'Rotation (radians)', 'Drehung (Bogenmaß)'],
  ['sides', 'Number of corners (3 triangle, 4 square, round from about 30)', 'Anzahl Ecken (3 Dreieck, 4 Quadrat, ab etwa 30 rund)'],
  ['r', 'Colour inside: red (g, b likewise)', 'Farbe innen: Rot (g, b entsprechend)'],
  ['a', 'Opacity inside', 'Deckkraft innen'],
  ['r2', 'Colour outside: red (g2, b2 likewise)', 'Farbe außen: Rot (g2, b2 entsprechend)'],
  ['a2', 'Opacity outside', 'Deckkraft außen'],
  ['border_r', 'Outline: red (border_g, border_b likewise)', 'Randlinie: Rot (border_g, border_b entsprechend)'],
  ['border_a', 'Outline: opacity', 'Randlinie: Deckkraft'],
  ['additive', '1 = add colours (glows), 0 = paint over', '1 = Farben addieren (leuchtet), 0 = übermalen'],
  ['thickoutline', '1 = thick outline', '1 = dicke Randlinie'],
  ['textured', '1 = use the image itself as the fill', '1 = das Bild selbst als Füllung verwenden'],
  ['tex_zoom', 'Fill: zoom', 'Füllung: Zoom'],
  ['tex_ang', 'Fill: rotation', 'Füllung: Drehung'],
  ['num_inst', 'How many times the shape is drawn', 'Wie oft die Form gezeichnet wird'],
  ['instance', 'Number of the copy being drawn (0 to num_inst-1, read only)', 'Nummer der gerade gezeichneten Kopie (0 bis num_inst-1, nur lesen)'],
];

const WAVE = [
  ['r', 'Colour: red (g, b likewise)', 'Farbe: Rot (g, b entsprechend)'],
  ['a', 'Opacity', 'Deckkraft'],
  ['samples', 'Number of points (up to 512)', 'Anzahl Punkte (bis 512)'],
  ['sep', 'Distance between the left and right channel', 'Abstand zwischen linkem und rechtem Kanal'],
  ['scaling', 'Amplitude of the sound values', 'Ausschlag der Tonwerte'],
  ['smoothing', 'Smoothing of the sound values (0 to 1)', 'Glättung der Tonwerte (0 bis 1)'],
  ['spectrum', '1 = frequencies instead of the waveform', '1 = Frequenzen statt Schwingung'],
  ['usedots', '1 = dots instead of a line', '1 = Punkte statt Linie'],
  ['thick', '1 = thick line', '1 = dicke Linie'],
  ['additive', '1 = add colours (glows)', '1 = Farben addieren (leuchtet)'],
];

const POINT = [
  ['sample', 'Position of the point in the wave (0 to 1, read only)', 'Lage des Punkts in der Welle (0 bis 1, nur lesen)'],
  ['value1', 'Left sound value at this position (read only)', 'Tonwert links an dieser Stelle (nur lesen)'],
  ['value2', 'Right sound value at this position (read only)', 'Tonwert rechts an dieser Stelle (nur lesen)'],
  ['x', 'Horizontal position of the point (0 to 1)', 'Lage des Punkts waagerecht (0 bis 1)'],
  ['y', 'Vertical position of the point (0 to 1)', 'Lage des Punkts senkrecht (0 bis 1)'],
  ['r', 'Colour of this point: red (g, b, a likewise)', 'Farbe dieses Punkts: Rot (g, b, a entsprechend)'],
];

export const EEL_FUNCTIONS = [
  ['sin(x)', 'Sine, oscillates between -1 and 1', 'Sinus, schwingt zwischen -1 und 1'],
  ['cos(x)', 'Cosine', 'Kosinus'],
  ['tan(x)', 'Tangent', 'Tangens'],
  ['asin(x)', 'Arc sine', 'Arkussinus'],
  ['acos(x)', 'Arc cosine', 'Arkuskosinus'],
  ['atan(x)', 'Arc tangent', 'Arkustangens'],
  ['atan2(y, x)', 'Angle to a point', 'Winkel zu einem Punkt'],
  ['sqrt(x)', 'Square root', 'Wurzel'],
  ['sqr(x)', 'Square (x*x)', 'Quadrat (x*x)'],
  ['pow(x, y)', 'x to the power of y', 'x hoch y'],
  ['exp(x)', 'e to the power of x', 'e hoch x'],
  ['log(x)', 'Natural logarithm', 'natürlicher Logarithmus'],
  ['log10(x)', 'Base-10 logarithm', 'Zehnerlogarithmus'],
  ['abs(x)', 'Absolute value (without sign)', 'Betrag (ohne Vorzeichen)'],
  ['sign(x)', 'Sign: -1, 0 or 1', 'Vorzeichen: -1, 0 oder 1'],
  ['min(a, b)', 'Smaller value', 'kleinerer Wert'],
  ['max(a, b)', 'Larger value', 'größerer Wert'],
  ['floor(x)', 'Round down', 'abrunden'],
  ['ceil(x)', 'Round up', 'aufrunden'],
  ['int(x)', 'Cut off the decimals', 'Nachkommastellen abschneiden'],
  ['rand(n)', 'Random number from 0 to n', 'Zufallszahl von 0 bis n'],
  ['sigmoid(x, k)', 'Smooth step from 0 to 1', 'weiche Stufe von 0 nach 1'],
  ['if(cond, a, b)', 'a if cond is not 0, otherwise b', 'a, wenn cond nicht 0 ist, sonst b'],
  ['above(a, b)', '1 if a is greater than b, otherwise 0', '1, wenn a größer als b, sonst 0'],
  ['below(a, b)', '1 if a is less than b, otherwise 0', '1, wenn a kleiner als b, sonst 0'],
  ['equal(a, b)', '1 if equal, otherwise 0', '1, wenn gleich, sonst 0'],
  ['bnot(x)', '1 if x is 0, otherwise 0', '1, wenn x gleich 0 ist, sonst 0'],
  ['band(a, b)', '1 if both are not 0 (and)', '1, wenn beide nicht 0 sind (und)'],
  ['bor(a, b)', '1 if either is not 0 (or)', '1, wenn einer nicht 0 ist (oder)'],
  ['loop(n, code)', 'Run code n times', 'code n-mal ausführen'],
  ['while(code)', 'Repeat as long as code does not return 0', 'wiederholen, solange code nicht 0 ergibt'],
  ['exec2(a, b)', 'Run a and b, result b', 'a und b ausführen, Ergebnis b'],
  ['megabuf(i)', 'Large number array of this preset (read and write)', 'großes Zahlenfeld dieses Presets (lesen und schreiben)'],
  ['gmegabuf(i)', 'Large number array shared by all parts', 'großes Zahlenfeld, das alle Teile teilen'],
];

const SHADER = [
  ['ret', 'Result: the colour of this pixel (vec3)', 'Ergebnis: die Farbe dieses Bildpunkts (vec3)'],
  ['uv', 'Position of the pixel (0 to 1). In warp already shifted by zoom and rotation', 'Lage des Bildpunkts (0 bis 1). Im Warp schon durch Zoom und Drehung verschoben'],
  ['uv_orig', 'Position without the shift (warp only)', 'Lage ohne Verschiebung (nur Warp)'],
  ['rad', 'Distance from the centre', 'Abstand zur Mitte'],
  ['ang', 'Angle around the centre', 'Winkel um die Mitte'],
  ['sampler_main', 'The previous image: texture(sampler_main, uv).rgb', 'das vorige Bild: texture(sampler_main, uv).rgb'],
  ['sampler_blur1', 'Slightly blurred version (blur2, blur3 stronger). Multiply by scale1 and add bias1', 'leicht unscharfe Fassung (blur2, blur3 stärker). Mal scale1 plus bias1 rechnen'],
  ['sampler_noise_lq', 'Noise texture (also _mq, _hq)', 'Rauschtextur (auch _mq, _hq)'],
  ['texsize', 'Image size: xy in pixels, zw = 1 divided by the size', 'Bildgröße: xy in Pixeln, zw = 1 durch Größe'],
  ['aspect', 'Aspect ratio correction', 'Seitenverhältnis-Ausgleich'],
  ['time', 'Seconds since the start', 'Sekunden seit dem Start'],
  ['bass', 'Bass (mid, treb, bass_att … as in the equations)', 'Bässe (mid, treb, bass_att … wie in den Formeln)'],
  ['q1 … q32', 'Values from the frame equations', 'Werte aus den Frame-Formeln'],
  ['rand_frame', 'Four random values, new every frame', 'vier Zufallswerte, neu in jedem Bild'],
  ['rand_preset', 'Four random values, fixed for this preset', 'vier Zufallswerte, fest für dieses Preset'],
  ['decay', 'Afterglow from the base values (warp only)', 'Nachleuchten aus den Grundwerten (nur Warp)'],
  ['hue_shader', 'Colour gradient across the image (comp only)', 'Farbverlauf über das Bild (nur Comp)'],
];

export const GLSL_FUNCTIONS = [
  ['texture(s, uv)', 'Read the colour of a texture at a position', 'Farbe einer Textur an einer Stelle lesen'],
  ['mix(a, b, t)', 'Blend between a and b (t from 0 to 1)', 'zwischen a und b überblenden (t von 0 bis 1)'],
  ['clamp(x, lo, hi)', 'Limit to a range', 'auf einen Bereich begrenzen'],
  ['fract(x)', 'Fractional part, repeats from 0 to 1', 'Nachkommaanteil, wiederholt sich von 0 bis 1'],
  ['smoothstep(a, b, x)', 'Smooth transition from 0 to 1 between a and b', 'weicher Übergang von 0 nach 1 zwischen a und b'],
  ['step(a, x)', '0 below a, 1 from a', '0 unter a, 1 ab a'],
  ['length(v)', 'Length of a vector', 'Länge eines Vektors'],
  ['dot(a, b)', 'Dot product, for example for brightness', 'Skalarprodukt, etwa für Helligkeit'],
  ['sin(x)', 'Sine (cos, tan, pow, abs, min, max as usual)', 'Sinus (cos, tan, pow, abs, min, max wie gewohnt)'],
  ['vec3(r, g, b)', 'Build a colour or a 3-component vector', 'Farbe oder 3er-Vektor bauen'],
];

const textOf = (entry) => (getLanguage() === 'de' ? entry[2] : entry[1]);

// `kind` is shown in the list (help.kinds.*).
const entries = (list, kind) => list.map((entry) => ({ name: entry[0], text: textOf(entry), kind: t(`help.kinds.${kind}`) }));

// Help per editor section, in the current language: variables first, then functions.
export function helpFor(context) {
  const lists = {
    init: [entries(Q, 'variable'), entries(TIME, 'variable'), entries(EEL_FUNCTIONS, 'function')],
    frame: [entries(AUDIO, 'sound'), entries(TIME, 'time'), entries(MOTION, 'motion'), entries(FRAME_ONLY, 'image'), entries(Q, 'bridge'), entries(EEL_FUNCTIONS, 'function')],
    pixel: [entries(PIXEL_ONLY, 'point'), entries(MOTION, 'motion'), entries(AUDIO, 'sound'), entries(TIME, 'time'), entries(Q, 'bridge'), entries(EEL_FUNCTIONS, 'function')],
    shape: [entries(SHAPE, 'shape'), entries(AUDIO, 'sound'), entries(TIME, 'time'), entries([...Q, ...T], 'bridge'), entries(EEL_FUNCTIONS, 'function')],
    wave: [entries(WAVE, 'wave'), entries(POINT, 'point'), entries(AUDIO, 'sound'), entries(TIME, 'time'), entries([...Q, ...T], 'bridge'), entries(EEL_FUNCTIONS, 'function')],
    shader: [entries(SHADER, 'variable'), entries(GLSL_FUNCTIONS, 'function')],
  };
  return lists[context].flat();
}

// Names for the syntax colouring.
export const EEL_FUNCTION_NAMES = new Set(EEL_FUNCTIONS.map(([name]) => name.slice(0, name.indexOf('('))));
export const EEL_VARIABLE_NAMES = new Set(
  [...AUDIO, ...TIME, ...MOTION, ...FRAME_ONLY, ...PIXEL_ONLY, ...SHAPE, ...WAVE, ...POINT]
    .map(([name]) => name)
    .concat(['ob_g', 'ob_b', 'ob_a', 'ib_g', 'ib_b', 'ib_a', 'g', 'b', 'g2', 'b2', 'border_g', 'border_b', 'gammaadj', 'progress']),
);

// Base values of the preset, grouped: [group id, English, German, entries]. What is missing here ends up under "More".
const BASE_GROUPS = [
  ['motion', 'Motion', 'Bewegung', [
    ['zoom', 'Zoom per frame: above 1 pulls inwards, below 1 outwards', 'Zoom pro Bild: über 1 nach innen ziehen, unter 1 nach außen'],
    ['rot', 'Rotation per frame', 'Drehung pro Bild'],
    ['warp', 'Strength of the warping', 'Stärke des Waberns'],
    ['warpanimspeed', 'Speed of the warping', 'Tempo des Waberns'],
    ['warpscale', 'Size of the warp patterns', 'Größe der Wabern-Muster'],
    ['zoomexp', 'How much the zoom increases towards the edge', 'Wie stark der Zoom zum Rand hin zunimmt'],
    ['cx', 'Centre for zoom and rotation, horizontal', 'Mitte für Zoom und Drehung, waagerecht'],
    ['cy', 'Centre for zoom and rotation, vertical', 'Mitte für Zoom und Drehung, senkrecht'],
    ['dx', 'Shift per frame, horizontal', 'Verschieben pro Bild, waagerecht'],
    ['dy', 'Shift per frame, vertical', 'Verschieben pro Bild, senkrecht'],
    ['sx', 'Stretch horizontally', 'Strecken waagerecht'],
    ['sy', 'Stretch vertically', 'Strecken senkrecht'],
  ]],
  ['image', 'Image', 'Bild', [
    ['decay', 'How much of the previous image remains (afterglow)', 'Wie viel vom vorigen Bild bleibt (Nachleuchten)'],
    ['gammaadj', 'Brightness of the display', 'Helligkeit der Anzeige'],
    ['brighten', '1 = brighten', '1 = aufhellen'],
    ['darken', '1 = darken', '1 = abdunkeln'],
    ['solarize', '1 = solarise (inverts the bright tones)', '1 = Solarisation (Farbumkehr der hellen Töne)'],
    ['invert', '1 = invert colours', '1 = Farben umkehren'],
    ['darken_center', '1 = darken the centre', '1 = Mitte abdunkeln'],
    ['wrap', '1 = repeat at the edge instead of fraying', '1 = am Rand wiederholen statt ausfransen'],
    ['red_blue', '1 = red-blue 3D', '1 = Rot-Blau-3D'],
    ['fshader', 'Strength of the old colour shader from MilkDrop 1', 'Stärke des alten Farb-Shaders aus MilkDrop 1'],
  ]],
  ['mainWave', 'Main wave', 'Hauptwelle', [
    ['wave_mode', 'Shape of the wave (0 to 7)', 'Form der Welle (0 bis 7)'],
    ['wave_a', 'Opacity', 'Deckkraft'],
    ['wave_scale', 'Size of the amplitude', 'Größe des Ausschlags'],
    ['wave_smoothing', 'Smoothing', 'Glättung'],
    ['wave_r', 'Red', 'Rot'],
    ['wave_g', 'Green', 'Grün'],
    ['wave_b', 'Blue', 'Blau'],
    ['wave_x', 'Horizontal position', 'Lage waagerecht'],
    ['wave_y', 'Vertical position', 'Lage senkrecht'],
    ['wave_mystery', 'Extra value, depends on the shape', 'Zusatzwert, je nach Form unterschiedlich'],
    ['wave_dots', '1 = dots instead of a line', '1 = Punkte statt Linie'],
    ['wave_thick', '1 = thick line', '1 = dicke Linie'],
    ['additivewave', '1 = add colours (glows)', '1 = Farben addieren (leuchtet)'],
    ['wave_brighten', '1 = pull the colour to full brightness', '1 = Farbe auf volle Helligkeit ziehen'],
    ['modwavealphabyvolume', '1 = opacity depends on the volume', '1 = Deckkraft hängt von der Lautstärke ab'],
    ['modwavealphastart', 'Visible from this volume', 'ab dieser Lautstärke sichtbar'],
    ['modwavealphaend', 'Fully visible from this volume', 'ab dieser Lautstärke voll sichtbar'],
  ]],
  ['echo', 'Echo', 'Echo', [
    ['echo_zoom', 'Size of the second image', 'Größe des zweiten Bildes'],
    ['echo_alpha', 'Opacity of the second image', 'Deckkraft des zweiten Bildes'],
    ['echo_orient', 'Mirroring of the second image (0 to 3)', 'Spiegelung des zweiten Bildes (0 bis 3)'],
  ]],
  ['border', 'Border', 'Rahmen', [
    ['ob_size', 'Outer border: width', 'Äußerer Rahmen: Breite'],
    ['ob_r', 'Outer border: red', 'Äußerer Rahmen: Rot'],
    ['ob_g', 'Outer border: green', 'Äußerer Rahmen: Grün'],
    ['ob_b', 'Outer border: blue', 'Äußerer Rahmen: Blau'],
    ['ob_a', 'Outer border: opacity', 'Äußerer Rahmen: Deckkraft'],
    ['ib_size', 'Inner border: width', 'Innerer Rahmen: Breite'],
    ['ib_r', 'Inner border: red', 'Innerer Rahmen: Rot'],
    ['ib_g', 'Inner border: green', 'Innerer Rahmen: Grün'],
    ['ib_b', 'Inner border: blue', 'Innerer Rahmen: Blau'],
    ['ib_a', 'Inner border: opacity', 'Innerer Rahmen: Deckkraft'],
  ]],
  ['motionVectors', 'Motion vectors', 'Bewegungslinien', [
    ['mv_a', 'Opacity (0 = off)', 'Deckkraft (0 = aus)'],
    ['mv_x', 'Number horizontally', 'Anzahl waagerecht'],
    ['mv_y', 'Number vertically', 'Anzahl senkrecht'],
    ['mv_l', 'Length', 'Länge'],
    ['mv_dx', 'Offset horizontally', 'Versatz waagerecht'],
    ['mv_dy', 'Offset vertically', 'Versatz senkrecht'],
    ['mv_r', 'Red', 'Rot'],
    ['mv_g', 'Green', 'Grün'],
    ['mv_b', 'Blue', 'Blau'],
    ['bmotionvectorson', '1 = switched on', '1 = eingeschaltet'],
  ]],
  ['blur', 'Blur for shaders', 'Unschärfe für Shader', [
    ['b1n', 'Blur 1: lower value', 'Blur 1: unterer Wert'],
    ['b1x', 'Blur 1: upper value', 'Blur 1: oberer Wert'],
    ['b2n', 'Blur 2: lower value', 'Blur 2: unterer Wert'],
    ['b2x', 'Blur 2: upper value', 'Blur 2: oberer Wert'],
    ['b3n', 'Blur 3: lower value', 'Blur 3: unterer Wert'],
    ['b3x', 'Blur 3: upper value', 'Blur 3: oberer Wert'],
    ['b1ed', 'Blur 1: edge enhancement', 'Blur 1: Kantenbetonung'],
  ]],
];

const SHAPE_GROUPS = [
  ['placement', 'Position and size', 'Lage und Größe', [
    ['x', 'Centre horizontal', 'Mitte waagerecht'],
    ['y', 'Centre vertical', 'Mitte senkrecht'],
    ['rad', 'Size', 'Größe'],
    ['ang', 'Rotation', 'Drehung'],
    ['sides', 'Number of corners', 'Anzahl Ecken'],
    ['num_inst', 'Number of copies', 'Anzahl Kopien'],
  ]],
  ['colour', 'Colour', 'Farbe', [
    ['r', 'Inside red', 'innen Rot'],
    ['g', 'Inside green', 'innen Grün'],
    ['b', 'Inside blue', 'innen Blau'],
    ['a', 'Inside opacity', 'innen Deckkraft'],
    ['r2', 'Outside red', 'außen Rot'],
    ['g2', 'Outside green', 'außen Grün'],
    ['b2', 'Outside blue', 'außen Blau'],
    ['a2', 'Outside opacity', 'außen Deckkraft'],
  ]],
  ['outline', 'Outline and fill', 'Rand und Füllung', [
    ['border_r', 'Outline red', 'Rand Rot'],
    ['border_g', 'Outline green', 'Rand Grün'],
    ['border_b', 'Outline blue', 'Rand Blau'],
    ['border_a', 'Outline opacity', 'Rand Deckkraft'],
    ['thickoutline', 'Thick outline', 'dicker Rand'],
    ['additive', 'Add colours', 'Farben addieren'],
    ['textured', 'Image as fill', 'Bild als Füllung'],
    ['tex_zoom', 'Fill zoom', 'Füllung Zoom'],
    ['tex_ang', 'Fill rotation', 'Füllung Drehung'],
  ]],
];

const WAVE_GROUPS = [
  ['wave', 'Wave', 'Welle', [
    ['samples', 'Number of points', 'Anzahl Punkte'],
    ['sep', 'Distance between the channels', 'Abstand der Kanäle'],
    ['scaling', 'Amplitude', 'Ausschlag'],
    ['smoothing', 'Smoothing', 'Glättung'],
    ['spectrum', 'Frequencies instead of the waveform', 'Frequenzen statt Schwingung'],
    ['usedots', 'Dots instead of a line', 'Punkte statt Linie'],
    ['thick', 'Thick line', 'dicke Linie'],
    ['additive', 'Add colours', 'Farben addieren'],
  ]],
  ['colour', 'Colour', 'Farbe', [
    ['r', 'Red', 'Rot'],
    ['g', 'Green', 'Grün'],
    ['b', 'Blue', 'Blau'],
    ['a', 'Opacity', 'Deckkraft'],
  ]],
];

const GROUPS = { base: BASE_GROUPS, shape: SHAPE_GROUPS, wave: WAVE_GROUPS };

// Description per value for 'base', 'shape' and 'wave', in the current language:
// map: key → { group, text }; order: group ids; labels: group id → name.
export function valueInfo(kind) {
  const map = new Map();
  const labels = new Map();
  for (const group of GROUPS[kind]) {
    const [id, , , list] = group;
    labels.set(id, textOf(group));
    for (const entry of list) map.set(entry[0], { group: id, text: textOf(entry) });
  }
  return { map, order: GROUPS[kind].map(([id]) => id), labels };
}
