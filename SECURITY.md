# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| `0.2.x` | Yes |
| `< 0.2.0` | No |

## Credential Handling

- Never commit `.env`, `.env.local`, `DISCORD_CLIENT_SECRET`, or `DISCORD_BOT_TOKEN` to the repository.
- When running the global CLI, credentials are stored outside the repository at `~/.3d-meet-board/config.env`.
- Room boards and user-uploaded photo data are stored locally on the host machine (`~/.3d-meet-board/rooms/` or `data/rooms/`) and excluded by `.gitignore`.

## Reporting a Vulnerability

Do not open public GitHub issues for security vulnerabilities or leaked tokens. Instead:

1. Report the issue privately using [GitHub Security Advisories](https://github.com/Atnan49/3d-Meet-Board/security/advisories/new).
2. Include steps to reproduce, the affected version or file path, and the potential impact.

Reports are reviewed as promptly as possible, and confirmed issues are patched in the next minor or patch release.
