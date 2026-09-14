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

`pnpm e2e` runs the phase 0 and phase 1 matrices against the scripted fake daemon (screenshots in
`e2e/out/`) and the read-only smoke test against the release daemon.

## Layout

- `server/` bridge: websocket relay of the daemon's own JSON frames, `/api/canvas` for positions, static files
- `app/` Vue app: `daemon/` (types, connection, store), `canvas/` (litegraph adapter, card node, placement), `tabs/`
- Positions live in `<project>/.graphcode/canvas.json`

## Node packs

A node type is one ES module at `<pack>/<name>.js`; its type name is that path. The bridge looks in
three places, and a later one wins the same name:

1. `web/nodes/` in the repo (built-in: `agent/goal`, `agent/timed`, `agent/main`, `agent/turn`, `group/composite`)
2. `~/.graphcode/nodes/`
3. `<project>/.graphcode/nodes/`

The module's default export carries `title`, `category`, optional `description`, `inputs`, `outputs`,
`widgets` (`text`, `combo`, `number`, `toggle`) and `toDraft(values)`, which returns the fields of the
daemon's `NodeDraft` for the brief the user filled in. A module that fails to load or to validate is
listed in the Nodes tab with its error. ↻ in the Nodes tab reloads the packs; the browser fetches each
module through a fresh URL, so an edited file shows on the next reload.

## Editing

Drag a node type onto the canvas, fill in the brief in the inspector and press Create; only then is
`createNode` sent (a goal loop starts on creation). Drag from a card's output slot (handoff, on
success, on failure, message, spawn) onto another card to create that edge. Select a card to see its
brief and edges; the inspector holds Rename, Stop, Restart, Detach from template, Delete and a delete
per edge. litegraph's own context menus and search box are off in this phase.
