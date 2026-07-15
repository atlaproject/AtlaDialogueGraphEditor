# Atla Dialogue Editor

A lightweight, browser-based **node graph editor** for [Pixel Crushers Dialogue System](https://www.pixelcrushers.com/dialogue-system/) CSV files. Open a dialogue database exported from the Dialogue System, visually edit conversations, entries and links on a canvas, then export back to CSV.

Everything runs entirely in the browser — no build step, no server, no data leaves your machine.

## Features

- 📂 Open Dialogue System CSV exports (or `.atladg` project files that bundle CSV + layout)
- 🕸️ Node graph canvas: pan, zoom, drag, box-select, multi-select and align
- ✏️ Inspector for editing dialogue text, conditions, scripts, sequences and links
- 🔀 Auto-layout (layered BFS) and node layout persistence across re-imports
- ✅ Conversation validation (missing START, dangling links, unreachable nodes, missing text/translation)
- ▶️ In-editor conversation preview / playthrough
- ↩️ Undo / redo and local autosave recovery
- 💾 Export back to Dialogue System CSV or to a self-contained `.atladg` project

## Usage

Open `index.html` in a modern browser, or use the hosted version on GitHub Pages. Then:

- **打开 (Open)** a `.csv` exported from the Dialogue System, or drag a `.csv` / `.atladg` file onto the window.
- Edit nodes on the canvas — double-click or right-click empty space to add a node, drag the port to link nodes.
- **导出 (Export)** back to CSV when done.

## Project structure

```
index.html      # markup / layout
css/style.css   # styles
js/app.js       # application logic
images/         # icons
```

## Deploying to GitHub Pages

This is a fully static site. To publish:

1. Push the repository to GitHub.
2. In **Settings → Pages**, set the source to the `main` branch (root).
3. The editor will be available at `https://<user>.github.io/<repo>/`.

A `.nojekyll` file is included so the site is served as-is.

## License

[MIT](LICENSE)
