# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Hoisted the repository root directly to the workspace directory and removed unrelated planning files.
- Moved the Blender source file into `assets/blender/room.blend` under version control.
- Updated repository documentation, `.env.example`, and `package.json` metadata to English open-source standards.

### Added
- MIT `LICENSE`, `.editorconfig`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `SECURITY.md`.
- GitHub Actions CI workflow running unit tests, TypeScript check, Vite build, and CLI version check on `main` and `develop`.
- GitHub issue templates and pull request template.

## [0.2.2] - 2026-11-20

### Changed
- Replaced the `cloudflared` npm package postinstall hook with a runtime downloader in `server/tunnel.mjs` to avoid Windows `ENOENT` postinstall failures during global installs.
- Moved frontend and build dependencies to `devDependencies`, leaving only pure-JS `express` and `ws` in runtime `dependencies`.
- Updated global installation documentation to use the GitHub archive `.tar.gz` URL as a workaround for Windows npm 10 temporary junction behavior.

### Added
- Unit tests for platform asset resolution in `server/tunnel.test.mjs`.

## [0.2.1] - 2026-11-20

### Fixed
- Committed prebuilt `dist/` assets and removed the `prepare` build hook so global `npm install -g` succeeds without `tsc` or devDependencies present.

## [0.2.0] - 2026-11-20

### Added
- Global `3d-meet-board` CLI binary (`bin/cli.mjs`) with `start`, `setup`, and `status` subcommands.
- Persistent user config loader and validator (`server/config.mjs`) storing credentials in `~/.3d-meet-board/config.env`.
- Automatic Cloudflare HTTPS quick-tunnel startup for Discord Activity URL mappings.

## [0.1.0] - 2026-11-20

### Added
- Interactive Three.js 3D meeting room (`public/models/room.glb`) with camera presets, left member board, and right corkboard (`CorkboardManager`, `MemberBoard`, `RoomScene`).
- Sticky notes, photo uploads, and pin strings synced across clients over WebSocket and saved to disk (`server/store.mjs`, `server/index.mjs`).
- Discord Embedded App SDK integration (`src/discord.ts`) with OAuth2 token exchange endpoint (`/api/token`) and local browser preview fallback.
