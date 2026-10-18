
# opencode-browser-chat

![language: JavaScript/TypeScript](https://img.shields.io/badge/language-JS-TS-yellow?logo=javascript)   ![status: done](https://img.shields.io/badge/status-done-green)   ![license: MIT](https://img.shields.io/badge/license-MIT-blue)

## Summary

Web application in JavaScript/TypeScript. OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.

## Problem / why it exists

The project delivers a web interface or utility for a specific scope, with focus on the browser as runtime and no dependency on its own server.

## Architecture

- Presentation layer: components and pages that render the interface.
- Logic layer: functions and hooks that process data and state.
- Communication: HTTP requests to external APIs or local data, when applicable.

The build is done with Vite (or equivalent tool), generating static files ready for hosting.

## Technologies

- JavaScript / TypeScript
- (none declared in the repository)

- No CI configured in this repository.

No automated tests detected in the scan.

## What it does

OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.

## How to run

Requirements: Node.js and npm (or yarn/pnpm).

```
# install dependencies
npm install

# run in development
python main.py

# production build
npm run build

# run tests
pytest
```

## Project structure

- scripts/ (18 arquivo(s))
- extension/ (16 arquivo(s))
- server/ (2 arquivo(s))
- .gitignore, README.en.md, README.md


## Trade-offs and decisions

- Static build: easy to host (GitHub Pages, Vercel, Netlify) without a server.
- Minimal dependencies to reduce maintenance surface.
- Browser as the only runtime required.

## Known limitations

- Runs in the browser; depends on internet connection for external resources.
- No automated tests detected.


## Tests

```
pytest
```

## License

Distributed under the MIT License. See the `LICENSE` file in this repository.

## Author

Kelvin Oliveira, https://github.com/KelvinOliveiraCode
Portfolio: https://kelvinoliveiracode.github.io/portfolio/
