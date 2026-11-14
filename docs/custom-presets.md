# Custom presets

Presets you create or edit with the [preset editor](preset-editor.md) are saved as `.milk` files in a folder of your
choice. The bundled presets stay unchanged.

## Folder layout

Pick an empty folder, for example `custom-milk/`. ButterGlow uses two subfolders:

| Folder | Contents |
|---|---|
| `own/` | Presets you created from scratch |
| `edited/` | Variants of other presets. The original's author and title stay in the file name, for example `Geiss - Desert Rose 2 (edited).milk` |

Earlier versions used the German folder names `eigene/` and `bearbeitet/` and the suffix `(bearbeitet)`. These are
still read, and presets found there are saved back to where they are.

## Connecting the folder

1. In the visualizer press **B** and click the folder button at the top of the preset browser, then choose your
   folder. You can also do this the first time you save in the editor.
2. Access to the folder is remembered. After a browser restart Chrome may ask once more; the preset browser then
   offers a button to allow access again.
3. All `.milk` files in `own/` and `edited/` appear in the list, in the fixed collection for your own presets,
   and can be added to favourites and collections like any other preset. Files you change outside ButterGlow are
   picked up with the reload button.

## Brave and other browsers without folder access

Brave does not let extensions access folders. In that case:

1. **Save** keeps the preset inside the extension and also downloads the `.milk` file. Move it from your downloads
   folder into `own/` or `edited/`; the status line names the right folder.
2. **Open files** in the preset browser loads one or more `.milk` files.
3. The extension's storage is lost when the extension is removed or loaded again. Your files stay where they are and
   can be opened again quickly.

## Backing up favourites and collections

Favourites and collections live in the extension's storage and are lost when it is reinstalled. Back them up now and
then:

1. Press **B** and click **Back up** at the top of the preset browser. The file `butterglow-collections.json` is
   downloaded.
2. Keep it somewhere safe, for example next to your presets.
3. To restore, use **Open files** and choose that file. Existing entries are kept, missing ones are added.

## Learning to write presets

There is no official step-by-step tutorial. The most important source is the *MilkDrop Preset Authoring Guide* by
Ryan Geiss, the creator of MilkDrop. It ships with MilkDrop as `milkdrop_preset_authoring.html` and can be found
online. It explains every variable and every kind of equation.

A sensible order:

1. **Read:** open a simple preset (for example one by Geiss) and read it line by line. Which base values are there,
   what do the frame equations do?
2. **Change numbers:** `zoom`, `rot`, `warp`, `decay` and the colours. Watch the effect.
3. **Bring in the music:** use `bass`, `mid` and `treb` in the frame equations, for example `zoom = 1 + 0.05*bass`.
4. **Pixel equations:** bend the image depending on position with `x`, `y`, `rad` and `ang`, for example a swirl only
   in the centre.
5. **Waves and shapes:** your own circles and lines that react to the beat.
6. **Shaders:** warp and comp shaders. The hardest part, but the one with the most impressive results. ButterGlow
   uses GLSL; shaders from MilkDrop are written in HLSL and have to be translated by hand.

The editor's templates (**New**) are a good starting point for each of these steps.
