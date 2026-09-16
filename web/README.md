# graphcode-web

A browser UI for the GraphCode daemon, on ComfyUI's canvas library. Spec: `../CANVAS-SPEC.md`.

## Run

    make web-install      # once; needs mise (node 26, pnpm 11)
    make web-serve        # bridge on http://localhost:4747, serves web/dist (run `pnpm build` first)
    make web-dev          # Vite dev server on http://localhost:5173 with hot reload, proxied to the bridge

The bridge talks to the daemon at `GRAPHCODE_SOCKET`, else `$GRAPHCODE_SUPPORT_DIR/graphcoded.sock`,
else `~/.graphcode/graphcoded.sock`. To drive the fork's daemon: `GRAPHCODE_SUPPORT_DIR=~/.graphcode-fork pnpm serve`.

With Node 26 and pnpm 11 already on PATH, mise is optional: run `pnpm install --frozen-lockfile`,
`pnpm build`, and `pnpm serve` from `web/`.

If a package mirror lacks versions in the lockfile, a local prototype can use
`pnpm install --lockfile=false`, then `pnpm --config.lockfile=false build` and
`node server/main.ts`. This resolves compatible versions without changing the committed lockfile;
it is not a reproducible locked install. Do not commit mirror-specific download URLs.

The web canvas opens local folders only. Remote projects restored by the daemon stay open in the
Mac app but are not canvas tabs; their Recent projects entries are disabled. A rejected folder
open leaves the current canvas in place.

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

`pnpm e2e` runs the phase 0, phase 1 and phase 2 matrices against the scripted fake daemon
(screenshots in `e2e/out/`) and the read-only smoke test against the release daemon.
`e2e/phase2-matrix.spec.ts` covers phase 2's surface in 18 rows (P2-05 in five parts, one per output
kind and condition); `e2e/phase1-matrix.spec.ts` keeps the six rows that still describe the surface
phase 2 did not replace (the inspector and the create-on-drop flow are gone, so their rows went with them).

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
daemon's `NodeDraft` for the brief the user filled in. A module may also export `fromLoop(node)`
returning widget values for a loop the daemon reports, so a live card shows what it was given; a live
loop is drawn with the built-in type for its `loopType` (`agent/goal`, `agent/timed`, `agent/main`,
`agent/turn`, `group/composite`), or a user or project pack of the same name. A module that fails to
load or to validate is listed in the Nodes tab with its error. ↻ in the Nodes tab reloads the packs;
the browser fetches each module through a fresh URL, so an edited file shows on the next reload.

A project pack is code. Opening a project on the canvas imports and runs every module under its
`.graphcode/nodes/` with the page's own privileges, the way ComfyUI runs an extension, so treat a
repository's pack like any other code in that repository before opening it. A per-project consent
prompt is planned.

## Editing

The canvas is the document, the way ComfyUI's is. Drag a node type from the Nodes tab onto the
canvas and it becomes a draft card at once, with the type's fields (goal or prompt, done check,
model, backend, …). Double-click its header to name it; Enter saves and Escape cancels.
The name is optional: clear it to show the node type's name. There is no separate Title row.
Drafts show a state badge and actionable problems, not a duplicate status description. Nothing is sent. Text fields
open an editor over themselves (⌘Enter or Enter keeps the text, Escape drops it); model, backend,
interval and toggles are litegraph's own widgets. Cards drag and resize; position, size, drafts and
draft wires are saved in `<project>/.graphcode/canvas.json` (version 2). A layout saved by phase 1
(version 1) is laid out afresh the first time phase 2 opens the project; its positions were made
for cards a third as tall.

Drag from a card's output slot onto another card to draw a wire. Ports follow the node type:
Main and Timed advertise handoff, message and spawn; Goal, Turn and Composite also advertise
on success and on failure. Saved connections retain their exact kinds and conditions even when a
node pack does not advertise those ports. One output can feed several cards from the same dot;
the editor prevents adding the same connection twice. Incoming dots name their source.

Ports are actions and conditions, not states. Handoff waits for a source to finish, with optional
success/failure conditions; message delivers information without blocking readiness; spawn creates
a fresh instance of the destination template. Multiple incoming handoffs are **all required**, not
alternatives. Do not join mutually exclusive success/failure branches into one target.

Every wire is a draft until Run. **Run** in the toolbar sends `createNode` for every draft
and then `createEdge` for each wire whose ends are live, the way ComfyUI's one Queue runs the whole
graph; a draft with a problem is named and nothing is sent. A card is "starting" until the daemon
reports it, then live: its fields turn read-only (the title still renames). There are no buttons on a
card; Stop and Restart stay in the Swift app and the CLI. A goal loop runs the moment the daemon has
it; Run is the moment you choose. This create-before-connect sequence does not yet guarantee
dependency ordering for unattended agents; an edited workflow is not an execution-safety guarantee.

The Delete key removes a draft outright and asks before a live card is deleted. Dragging a wire off
its input removes a draft wire outright and asks before a live edge is deleted. litegraph's context
menus and search box are off.

## Workflows

**Save workflow…** writes every card (live ones through the type's `fromLoop`) and every wire to
`~/.graphcode/workflows/<name>.json`. The Workflows tab lists those files; clicking one loads it onto
the current project as drafts with fresh ids, to the right of what is there. Recent projects are on
the Projects tab.
