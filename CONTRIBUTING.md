# Contributing to ButterGlow

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Getting started

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension (see the README). After a change, run `npm run build` again and click the
reload button of the extension in `chrome://extensions`.

## Project layout

| Folder | Contents |
|---|---|
| `src/` | The extension: manifest, background worker, visualizer page |
| `src/audio/` | Audio chain, beat and section detection |
| `src/visualizers/` | Milkdrop and the built-in visualizers |
| `src/effects/` | Water surfaces |
| `src/milk/` | `.milk` file format, preset editor logic, custom preset storage |
| `src/ui/` | Panels: preset browser, editor, equalizer, settings, debug |
| `src/player/` | Media controls for the captured tab |
| `scripts/` | Build and preview scripts, analysis tools |
| `test/` | Unit tests (`node --test`) and browser tests |
| `docs/` | Documentation |

## Tests

```bash
npm test
```

`npm test` builds the extension, runs the unit tests and then the browser tests. The browser tests start Chrome
through Puppeteer and need a Chrome or Chromium binary. Point `CHROME_PATH` at it if it is not in the Puppeteer
cache:

```bash
CHROME_PATH=/usr/bin/chromium npm test
```

`src/previews.json` holds the small preview images of the bundled presets. It is generated with
`npm run previews` (needs Chrome as well) and only has to be regenerated when the preset list changes.

Please make sure all tests pass before opening a pull request, and add a test for new behaviour where it makes sense.

## Code style

- Plain JavaScript modules, no framework. The build bundles them with esbuild.
- Code, comments, documentation and commit messages are in English.
- Keep comments short and explain *why*, not *what*.
- The extension must work without remote code: no CDN scripts, no `eval`. Preset equations run as WebAssembly.

## Presets

The bundled presets come from `butterchurn-presets` and were written by many authors of the MilkDrop community.
If you contribute presets, keep the original author in the name of edited presets and only submit presets you are
allowed to share.

## Releases

1. Raise `version` in both `src/manifest.json` and `package.json` (the packer refuses mismatching versions).
2. Run `npm test`, then `npm run package`. The result is `release/butterglow-<version>.zip`.
3. Commit, tag the commit as `v<version>` and push the tag.
4. On GitHub, create a release from the tag and attach the zip file.
