# GraphCode canvas fork: product spec

Written 2026-09-13, approved by Eric the same day ("I'll take your recommendation"). Supersedes CANVAS-PLAN.md. Research reports behind every number are in the
session scratchpad under `research/` (graphcode-ui-map.md, comfyui-frontend-map.md,
shell-terminal-bridge.md). Findings that motivated this: UX-FINDINGS.md rows 4, 11, 17, 19, 21.

## 1. What we are building, in one paragraph

A web UI for GraphCode's existing engine, shaped like ComfyUI: a pan-and-zoom node canvas, a left bar
with Nodes, Workflows and Templates tabs, one tab per open project across the top, and a bottom panel
holding the selected node's live terminal. Node types are JavaScript files. The daemon, the kit, the
CLI, zmx sessions, the Mailroom and the template files are untouched. The Swift app keeps working
beside the new UI, because both are clients of the same daemon socket.

## 2. What the investigation established

### GraphCode side

| Fact | Consequence |
|---|---|
| The daemon owns the whole graph (nodes, edges, state). The app is a socket client, like the CLI. | A web client sees the same graph with no migration. |
| The app stores no node positions. Layout is recomputed from edges on every broadcast, capped at 4 columns, rows in arrival order (LaneLayout.swift:34, :95). No gesture moves a card. | Free placement is a new capability, not a port. Positions need a home (section 5). |
| Edges have no ports and no data type. An edge's kind (handoff, message, spawn) and condition (always, onSuccess, onFailure) describe a relationship. | Typed slots on the canvas must map onto kind plus condition (section 6). No engine change needed. |
| A loop's terminal is a zmx session named `graphcode-<node-uuid>`; zmx allows several clients on one session. | A web terminal can attach beside the Swift app with `zmx attach`. |
| Only the Swift app can start an attended loop's session (main and turn types); the argv assembly lives in GhosttyTerminalView.swift:306 and is duplicated with the daemon's launcher. | Version 1 creates only daemon-started loops (goal, timed). Attended loops need one new daemon command (phase 3). |
| Worktree creation, cloning, title suggestion and notifications are app-only, not daemon commands. | Version 1 creates loops on the current branch; worktrees stay in the Swift app and the CLI until phase 3. |
| Templates are markdown files with front matter in `~/.graphcode/templates` and `<project>/.graphcode/templates`; the kit owns the format. Settings are `~/.graphcode/settings.json`. | The web UI reads the same files. Nothing to migrate. |

### ComfyUI side

| Fact | Consequence |
|---|---|
| The canvas library was merged into the frontend repo in August 2025. The subtree (42k lines) imports Vue and 12 Pinia stores at 246 sites, and an ADR says this coupling will deepen. | "Use ComfyUI's graph as a library" is closed on current main. |
| The last standalone package, `@comfyorg/litegraph` 0.17.2, is 27.6k lines of TypeScript, MIT, zero runtime dependencies, zero Vue or store imports, with pan and zoom, links, widgets, groups, subgraphs, reroutes, context menus and a built-in node search box. It is deprecated, meaning frozen, not broken. | This is ComfyUI's actual canvas as of August 2025, usable on its own. Pin it or vendor it. |
| The frontend is 342k production lines plus 419k lines of tests. 40% removes cleanly; the other 60% needs file-by-file surgery, and `app.ts` (2.7k lines, 123 imports) crosses every cut. Firebase initialises unconditionally at boot. | A fork-and-strip would be the largest thing in the repo and the least understood. |
| Booting the stock frontend to an empty canvas needs 7 server calls: `/features`, `/users`, `/settings`, `/userdata`, `/extensions`, `/object_info`, and the `/ws` socket. Execution is always server side; JavaScript in ComfyUI defines appearance and widgets, never behaviour. | A fake ComfyUI server is feasible but would carry one-shot queue semantics and image-generation UI that has to be hidden. |
| The node library tab, workflows tab and workflow tabs are generic and small (about 3.5k lines together), but each pulls in the settings store, dialogs, toasts, PrimeVue and i18n. | Rebuilding these three in our own shell is a few hundred lines each. |
| ComfyUI's bottom-panel "Terminal" is a read-only log tail; the interactive one exists only in the Electron desktop app over IPC. | Nothing to copy for the terminal transport. xterm.js plus a pty over a websocket is the standard pattern (ttyd, wetty). |
| "Vue nodes" mode renders nodes as Vue components; it is experimental and off by default for self-hosted installs. | Not needed. The terminal lives in a panel, not inside the node body, which is also how GraphCode works today. |

## 3. Options considered

| Option | Web UI | Bridge | What is free | What it costs | Verdict |
|---|---|---|---|---|---|
| 1. Stock ComfyUI frontend plus a server that speaks its contract | ComfyUI_frontend, pinned release, unmodified; a GraphCode extension pack hides image-gen tabs and adds a terminal tab | Implements 7 boot endpoints, translates `/prompt` into daemon commands, mirrors loop state as execution events, pty websocket | Every ComfyUI component | 342k inherited lines, a fake image-generation server to maintain, Run/Queue semantics that do not match live loops, Firebase in the boot path, terminal only as one global panel | Fastest demo, worst fit for "cleanly understood and maintained" |
| 2. Fork ComfyUI_frontend and strip | Our fork of 342k lines, 137k removed cleanly, the rest cut by hand | Same as option 1 | The same components, editable | The biggest codebase in the repo, 419k lines of tests to keep or drop, no upstream to track once forked, `app.ts` touched everywhere | Rejected |
| 3. New small web app on the standalone ComfyUI canvas (recommended) | Our Vue 3 shell (project tabs, left bar, inspector, bottom panel) around `@comfyorg/litegraph` 0.17.2 | A relay: daemon socket to websocket, static files, pty per node, node registry, layout files | ComfyUI's canvas, interactions, widgets, search box, context menus, JSON format | We write the shell (about 3 to 4k lines), the bridge (about 1k) and the node packs | Chosen |
| 4. Keep the Swift app, embed only the canvas in a WKWebView | Swift sidebar and workspace, web canvas | Swift message handlers | Ghostty terminal, existing sidebar | Two UI stacks; dragging from a Swift sidebar into a web canvas is awkward; the left bar cannot become ComfyUI's | Rejected |

## 4. Architecture (option 3)

Three processes, one language per process, no shared state except the daemon's graph and files
already on disk.

```
browser  ──http/ws──  graphcode-web (Node 26)  ──unix socket──  graphcoded (Swift, unchanged)
                            │
                            ├── pty: zmx attach graphcode-<uuid>   (one per open terminal)
                            ├── reads ~/.graphcode/nodes/*.js       (node types)
                            ├── reads ~/.graphcode/templates/*.md   (templates, kit format)
                            └── reads/writes <project>/.graphcode/canvas.json (positions)
```

### Canvas library choice

Four candidates were measured. The decisive constraint is that our node bodies are canvas-drawn cards
(title, state pill, live line), with the terminal in a panel, so a DOM-first graph library is not
required and ComfyUI's feel is kept.

| Candidate | Lines to own | Language and deps | Has | Lacks | Verdict |
|---|---|---|---|---|---|
| `@comfyorg/litegraph` 0.17.2, archived Aug 2025 | 27.6k, or none if consumed from npm | TypeScript, zero runtime deps, zero Vue or store imports | ComfyUI's canvas as shipped for a year: pan, zoom, links, box select, groups, subgraphs, reroutes, widgets, context menus, built-in search box, JSON serialisation | upstream releases; DOM node bodies | **Chosen.** Frozen is acceptable for a canvas we do not intend to change. |
| Original `jagenjo/litegraph.js` 0.7.18 | 14.4k in one ES5 file | plain JS, hand-written `.d.ts`, zero deps | search box, context menus, working client-side `onExecute` | subgraphs, reroutes, modern types; dormant since 2024 with 146 open issues | Cheaper but older; client-side execution is not wanted since the daemon must run nodes to survive restarts |
| Vendored subtree in today's ComfyUI frontend | ~54k across 227 files after copying its closure | TypeScript plus Pinia, Yjs (CRDT for positions), vue reactivity | newest canvas, Vue-nodes hooks | a package boundary; 45 store methods to reimplement; changes weekly | Rejected |
| A DOM-first library (Vue Flow, used by n8n) | small | Vue, maintained | nodes as Vue components, so a terminal inside a node is trivial | ComfyUI's interactions, search box, widgets, context menus; we would rebuild them | Fallback if we ever want rich DOM node bodies |

### Web app (`web/` in the fork)

| Block | Source | Size | Notes |
|---|---|---|---|
| Canvas | `@comfyorg/litegraph` 0.17.2, pinned in package.json; vendor into `web/vendor/litegraph` only when we need a patch | 27.6k (not ours) | Pan, zoom, links, widgets, groups, box select, context menus, search box, serialisation |
| Node adapter | ours | ~400 | Registers each node type from the registry as an LGraphNode subclass; maps slots to edges; draws state badge and live line from the daemon's node |
| Project tabs | ours | ~200 | One tab per open project from `restoreOpenProjects`; active tab holds a canvas |
| Left bar | ours | ~700 | Nodes (tree by category, drag to canvas), Workflows (recent projects, open folder by path, saved graphs), Templates (kit template files, drag to canvas) |
| Inspector | ours | ~400 | Widgets of the selected node (rename, brief, model tier, predicate), edge list, Detach, Stop, Delete |
| Bottom panel | ours plus xterm.js | ~500 | Terminal tab per opened node; Mailroom tab for the project |
| Settings | ours | ~200 | Reads and writes `~/.graphcode/settings.json` through the bridge |
| Keyboard | ours | ~100 | Delete, ⌘Z limited to layout, ⌘K jump, ⌘= ⌘− ⌘0 zoom |

Framework: Vue 3 with Vite, no component kit beyond a handful of our own components. Reason: matches
ComfyUI's stack and Eric's pixterm work; nothing in the list needs PrimeVue.

### Bridge (`graphcode-web`, Node 26 running TypeScript directly, in the fork under `web/server/`)

| Route | Does |
|---|---|
| `GET /` and static | Serves the built web app |
| `WS /ws` | One daemon socket per browser client. Browser to bridge: a `DaemonCommand` JSON per message. Bridge to browser: every `DaemonEvent` frame as JSON, verbatim. The bridge announces `nodesChanged` on connect. |
| `GET /nodes` | The node registry as JSON (like `/object_info`) |
| `GET /templates`, `GET /projects/recent` | Read the kit's files and the daemon's list |
| `GET/PUT /api/canvas?project=<abs path>` | Positions, groups and notes keyed by node id |
| `WS /pty/:nodeID` | Spawns `zmx attach graphcode-<nodeID>` in a pty, relays bytes both ways, resize messages |

The bridge does no translation of the graph. The web app speaks the daemon's own Codable JSON, so
adding a daemon command never touches the bridge. Framing is the kit's: 4-byte big-endian length then
JSON (FramedMessageIO.swift). Node is chosen over Swift because the node registry and the node files
are JavaScript, `node-pty` and `ws` are drop-in, Node 26 runs TypeScript without a build step, and the
whole bridge is around 1k lines. Node 26 and pnpm are already on Eric's machine; Bun is not.

### Engine

Unchanged in phases 0 to 2. Phase 3 adds two daemon commands (section 9).

## 5. Positions and the canvas file

The daemon graph remains the source of truth for nodes, edges and state. The web app keeps a
canvas file per project at `<project>/.graphcode/canvas.json` (the kit already uses
`<project>/.graphcode/templates`), containing, keyed by node id: `pos`, `size`, `collapsed`; plus
`groups` and `notes` that exist only on the canvas. A node the daemon reports without a position gets
one from a simple placement rule (to the right of its nearest upstream node, else the next free slot),
which is the only "auto layout" in version 1; an explicit Arrange command can come later. A node
missing from the daemon is dropped from the file on next save. Phase 2 (section 11) makes the file version 2:
it also holds the drafts and draft wires, which exist nowhere else.

## 6. Node types in JavaScript

A node type is one ES module in `~/.graphcode/nodes/<pack>/<name>.js` (project-local packs in
`<project>/.graphcode/nodes` win on name, mirroring templates). Built-in pack ships in the repo.

```js
export default {
  type: "agent/reviewer",              // library path and litegraph type name
  title: "Reviewer",
  category: "agent",
  description: "Fresh-context review of a branch against a checklist",
  inputs:  [{ name: "start", type: "handoff" }, { name: "inbox", type: "message" }],
  outputs: [{ name: "approved", type: "handoff", condition: "onSuccess" },
            { name: "bounced",  type: "handoff", condition: "onFailure" },
            { name: "mail",     type: "message" }],
  widgets: [{ name: "model", type: "combo", values: ["fast", "standard", "capable"], default: "standard" },
            { name: "checklist", type: "text", multiline: true }],
  // Turns widget values into the daemon's NodeDraft. Runs in the browser at create time.
  toDraft(v) {
    return { loopType: "goalBased", modelTier: v.model,
             goal: { description: `Review the branch against:\n${v.checklist}` },
             predicate: "test -f docs/review/verdict.json" };
  }
};
```

Slot types map onto the engine's edge model with no engine change:

| Slot type on an output | Edge created when linked |
|---|---|
| `handoff` with `condition` | kind handoff, that condition |
| `message` | kind message, always |
| `spawn` | kind spawn, always |

In phase 1 every card carries the same five outputs (handoff, on success, on failure, message,
spawn); a module's own `inputs` and `outputs` are validated and kept for a later phase.

An input accepts links whose slot type matches its own; litegraph enforces this. Version 1 built-ins:
`agent/goal`, `agent/timed`, `agent/main`, `agent/turn`, `group/composite`. Phase 3 adds
deterministic nodes (`shell`, `git`, `compare`, `gate`, `source`) once the daemon can run a script
node; those modules additionally export `run(inputs)`.

A file that fails to load is listed in the Nodes tab with its error and skipped, the way ComfyUI
treats a broken extension.

A project pack runs on open with the page's privileges (like a ComfyUI extension); a consent prompt
is a later phase.

## 7. What the user sees

| Surface | Behaviour |
|---|---|
| Project tabs | Open projects from the daemon. Closing a tab sends `closeProject`. The graph inside a tab is that project's live graph. |
| Canvas | ComfyUI interactions: drag to pan, wheel to zoom, drag a slot to link, double-click for the search box, right-click for the litegraph context menu. Cards show title, state pill, live line, type and age, drawn by the node adapter from the daemon's node. Clicking a card selects it and opens its terminal tab. Right-click menus and the search box are off until their items send daemon commands (phase 1 ruling 2). |
| Nodes tab | Tree of node types by category with search. Drag onto the canvas creates a node with default widget values; the inspector opens for the brief. Create is sent to the daemon only when the brief is confirmed, because a goal loop starts on creation (finding 19). Version 1 pack: agent/goal, agent/timed, agent/main, agent/turn, group/composite; project pack over user pack over built-in on the same name. Phase 2: the drop makes a draft card with its inputs on it (section 11). |
| Workflows tab | Recent projects, open by path, and saved graphs (exported bundles). Phase 2: saved workflow files (section 11); recent projects move to a Projects tab. |
| Templates tab | The kit's template files. Dragging one onto the canvas creates a node with the template's settings. Composite templates come in phase 2 through `importNodes`. |
| Inspector | Brief of the selected node, read-only in phase 1, with Rename; its edges with kind, condition and a delete each; actions Stop, Restart, Detach from template, Delete. Removed in phase 2: the card carries its inputs and buttons (section 11). |
| Bottom panel | Terminal per opened node (xterm.js attached to the zmx session), plus the project's Mailroom. |
| Attention | A count of loops needing a human in the tab strip, and an orange glow on the card, as today. |

## 8. Testing and review

Standing rule (Eric, 2026-09-13): every phase's plan ends with a UI test matrix task. The matrix lists
every control and every visible state the phase adds or touches, one row each, and each row gets a
browser test. Rows that depend on daemon state run against the fake daemon (`web/tests/fakeDaemon.ts`)
with a fixture graph that shows every loop state, loop type and edge condition at once, and save a
screenshot per row under `web/e2e/out/`, so the whole surface is seen on every run, not only what the
live daemon happens to be doing. Phase 0 shipped without this; phase 1's plan starts with the matrix
for the phase 0 surface (tabs, close, open by path, drag and reload, daemon down at boot, daemon lost
mid-session, all nine card states). Phase 1 shipped both matrices: `web/e2e/phase0-matrix.spec.ts`
(10 rows) and `web/e2e/phase1-matrix.spec.ts` (23 rows).

- Bridge: unit tests for framing, relay and registry loading (`node --test`).
- Web app: Playwright smoke against the fork daemon: boot, open the TwoDrive project, drag a node type
  from the library, link two nodes, assert the daemon graph gained a node and an edge via the CLI,
  screenshot the canvas.
- Every phase is built by worker subagents on Opus with a fresh-context review agent per package and
  the Playwright run as the gate. Eric reviews screenshots and the running UI, not code.

## 9. Phases

| Phase | Deliverable | Engine change |
|---|---|---|
| 0 | Read-only canvas: bridge relays the live graph, litegraph draws it with positions persisted; project tabs | none |
| 1 | Editing: node library with drag, links to edges, delete, inspector, create with brief confirmation | none |
| 2 | The canvas is the document: inputs on the card, drafts, Start, workflow files (section 11) | none |
| 2b | Bottom panel: terminal per node, Mailroom; Templates tab; composite import | none |
| 3 | Daemon command `startSession(nodeID)` so attended loops work from the web; `script` node kind that runs `node <file>` with inputs on stdin and captures outputs; deterministic node pack | two commands in GraphcodeKit |
| later | Native window (WKWebView shell in the Swift app) if a browser tab proves annoying; Arrange command; worktree creation | maybe |

## 10. Decisions (2026-09-13)

1. Version 1 runs in a browser tab at `http://localhost:<port>`. A native window is a later phase.
2. Positions live in `<project>/.graphcode/canvas.json` and travel with the repo.
3. The Swift app stays installed and usable beside the web UI. It is not modified.
4. Phase 3 may add the two daemon commands to GraphcodeKit.

Field names in the node-type example (section 6) follow `NodeDraft` in GraphcodeKit; the implementation
plan pins them after reading `GraphcodeKit/Sources/Domain/NodeDraft.swift`.

## 11. Phase 2: the canvas is the document (2026-09-14)

Phase 1 mirrored the daemon: every gesture was a request, and a card appeared only when the daemon
echoed it. Phase 2 flips that, the way ComfyUI works: the canvas is a document the user edits freely,
and the daemon is an overlay on it. It is the proof of concept for the product finding that creation
conflates authoring with running.

- **Inputs on the card.** Each card shows a title field and its node type's widgets (goal or prompt,
  done check, model, backend, …) drawn on the card by litegraph. A draft's are editable in place: text
  fields open the one shared editor over the field; combo, number and toggle are litegraph's own
  widgets. A live card's are read-only except the title, which sends `renameNode`. Cards drag and
  resize (a multiline field takes the room a resize gives); position and size are saved.
- **Drafts.** Dropping a node type makes a draft card at once; nothing is sent. Draft wires are drawn
  from any card's output onto any card and kept locally. Drafts and draft wires live in canvas.json
  (version 2) so a reload keeps them.
- **Start.** A Start button on a draft card sends its `createNode`, then `createEdge` for each draft
  wire whose ends are live or just sent. A toolbar Start sends every draft in one go. A card is
  "starting" until the daemon echoes its id, then it is live; an `errorOccurred` while a start is in
  flight, or 10 s of silence, returns the starting cards to draft with the error in the footer. A goal
  loop still runs the moment the daemon has it (finding 19); Start is the moment the user chooses.
- **Delete and actions.** The Delete key removes a draft outright and asks before sending `deleteNode`
  for a live card. Dragging a wire off its input removes a draft wire outright and asks before sending
  `deleteEdge` for a live edge. Stop and Restart are buttons on a live card. The right-hand inspector
  and Detach from template are gone.
- **Workflow file.** Save writes every card (live ones through the type's `fromLoop`) and every wire to
  `~/.graphcode/workflows/<name>.json`. The Workflows tab lists those files and loads one onto the
  current project as drafts with fresh ids, one column to the right of what is there. Recent projects
  move to a Projects tab.

Node type modules gain an optional `fromLoop(node)` returning widget values for a live loop. A live
loop's type is the built-in for its `loopType` (goalBased → agent/goal, timeBased → agent/timed,
sketch → agent/main, turnBased → agent/turn, proactive → group/composite), subject to the usual pack
precedence, so a user pack that overrides `agent/goal` draws every live goal loop.

Not in phase 2: litegraph's context menus and search box (still off), collapse and colour, a minimap,
and the engine changes (edges gating start, a done state, reopening a resolved loop).
