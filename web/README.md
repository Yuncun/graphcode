# graphcode-web

A browser UI for the GraphCode daemon, on ComfyUI's canvas library. Spec: `../CANVAS-SPEC.md`.

## Run

    make web-install      # once; needs mise (node 26, pnpm 11)
    make web-serve        # bridge on http://localhost:4747, serves web/dist (run `pnpm build` first)
    make web-dev          # Vite dev server on http://localhost:5173 with hot reload, proxied to the bridge

The bridge talks to the daemon at `GRAPHCODE_SOCKET`, else `$GRAPHCODE_SUPPORT_DIR/graphcoded.sock`,
else `~/.graphcode/graphcoded.sock`. To drive the fork's daemon: `GRAPHCODE_SUPPORT_DIR=~/.graphcode-fork pnpm serve`.

## Access

The bridge binds to 127.0.0.1 only, so nothing off this machine can reach it. A WebSocket is
exempt from the browser's same-origin policy, so the handshake is checked too: it is accepted
only with no `Origin` header at all (a non-browser client, such as a test) or an `Origin` of the
bridge's own page or the Vite dev server, and only with a `Host` of `localhost` or `127.0.0.1`
at the bridge's port. A relay socket can send the daemon any command it likes, so before the
bridge is ever bound to anything but the loopback address it will need a token in the URL as
well.

## Test

    make web-test         # unit tests (vitest)
    cd web && pnpm e2e    # playwright smoke test; needs a running daemon with /Users/ericshen/Claude/twodrive

## Layout

- `server/` bridge: websocket relay of the daemon's own JSON frames, `/api/canvas` for positions, static files
- `app/` Vue app: `daemon/` (types, connection, store), `canvas/` (litegraph adapter, card node, placement), `tabs/`
- Positions live in `<project>/.graphcode/canvas.json`
