# Understand Secure Viewer

Standalone local, read-only knowledge graph viewer.

## Requirements

- An approved, prebuilt viewer release.
- A compatible Node.js runtime.
- A project containing .ua/knowledge-graph.json or the legacy
  .understand-anything/knowledge-graph.json.

## Manual launch

From an approved local viewer package:

    node bin/viewer.mjs /path/to/project --port 5173 --no-open

Open the complete URL printed in your own terminal.

Never share the access token with AI agents, logs or third parties.

## Options

- --port N: preferred local port.
- --port 0: automatically select an available port.
- --no-open: disable automatic browser opening.
- --private: request local browser opening without printing credentials.

On WSL2, manual browser access is supported and preferred when
Windows interoperability is unavailable.

## Security controls

- Loopback-only HTTP listener.
- Random 256-bit session credentials.
- Bearer authentication for protected endpoints.
- Restrictive Content Security Policy.
- Bounded file reads and project path validation.
- Automatic credential invalidation after process restart.
- No automatic dependency installation or updates.

The viewer is not an operating-system sandbox.
Do not expose it through public interfaces or reverse proxies.

## Distribution

Use only independently approved local release artifacts.
Release preparation and verification are separate from activation.
