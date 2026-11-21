# Contributing to 3D Meet Board

Thank you for helping improve 3D Meet Board. This document outlines the branch workflow, coding standards, and verification steps for contributors.

## Branching Workflow

- `main`: stable release history tagged by version (`vX.Y.Z`).
- `develop`: integration branch where completed work lands first.
- Working branches (`feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`): branch from `develop` and open pull requests back into `develop` using `--no-ff` merges to keep feature context intact.

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(scope): add feature description`
- `fix(scope): resolve specific bug`
- `docs: update documentation`
- `chore(repo): maintain tooling or metadata`

## Local Verification

Install dependencies and run all checks before committing:

```bash
npm install
npm test
npm run build
node bin/cli.mjs --version
```

### Important Note on `dist/` and 3D Assets

- Global CLI installs from GitHub pull prebuilt assets directly from `dist/` without executing a build step on the user's machine. If you modify files under `src/`, `public/`, or `index.html`, run `npm run build` and commit the updated `dist/` artifacts.
- Keep `assets/blender/room.blend` updated alongside any re-exported `public/models/room.glb`.
- Never commit `.env`, `~/.3d-meet-board/config.env`, Discord Client Secrets, or Discord Bot Tokens.
