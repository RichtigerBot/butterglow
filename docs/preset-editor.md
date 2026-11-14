# Preset editor

The preset editor lets you change Milkdrop presets live while the music and the visualizer keep running.

## Opening the editor

- **M** opens the editor on the right with the preset that is currently playing.
- **B** opens the preset browser. On wide windows it sits to the left of the editor, so you can pick another preset
  while editing. If the window is too narrow, the browser closes.
- **N** (or ⧉ in the editor) opens a second, read-only panel between browser and editor. It shows any preset with the
  same tabs, which is handy for copying an equation from another preset. It does not follow the running preset.
- **Escape** closes all panels.

While the editor is open, presets do not change automatically.

## Tabs

| Tab | Contents |
|---|---|
| Base values | All values Butterchurn knows, grouped by area (motion, image, main wave, echo, border, motion vectors, blur), each with a short explanation. Values that differ from the default are highlighted. "Only changed" hides the rest. |
| Equations | Frame, pixel and init equations with line numbers. |
| Shapes | The four custom shapes: on/off switch, init and frame equations, and their values. |
| Waves | The four custom waves: on/off switch, init, frame and point equations, and their values. |
| Shaders | Warp and comp shaders in GLSL. |

A yellow dot on a tab or part means it differs from the original, a red dot means it contains an error.

In value fields the arrow keys change the value by ±0.01, with Shift by ±0.1 and with Alt by ±1.

Below every text field, "Variables and functions" lists everything that is available in that context, with a search.
A click inserts the name into the field you used last.

## Live preview and errors

About 400 ms after you stop typing, the editor checks the equations. If everything is valid, the visualizer switches to
the new version immediately, without a cross-fade.

If an equation or shader contains an error, the editor shows the part, the line and a message, and marks the line.
The visualizer keeps running the last version that worked.

Edited versions are kept per preset until the window is closed. **Reset** brings back the original (or the last saved
version of your own presets).

## New presets

**New** creates a preset from a template: empty, tunnel, dancing shapes, circular wave or shader playground. Each
template demonstrates one technique and explains it in comments.

## Saving

**Save** writes the preset as a `.milk` file into your custom preset folder. See
[custom-presets.md](custom-presets.md) for where files go and how this works in Brave.

- Bundled presets are never changed. Saving creates a variant named `Author - Title (edited).milk`.
- Your own presets are written back to their file.
- Presets with errors in their equations are not saved.

## About the `.milk` format

Base values, shapes, waves and equations are stored the way MilkDrop 3 and projectM read them. Butterchurn uses GLSL
shaders, which other programs do not understand, so they are stored under separate keys (`butterchurn_warp_N`,
`butterchurn_comp_N`); other programs ignore unknown keys. The original of an edited preset is remembered under
`butterchurn_based_on`.

`.milk` files from MilkDrop run with their base values, shapes, waves and equations. Their HLSL shaders are skipped,
and the editor shows a note about it.
