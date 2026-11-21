# 3D Meet Board

[![CI](https://github.com/Atnan49/3d-Meet-Board/actions/workflows/ci.yml/badge.svg)](https://github.com/Atnan49/3d-Meet-Board/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Atnan49/3d-Meet-Board)](https://github.com/Atnan49/3d-Meet-Board/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](./package.json)

A self-hosted 3D meeting room and corkboard collaboration space built for Discord Activities with Three.js, Discord Embedded App SDK, Express, and WebSockets. Your machine runs the local server directly and exposes it to Discord through a free Cloudflare HTTPS quick tunnel, removing the need for a dedicated VPS.

## Features

- Interactive 3D room exported from Blender (`public/models/room.glb`) with orbit/zoom camera controls and quick camera view buttons (`Ruangan`, `Papan Kanan`, `Papan Kiri`).
- Real-time 3D peer cursors displaying each connected participant's pointer movement and name.
- Automatic left member board showing active participants in the room, with optional full-guild member roster loading when `DISCORD_BOT_TOKEN` is configured.
- Shared right corkboard supporting sticky notes, photo uploads, and pin strings synced over WebSocket and saved to disk (`~/.3d-meet-board/rooms/` via CLI, or `data/rooms/` via `npm start`).

## Prerequisites

- Node.js 18 or newer
- A Discord Application from the [Discord Developer Portal](https://discord.com/developers/applications) if launching inside a Discord channel (local browser preview works without Discord credentials)

## Quick Start (Global CLI)

Install the CLI globally from the main GitHub tarball:

```bash
npm install -g https://github.com/Atnan49/3d-Meet-Board/archive/refs/heads/main.tar.gz
```

> Note for Windows npm 10 users: install using the direct `.tar.gz` URL above instead of `github:Atnan49/3d-Meet-Board` to avoid npm's temporary junction bug on Windows until the package is published to npm.

Run the one-time interactive Discord setup wizard:

```bash
3d-meet-board setup
```

The wizard guides you through saving:
- `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` from **OAuth2** in your Discord Application (leave blank for local preview mode)
- `DISCORD_BOT_TOKEN` (optional, for listing all server members on the left board; requires **Server Members Intent** enabled under **Bot**)

Start the local server and automatic Cloudflare HTTPS tunnel:

```bash
3d-meet-board
```

Copy the printed `https://...trycloudflare.com` URL into **Activities -> URL Mappings (`/`)** inside the Discord Developer Portal. Verify that **Activities -> Enable Activities** is turned on and `https://127.0.0.1` is listed under **OAuth2 -> Redirects**, then launch the Activity inside any voice or text channel in your server.

*Platform note: Discord requires creating the Application, retrieving its Client Secret, and setting URL Mappings manually inside the Developer Portal.*

*PowerShell note: in Windows PowerShell, run commands via CMD or prefix flags with `&` (for example `& 3d-meet-board --version`).*

## CLI Reference

| Command | Description |
| --- | --- |
| `3d-meet-board` | Start the local server and automatic Cloudflare HTTPS tunnel (prompts setup on first run) |
| `3d-meet-board start` | Explicitly start the server and HTTPS tunnel |
| `3d-meet-board start --no-tunnel` | Start the local server without spawning a Cloudflare tunnel |
| `3d-meet-board start --port <port>` | Override the HTTP/WebSocket port (default `3000`) |
| `3d-meet-board start --no-open` | Do not automatically open the browser in local preview mode |
| `3d-meet-board start --no-setup` | Skip the interactive first-run setup prompt |
| `3d-meet-board setup` | Re-run the Discord credentials configuration wizard |
| `3d-meet-board status` | Print config file path (`~/.3d-meet-board/config.env`), room data folder, and Discord links |
| `3d-meet-board --version` | Print the installed CLI version |
| `3d-meet-board --help` | Print CLI usage instructions |

## Project Structure

```text
.
├── .github/
│   ├── ISSUE_TEMPLATE/     # Bug report and feature request forms
│   ├── workflows/          # GitHub Actions CI workflow
│   └── pull_request_template.md
├── assets/
│   └── blender/
│       └── room.blend      # Canonical Blender 3D room source scene
├── bin/
│   └── cli.mjs             # Global CLI entrypoint (start, setup, status)
├── dist/                   # Prebuilt frontend bundle shipped for global installs
├── public/
│   └── models/
│       └── room.glb        # Exported GLB room model loaded by Three.js
├── server/
│   ├── config.mjs          # Environment and ~/.3d-meet-board/config.env loader
│   ├── index.mjs           # Express API, Discord OAuth proxy, WebSocket server
│   ├── store.mjs           # Room persistence and input validation
│   ├── tunnel.mjs          # Runtime Cloudflare quick-tunnel downloader and runner
│   └── *.test.mjs          # Node.js built-in test runner suites
└── src/
    ├── scene/              # Three.js room, member board, corkboard, procedural textures
    ├── discord.ts          # Discord Embedded App SDK bootstrap and auth
    ├── main.ts             # Application loop, HUD controls, 3D cursors
    ├── styles.css          # UI overlay styles
    ├── sync.ts             # WebSocket client synchronization
    └── types.ts            # Shared TypeScript interfaces
```

## Local Development

Clone the repository and run checks locally:

```bash
git clone https://github.com/Atnan49/3d-Meet-Board.git
cd 3d-Meet-Board
npm install
npm test
npm run build
npm start
```

For hot-reload development, run the backend and Vite dev server in two terminals:

```bash
npm run dev:server
npm run dev:client
```

When editing the 3D environment in `assets/blender/room.blend`, export the updated model to `public/models/room.glb` and rebuild `dist/` with `npm run build`.

## Documentation

- [Contributing Guide](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Security Policy](./SECURITY.md)

## License

Released under the [MIT License](./LICENSE).
