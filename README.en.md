# opencode-browser-chat

**English** · [Português (Brasil)](README.md)

A browser extension (Manifest V3) that puts an OpenCode chat inside any tab, with a pre-prompt menu when you select text or an image, a screenshot attachment option, and your own skills as context.

## What it is

A Chromium extension (Brave or Chrome) that talks to a local OpenCode server. The chat lives in a floating panel over the page, and that same panel handles free-form questions, turning selected text into a prompt, and sending an image (file, paste, or capture of the visible tab) to the model.

The project runs no server of its own: the local `opencode serve` process on port 4177 answers every request. The extension is an HTTP client and a consumer of that server's SSE stream.

## Status

It works end to end in a development environment with the OpenCode server on `127.0.0.1:4177`. The manifest declares version 1.0.0 and `minimum_chrome_version` 116 (`extension/manifest.json`).

There is no CI pipeline, no license file in the repository, no store packaging, and no `package.json`: dependencies are zero and every script is run by hand with Node.

## Features

A draggable floating bubble, with position saved in `chrome.storage.local`; a double click sends it back to the corner (`extension/content.js`).

An iframe panel with dragging handled inside the iframe itself, resizing from the corner grip, and the rectangle persisted (`extension/content.js`, `extension/panel.js`).

A pre-prompt menu on text selection, with ten entries: explain, go deeper, summarize, simplify, answer this, how to improve this, critique, fact-check, translate, and arguments (`extension/lib/prompts.js`).

An image context menu, with six entries: describe, read text, review UI, diagram, generate prompt, and extract data (`extension/lib/prompts.js`).

Attachments by drag and drop (up to four images), paste from the clipboard, and a capture of the visible tab through `chrome.tabs.captureVisibleTab` (`extension/panel.js`, `extension/background.js`).

Vision cascade: when the text model cannot see images, a second model describes the image in a separate session and that description enters the prompt as context (`extension/panel.js`).

Live streaming over SSE: text deltas, reasoning, tools opening, activity shown as three bouncing dots, token counts, and a stop button (`extension/panel.js`).

Collapsible tool cards, with the real diff when the API sends `metadata.diff` and a reconstructed diff when it does not (`extension/panel.js`).

An in-house markdown renderer for messages, covering code blocks, tables, lists, blockquotes, rules, and links (`extension/panel.js`).

Sessions: list, create, open, pin in the picker, and delete. The list skips subagent sessions (`extension/lib/api.js`).

Model and variant (effort) selection from the panel, persisted in `cfg` and applied to the current session (`extension/panel.js`).

A separate options page for host, port, password, directory, text model, vision model, and behavior (`extension/options.js`).

The skill router is injected as text into the first message of each session, wrapped in `[CONFIG_OC]` and stripped from the interface (`extension/lib/skills-inject.js`).

`Alt+Shift+O`, a context menu item, and a click on the icon open or close the panel (`extension/manifest.json`, `extension/background.js`).

## Architecture

Three layers, no build step and no framework.

The content script (`extension/content.js`) runs on every page, builds everything inside a shadow DOM, and creates three things: the bubble, the panel iframe, and the pre-prompt menu. It knows nothing about OpenCode and makes no HTTP calls.

The panel (`extension/panel.html`, `extension/panel.js`) is an extension page loaded in the iframe. It holds the SSE connection, the conversation history, and the streaming state.

The service worker (`extension/background.js`) keeps no OpenCode connection. It exists as a bridge for what only a worker can do: downloading a remote image, capturing the visible tab, building context menus, and handling the shortcut and the icon click.

Communication between content script and panel goes through `postMessage`, using `oc:ready`, `oc:ask`, `oc:fresh`, `oc:toggle`, `oc:geometry`, `oc:dragStart`, `oc:dragMove`, `oc:dragEnd`, `oc:capture`, `oc:captured`, and `oc:toast`.

Inside the panel, three modules:

`extension/lib/api.js` is the OpenCode v2 API client, with Basic authentication (fixed user `opencode`), per-request timeouts, and the SSE stream from `/api/event`.

`extension/lib/prompts.js` is a classic script, not a module, because MV3 content scripts do not support `import`. It publishes `globalThis.OC_PROMPTS` and is loaded by the content script, by the panel, and by the options page.

`extension/lib/skills-inject.js` builds the router instruction, detects the marker, and returns the clean text for the interface.

## Stack

Browser: Manifest V3, service worker, `chrome.storage.local`, `chrome.contextMenus`, `chrome.commands`, `chrome.tabs.captureVisibleTab`.

Language: HTML, CSS, and JavaScript with no transpilation. ES modules in the panel, classic script in the content script.

Server: OpenCode CLI (`opencode serve`), port 4177, Basic authentication.

Supporting tooling: PowerShell scripts to start and stop the server, create the startup shortcut, and open the extension folder; Node scripts (`.mjs`) for tests and diagnostics.

## Repository layout

```text
opencode-browser-chat/
  extension/
    manifest.json
    background.js
    content.js
    content.css
    panel.html
    panel.js
    panel.css
    options.html
    options.js
    lib/
      api.js
      prompts.js
      skills-inject.js
    icons/
      icon16.png  icon32.png  icon48.png  icon128.png
  server/
    start.ps1
    stop.ps1
  scripts/
    browser-test.mjs
    capture-test.mjs
    e2e-test.mjs
    load-check.mjs
    make-icons.mjs
    model-default-test.mjs
    new-features-test.mjs
    options-model-test.mjs
    parts-render-test.mjs
    send-repro.mjs
    shot-panel.mjs
    skills-inject-test.mjs
    toolcard-test.mjs
    ui-test.mjs
    vision-cascade-test.mjs
    visual-test.mjs
    abrir-pasta.ps1
    install-startup.ps1
  README.md
  README.en.md
  .gitignore
```

## Requirements and install

Windows with PowerShell 5.1 or 7, Node 22 or newer (the scripts use Node's global `WebSocket`, with no import), and Brave or Chrome version 116 or newer.

The OpenCode binary must be reachable. `server\start.ps1` looks in this order: `%APPDATA%\npm\node_modules\@opencode\cli\bin\opencode.exe`, `%LOCALAPPDATA%\opencode\bin\opencode.exe`, and the `opencode` command on PATH, provided it points to an `.exe` (`server/start.ps1`).

There is no `npm install` to run: the repository has no `package.json` and no dependencies.

```bash
git clone https://github.com/KelvinOliveiraCode/opencode-browser-chat.git
cd opencode-browser-chat
```

## How to run

Start the local server. It is idempotent: if the port is already taken, it exits without doing anything.

```powershell
powershell -ExecutionPolicy Bypass -File server\start.ps1
powershell -ExecutionPolicy Bypass -File server\start.ps1 -Port 4177 -Password myPassword
```

Stop the server:

```powershell
powershell -ExecutionPolicy Bypass -File server\stop.ps1
```

Create the Windows startup shortcut (and remove it with `-Remove`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
```

Load the extension at `brave://extensions` with developer mode on, using "Load unpacked" and pointing at the `extension` folder. The script `scripts\abrir-pasta.ps1` opens Explorer with `manifest.json` already selected, so there is no doubt about which folder to pick.

On first install, the extension opens the options page. Check host, port, password, and working directory, then click "Test connection". The password must match the one used in `OPENCODE_SERVER_PASSWORD` when starting the server.

## Endpoints (if there is an API)

This repository exposes no HTTP API. It consumes the OpenCode server v2 API with Basic authentication in the form `opencode:<password>` (`extension/lib/api.js`).

| Method | Route | Use in this project |
|---|---|---|
| GET | `/api/location` | ping and connection test |
| GET | `/api/model?directory=` | model catalog, with an explicit directory |
| GET | `/api/agent` | agent list |
| GET | `/api/skill` | skill list |
| GET | `/api/session` | list of top-level sessions, with `directory`, `limit`, `order`, `search`, and `cursor` |
| POST | `/api/session` | create session |
| GET | `/api/session/{id}` | read one session |
| DELETE | `/api/session/{id}` | delete one session |
| GET | `/api/session/{id}/message` | history, with `limit` and `order` |
| POST | `/api/session/{id}/prompt` | send a message, with `text`, `files`, `agents`, and `delivery` |
| POST | `/api/session/{id}/interrupt` | interrupt execution |
| POST | `/api/session/{id}/model` | change the session model |
| POST | `/api/session/{id}/agent` | change the session agent, implemented and unused by the interface |
| GET | `/api/event` | SSE stream of session events |

Stream events handled by the panel: `session.inbox.enqueued`, `session.text.started`, `session.text.delta`, `session.text.ended`, `session.tool.input.started`, `session.tool.input.ended`, `session.tool.called`, `session.tool.success`, `session.tool.failed`, `session.reasoning.started`, `session.step.started`, `session.execution.started`, `session.execution.succeeded`, `session.step.failed`, `session.retry.scheduled`, `session.renamed`, `session.usage.updated`, `session.permission.asked`, and `question.asked`.

## Tests and quality

There is no linter, no formatter, no `package.json`, and no CI. Verification happens through Node scripts run by hand.

Sixteen `.mjs` files live in `scripts/`. Twelve use the `add(name, condition, extra)` helper and `e2e-test.mjs` uses `check(name, condition, extra)`; together that is 157 `add()` calls and 22 `check()` calls, with alternative branches that reduce the number actually executed per run.

| Script | What it verifies |
|---|---|
| `scripts/e2e-test.mjs` | 22 checks against the real server: auth, catalog, session, SSE, an image turn, skills, and history |
| `scripts/browser-test.mjs` | loads the extension in Brave over CDP and checks the bubble, menu, panel, status, and session list |
| `scripts/capture-test.mjs` | the tab capture does not include the panel; the button starts a new session and the picker keeps one |
| `scripts/model-default-test.mjs` | the model is requested on first open and reused afterwards |
| `scripts/new-features-test.mjs` | dragging does not stick to the mouse, the "view screen" button, and the router injection staying out of the conversation |
| `scripts/options-model-test.mjs` | the options page lists models, lets you choose, change effort, and save |
| `scripts/parts-render-test.mjs` | rendering of `write`, `edit`, and `bash` with real API data |
| `scripts/send-repro.mjs` | sending through the real extension path, reading what shows up on screen |
| `scripts/skills-inject-test.mjs` | `isInternal`, `stripInternal`, and `withInstruction` |
| `scripts/toolcard-test.mjs` | cards start collapsed and open on click |
| `scripts/ui-test.mjs` | the injection does not appear in the conversation, tool cards, and activity dots |
| `scripts/vision-cascade-test.mjs` | the image goes through the vision model and the description reaches the text model |
| `scripts/visual-test.mjs` | the full visual flow, with screenshots of the menu and the panel |
| `scripts/load-check.mjs` | diagnostic: loads in Brave and reports the manifest being accepted plus JavaScript errors |
| `scripts/shot-panel.mjs` | screenshot of the panel opened as a tab |
| `scripts/make-icons.mjs` | generates the icon PNGs, with no dependencies |

The only script that runs without a server and without a browser is `scripts/skills-inject-test.mjs`:

```bash
node scripts/skills-inject-test.mjs
```

All the others need the server running and Brave at the fixed path `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` (`scripts/browser-test.mjs`).

```bash
node scripts/e2e-test.mjs
node scripts/browser-test.mjs
node scripts/ui-test.mjs
```

## Technical decisions and trade-offs

The panel is an extension page inside an iframe, not injected DOM. It gains CSS isolation and access to `chrome.storage`; it pays with the `postMessage` bridge for dragging, geometry, and capture (`extension/content.js`).

The SSE is held by the panel, not by the service worker. The worker gets unloaded by the browser, and the extension would lose the stream mid-conversation (`extension/background.js`).

The session list filters `parentID` inside the request loop, before cutting at `limit`. Filtering only on the client would return a window full of subagent sessions and none of the conversations the person actually opened (`extension/lib/api.js`).

The directory is always explicit in `/api/model`. Without it, the server tries to resolve the default location and answers 503 (`extension/lib/api.js`).

Authentication is Basic with the fixed user `opencode`. That is the server contract, not a design choice of the extension (`extension/lib/api.js`).

The skill is not chosen in the interface. The first message of each session receives the router instruction as text, wrapped between `[CONFIG_OC]` and `[/CONFIG_OC]`, and the panel hides that block (`extension/lib/skills-inject.js`).

The tool name comes from `session.tool.input.started`, because `session.tool.called` carries no name. The two events are matched by `id` (`extension/panel.js`).

The vision cascade runs in a temporary session, deleted at the end. If the description came back in the person's own session, the history would keep a "describe this" turn pair in the middle of the conversation (`extension/panel.js`).

Markdown is hand-written instead of using an external library. It keeps the extension dependency-free, and the cost is partial coverage: nested lists, table alignment, and nested blocks are not handled (`extension/panel.js`).

## Known limitations

The reference environment is Windows. The server scripts are PowerShell, and the Brave path is hard-coded in `scripts/browser-test.mjs` and the other browser tests.

Defaults come from the author: directory `C:\Users\Kelvin\Desktop` and password `testefixo123` (`extension/panel.js`, `extension/options.js`, `server/start.ps1`). The skill router points at `C:\Users\Kelvin\Desktop\minhas-skills-unificadas\SKILL.md` (`extension/lib/skills-inject.js`), a path that must exist on the machine.

A remote server is not supported. The options page itself says not to use a remote host (`extension/options.html`), and the manifest requests `http://127.0.0.1/*` and `http://localhost/*`.

The manifest requests `<all_urls>` in `host_permissions` and `scripting`, and the content script runs on every page.

Tab capture requires a focused window. Without focus, `captureVisibleTab` never rejects, so the code uses a 10 second deadline to unlock the button (`extension/content.js`).

The vision cascade waits by polling the history, up to 60 attempts of 2.5 seconds, and fails if the vision model does not answer in that window (`extension/panel.js`).

Images are scaled down to at most 1568 pixels on the longest edge before going to the model. GIF and SVG pass through without resizing (`extension/background.js`).

The text selection sent to the model is cut at 6000 characters (`extension/content.js`).

The SSE stream is single and global. Events from another session are ignored by the `sessionID` check (`extension/panel.js`).

There is no license file in the repository, even though the project is declared MIT.

## License and author

MIT. Copyright (c) 2026 Kelvin Rebelo de Oliveira. Author: [Kelvin Oliveira](https://github.com/KelvinOliveiraCode)