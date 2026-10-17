# Floating OpenCode Chat

![JavaScript](https://img.shields.io/badge/language-JavaScript-F7DF1E?logo=javascript)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4)

Extension for Chromium browsers (Brave, Chrome, Edge) that puts a chat with OpenCode local models in a floating window over any page. Triggered by text selection, right-click on an image, or the Alt+Shift+O shortcut.

## Problem / Why it exists

OpenCode runs in the terminal and has no browser interface of its own. Someone reading a page who wants to explain, summarize, or change a passage must copy, switch windows, and paste into the terminal, interrupting the flow. This extension brings the OpenCode model chat into the open page.

## What it does

- Draggable floating button that opens a chat window; double-click returns the button to the corner, and Alt+Shift+O opens and closes the panel.
- Menu on text selection with ten actions: Explain, Go deeper, Summarize, Simplify, Reply to this, How to improve this, Critique, Fact check, Translate, and Arguments. Clicking an action opens the panel with the prompt already sent.
- Right-click on an image with six vision actions: Describe, Read text, Evaluate UI, Diagram, Generate prompt, and Extract data.
- Two independent models, text and vision. When an image must be seen first, it goes to the vision model, which returns a description used as context by the text model; the text model never sees the image.
- View screen button that captures the visible page (reduced to 1568 pixels, JPEG) and attaches it to the next message. The panel is hidden during capture, so the model sees the page, not the chat window.
- Letter-by-letter streaming; tool cards (read, edit, shell, search) load collapsed and open on click; reasoning appears in a collapsible block with duration when the API sends it.
- Conversation search with Ctrl+F, export in Markdown, JSON, and HTML with model, agent, and date, code block copying, and keyboard navigation (j, k, c, Esc).
- Options page for server address, port, and password, working folder, agent, models, and menu activation.

## Stack

- Manifest V3, service worker in background.js, content script in content.js with shadow DOM, and panel as extension page (panel.html, panel.js, panel.css) inside an iframe.
- Local OpenCode v2 API at http://127.0.0.1:4177, HTTP Basic authentication with fixed user opencode; streaming via SSE on /api/event.
- Pure JavaScript, no build and no external dependencies; native ES modules from the browser.
- lib/api.js: v2 API client (sessions, prompts, interruption, SSE). lib/prompts.js: menu pre-prompts and skill map. lib/markdown.js: markdown rendering. lib/skills-inject.js: injection of the skills library as internal instruction.

## How it works

```
page  ->  content script (shadow DOM)
            ├─ draggable floating button
            ├─ pre-prompt menu on text selection
            └─ pre-prompt menu on right-click on an image
                           |
                           v
      iframe panel.html (extension page)  ->  OpenCode v2 API (127.0.0.1:4177)
                                              via SSE /api/event
```

The content script runs in the page context, so the panel lives in a cross-origin iframe to access chrome.storage and not suffer from site CSS. The bridge between them uses a nonce per load (?oc= on the iframe URL), because the origin the panel sees is the site's, not the extension's.

SSE stays on the panel page: the Manifest V3 service worker is unloaded by Chrome and would drop the live event stream.

Screen capture (view screen) is only possible in the service worker, which has chrome.tabs.captureVisibleTab. The panel requests capture via postMessage, the worker photographs the active tab, reduces it to 1568 pixels, and returns it as a data URL.

Before the first message of each session, the panel sends an internal instruction marked [CONFIG_OC]...[/CONFIG_OC] asking the model to read the skills router at C:\Users\Kelvin\Desktop\minhas-skills-unificadas\SKILL.md. The block is removed before rendering; the user only sees their own message.

## How to run

Prerequisite: have OpenCode CLI installed.

1. Start the local server:

powershell -ExecutionPolicy Bypass -File server\start.ps1

The server starts at http://127.0.0.1:4177 with password testefixo123. To stop: server\stop.ps1.

2. Load the extension in the browser:

- Open brave://extensions (or chrome://extensions).
- Enable Developer mode.
- Click Load unpacked and select exactly the extension folder (not the project root; only it contains manifest.json).
- The scripts\abrir-pasta.ps1 shortcut opens that folder ready.

3. Open brave://extensions -> Extension options and confirm server address, port, password, and working folder.

4. Click the floating button (right corner of the page) or press Alt+Shift+O to open the chat.

The password must match the server's. If you change it, adjust in server\start.ps1 -Password ... and on the options page.

## Project structure

extension/
  manifest.json            Manifest V3 manifest
  background.js            service worker (screen capture, images, context menu, shortcuts)
  content.js               floating button and menus in page shadow DOM
  content.css              button, panel, menus, and resize grip styles
  panel.html / panel.js / panel.css   chat window (extension page in iframe)
  options.html / options.js           server and behavior settings
  lib/api.js               OpenCode v2 API client
  lib/prompts.js           menu pre-prompts and skill map
  lib/markdown.js          markdown rendering
  lib/skills-inject.js     skills library injection on first message
  icons/                   16, 32, 48, and 128 pixel icons
server/
  start.ps1  stop.ps1  restart.ps1   starts, stops, and restarts the local server
scripts/
  *.mjs                    browser and API contract tests (require the server running)
shots/                     interface screenshots

## Trade-offs and decisions

- Panel as extension page inside an iframe: the SSE stream survives service worker unloading and site CSS does not enter the chat. The price is postMessage communication between different contexts.
- Nonce-authenticated bridge, not origin: the content script runs in page context, so the origin seen by the panel is the site's. The nonce (?oc=) is what validates the channel; a strange page cannot inject commands into the panel.
- Capture only in the service worker: chrome.tabs.captureVisibleTab is not available in the content script.
- Separate vision model: the temporary image description session is deleted afterwards, so it does not pollute history with describe-this turn pairs.
- No build and no dependencies: anyone can inspect the files and load the folder directly in developer mode.
- Clicking the floating button always starts a new session; an old session is continued only by choosing it in the selector.

## Known limitations

- Requires the OpenCode server running locally (http://127.0.0.1:4177). Without server, the panel shows server offline.
- The first message of a new session may receive HTTP 500 (server cold start: plugins and model still loading). The extension retries once; if it fails again, the server may need more time.
- View screen requires the panel tab to be focused and the browser window focused; otherwise the extension warns instead of hanging.
- Cross-origin remote images without CORS may fail capture. Open the image in a tab and try again, or use view screen.
- Two panel instances open at the same time are not supported; the SSE stream is unique.
- Changing password, port, or working folder in options applies to new tabs; already open tabs must be reloaded for the button to appear.
- The first time, no message is sent until a model is chosen.
- Skills library paths are fixed at C:\Users\Kelvin\Desktop\minhas-skills-unificadas\SKILL.md; injection is automatic and does not appear in the interface.

## License

There is no LICENSE file in the repository. The code belongs to the author; contact before copying or reusing.

## Author

Kelvin
