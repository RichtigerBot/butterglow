# Debug view

Press **D** to open or close the debug view in the top left corner. While the settings menu is open, it moves to the
right of the menu. It stays open across restarts until you close it, and it never fades out. The values refresh
four times per second.

## Frame limit

The slider at the top sets how many frames per second are rendered. Its steps are:

- **Vsync:** the default
- **Fixed values:** 15, 24, 30, 45, 60, 75, 90, 120, 144, 165, 240, 360, 500, 750, 1000
- **Unlimited**

Why you normally always see 60: the visualizer draws exactly when the monitor wants a new frame (vsync). On a 60 Hz
monitor that is always 60, however much headroom the graphics card has left. The number then only means "manages at
least 60".

With a fixed limit or "unlimited", a separate loop runs without the monitor's clock:

- **Above the monitor rate** (for example unlimited): the frames are really rendered, but only as many are shown as the
  monitor can display. "FPS" then shows the maximum your graphics card can do. If unlimited gives about 400, there is
  plenty of headroom at 60, and 4K or a heavier preset will probably work too.
- **Below the monitor rate** (for example 30): this is what it looks like on a slower computer. Useful to check whether
  the water and beats still feel right at low frame rates.

Good to know:

- **Milkdrop's own frame rate is paused:** normally Milkdrop renders at 60 fps (menu → Milkdrop → frame rate),
  because many presets count frames instead of seconds and would otherwise run four times as fast on a 240 Hz
  monitor. While the debug view is open, Milkdrop draws on every frame instead, so "FPS" shows frames that were
  really drawn. Presets that count frames therefore run faster than usual while you measure.
- **Only while the debug view is open:** the limit only applies while the debug view is open. Closing it with D
  returns to vsync. The chosen step comes back the next time you open it.
- **Fans and power:** unlimited keeps the graphics card and one CPU core fully busy. It is meant for measurements, not
  for everyday use.
- **Tearing:** whether the image tears when there are more frames than the monitor can show is decided by Chrome, not
  by the extension. Normally nothing tears; the extra frames are simply dropped.
- **Red spikes above the monitor rate:** Chrome often renders in bursts in this mode: many fast frames, then a short
  wait for the display. This produces regular red spikes and many "stutters". In this mode only "FPS" matters for
  performance.
- **Interaction with automatic quality:** the automatic quality follows the limit. With a limit of 30 it only steps
  down when even 30 is not reached.

## The graph

Each bar is one frame. Its height shows how long it took until the next frame. The top of the graph is 50 ms; longer
bars are cut off. The last 180 frames are shown, the newest on the right.

- **Lower line:** 16.7 ms, which is 60 frames per second
- **Upper line:** 33.3 ms, which is 30 frames per second
- **Blue:** smooth, at least 45 frames per second
- **Yellow:** noticeably slower
- **Red:** over 50 ms, a visible stutter
- **White mark in each bar:** the extension's own processing time (see below)

Evenly low bars are good. Single red spikes are stutters, for example when a preset changes. If all bars are high, the
graphics card is overloaded.

## The values

| Value | Meaning |
|---|---|
| FPS | Frames drawn in the last second. With vsync the refresh rate of your monitor is the maximum; see frame limit. |
| Frame limit | The step chosen with the slider. |
| Frame time avg / max | Average and longest time between two frames over the last 60 frames. A high maximum with a good average means occasional stutters. |
| Stutters (10 s) | How many frames in the last 10 seconds took longer than 50 ms (with a low frame limit: more than twice as long as intended). Ideally 0. |
| Own processing time | How long the extension's code runs per frame: reading audio, beat detection, commands for the graphics card. The graphics card keeps working afterwards; its time is not included here. |
| Quality | Current level and resolution share. "Automatic → Medium (75 %)" means the automatic mode switched to Medium by itself. |
| Window | Window size in CSS pixels and the operating system's scaling. At 4K with 150 % this shows 2560×1440 · scale 1.5. |
| Visualizer image | The resolution the visualizer actually renders at. At quality High this is the full resolution of the monitor. |
| Water image | The same for the water with its reflection. "off" when the water is switched off. The Classic preset deliberately renders smaller. |
| Graphics card | What Chrome reports as the graphics card. "SwiftShader" or "llvmpipe" means the CPU renders instead of the graphics card, because hardware acceleration is off in Chrome. |
| Visualizer / preset / water | What is currently running. Helps to attribute a stutter to a preset. |
| Audio | Source (tab or demo), audio state (`running` means it is playing) and sample rate. |
| Latency | Delay of the audio through processing and up to the speakers. Together this should stay below about 50 ms, otherwise the picture feels late. |
| Level B / M / H | Loudness of bass, mids and highs in percent, as the visualizers see them. |
| Hits/min K / S / H | Kicks, snares and hi-hats detected in the last minute. After a restart this value needs a minute to become accurate. |
| Tempo | Detected tempo. "–" while it is not certain. |
| Section | Song section (calm, build-up, drop, normal), how strong the bass currently is compared to the song, and the time since the last drop. In "Music" mode also the lookahead and, once a drop is detected, "drop in … s" until it becomes audible ("unconfirmed" until it is confirmed). |
| JS memory | Memory used by the page. If it keeps growing over a long time, that is a memory leak. |

## Reporting performance problems

A screenshot of the debug view helps most in these cases:

1. 4K full screen with water "Lively" and quality "High" (set explicitly, not automatic)
2. The same with the water switched off
3. A preset that stutters, with its name visible in the "Preset" row

You set the quality in the menu under **Display → Quality**.

## Quality levels

| Level | Resolution | Meant for |
|---|---|---|
| Automatic | starts at High | default |
| High | 100 % | strong graphics cards |
| Medium | 75 % | about half the rendering work |
| Low | 50 % | a quarter of the rendering work, visibly softer |
| Very low | 35 % | last resort for very weak graphics |

How "Automatic" works:

- If the frame rate stays below 45 for 4 seconds in a row, it steps down one level.
- If it stays at 57 or more for 20 seconds in a row, it steps up one level.
- A level that was just too slow is not tried again for 2 minutes, so the quality does not jump back and forth.
- Pauses, for example while the window is in the background, do not count.
- On a 30 Hz monitor the automatic mode steps down even though playback is smooth. In that case set a fixed level.
