# graphcode-web

A browser UI for the GraphCode daemon, on ComfyUI's canvas library. Spec: `../CANVAS-SPEC.md`.

## Run

    make web-install      # once; needs mise (node 26, pnpm 11)
    make web-serve        # bridge on http://localhost:4747, serves web/dist (run `pnpm build` first)
    make web-dev          # Vite dev server on http://localhost:5173 with hot reload, proxied to the bridge

The bridge talks to the daemon at `GRAPHCODE_SOCKET`, else `$GRAPHCODE_SUPPORT_DIR/graphcoded.sock`,
else `~/.graphcode/graphcoded.sock`. To drive the fork's daemon: `GRAPHCODE_SUPPORT_DIR=~/.graphcode-fork pnpm serve`.

**+ creates a blank, autosaved workflow without choosing a folder.** Authoring and copy/paste work
without the daemon. Open existing project canvases from **Projects → Open folder…** or Recent projects.
Project folders are local only. Remote projects restored by the daemon stay open in the
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
- Folder-free documents live in `~/.graphcode/documents/<UUID>.json`; names and optional folders are
  metadata, not file paths. The browser remembers its open workflow tabs.

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
draft wires are autosaved in the workflow document, or `<project>/.graphcode/canvas.json` for a
project canvas (version 2). A layout saved by phase 1
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

Drag empty canvas to pan; Cmd/Ctrl+drag selects a rectangle of cards. Shift-click adds to the
selection, and Cmd/Ctrl+A selects every card. Space+drag and middle-button drag also pan; the wheel
zooms. These gestures use LiteGraph's original navigation mode.

## Workflows

The **+** tab button creates an independent document. Double-click its tab name to rename it.
Closing a workflow tab finishes its pending save; it does not delete the document or stop agents.
Reopen it in the **Workflows** sidebar. Existing project canvases remain available.

For a workflow with no folder yet, **Run** asks for a local folder, waits for the daemon to open it,
loads that folder's node packs, and then runs. Hover over Run to see the attached folder. Folder
aliases and trailing slashes resolve to the daemon's canonical path. A folder's custom packs can
change a draft's fields and behavior; unavailable types block execution.
The workflow saves its node identities before sending any commands and shows only its own agents,
not unrelated agents in the same folder. A bound workflow waits for its project to be available;
it does not turn unavailable running agents into new drafts.

Canvas writes are ordered and files replaced atomically. Metadata edits preserve concurrent canvas
saves. Invalid or unreadable documents produce errors instead of silently becoming empty workflows.

Cmd/Ctrl+C copies selected cards and only the wires between them as GraphCode workflow
JSON on the system clipboard. Cmd/Ctrl+V inserts fresh draft cards near the last canvas
pointer position and selects them. Names, custom values, sizes, relative positions, and exact wire
kinds and conditions are preserved. Live cards are copied as draft definitions; originals are never
started, renamed, or deleted. Copy/paste works between workflow/project tabs, browser tabs, and workflow JSON
in a text editor. Text fields keep their normal text selection and clipboard shortcuts.

The whole paste is refused if the JSON is malformed or a node type is unavailable. Clipboard
events use the browser's normal copy/paste path, without a cached fallback or background reads.
Pasting while a different canvas is still loading is refused instead of changing the previous canvas.

**Save template…** writes every card (live ones through the type's `fromLoop`) and every wire to
`~/.graphcode/workflows/<name>.json`. **Templates** lists those files; clicking one loads it onto
the current canvas as drafts with fresh ids, or creates a folder-free document if no canvas is open.
Like paste, loading
refuses malformed files or unavailable node types before adding any cards. Recent projects are on
the Projects tab. `e2e/clipboard-selection.spec.ts` covers selection, clipboard transfers,
text-field isolation, and navigation against temporary projects and the scripted daemon.
`e2e/workflow-documents.spec.ts` covers folder-free authoring, autosave, reopening, copying between
workflow tabs, deferred folder attachment and isolation from unrelated project agents.
