# opencode-browser-chat

[![HTML/CSS/JS](https://img.shields.io/badge/HTML-CSS-JS-orange)](https://developer.mozilla.org/)   ![status: done](https://img.shields.io/badge/status-done-green)   ![license: MIT](https://img.shields.io/badge/license-MIT-blue)

## Summary

OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.
## Problem / Why it exists

The project addresses a practical scope and automates a task that, done manually, is repetitive and error-prone. The focus is on turning data or processes into reliable output, with readable, testable, and extensible code.
## Architecture

Code files (28):
- `options.html`
- `panel.html`
- `content.css`
- `panel.css`
- `background.js`
- `content.js`
- `api.js`
- `prompts.js`
- `skills-inject.js`
- `options.js`
- `panel.js`
- `manifest.json`
- `browser-test.mjs`
- `capture-test.mjs`
- `e2e-test.mjs`
## Design Patterns and Techniques Identified

- Custom CSS styling
- ESM build scripts (.mjs)
- JSON data catalog
- Single-page HTML entry
- Vanilla JavaScript logic
## What it does

OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.
## How to run

Open `index.html` directly in the browser, or serve locally:

```bash
python -m http.server 8080
# access http://localhost:8080
```
## Project Structure

- `options.html`
- `panel.html`
- `content.css`
- `panel.css`
- `background.js`
- `content.js`
- `api.js`
- `prompts.js`
- `skills-inject.js`
- `options.js`
- `panel.js`
- `manifest.json`
- `browser-test.mjs`
- `capture-test.mjs`
- `e2e-test.mjs`
- `load-check.mjs`
- `make-icons.mjs`
- `model-default-test.mjs`
- `new-features-test.mjs`
- `options-model-test.mjs`
- `parts-render-test.mjs`
- `send-repro.mjs`
- `shot-panel.mjs`
- `skills-inject-test.mjs`
- `toolcard-test.mjs`
## Trade-offs and Technical Decisions

- Single file (or few): easy to host on any static server (GitHub Pages, Netlify, Vercel) and audit line by line.
- No build, no server, no database.
- Data in snapshot (when applicable), not real-time ,  user confirms on official linked source.
- Light/dark theme persisted in `localStorage` with no external JS.
## Known Limitations

- No backend; functionality limited to the browser.
- Static data or snapshot; confirm values in official sources.
- No authentication or multi-user support.
## Tests

No automated tests detected (documentation/guide project).
## License

Distributed under the MIT License. See the `LICENSE` file in this repository.
## Author

Kelvin Oliveira ,  https://github.com/KelvinOliveiraCode
Portfolio: https://kelvinoliveiracode.github.io/portfolio/
