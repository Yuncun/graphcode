<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { createStore } from "./daemon/store.ts";
import { DaemonConnection, type ConnectionStatus } from "./daemon/connection.ts";
import type { DaemonCommand } from "./daemon/protocol.ts";
import { edgeSpec, graphCommand } from "./daemon/protocol.ts";
import { loadNodeTypes, type NodeTypeEntry } from "./nodes/registry.ts";
import { planStart } from "./nodes/start.ts";
import type { CardAction } from "./canvas/LoopCardNode.ts";
import { getWorkflow, listWorkflows, putWorkflow, type WorkflowListing } from "./canvas/workflowClient.ts";
import { WORKFLOW_NAME } from "../shared/workflowName.ts";
import GraphCanvas, { type DocumentCounts } from "./canvas/GraphCanvas.vue";
import ProjectTabs from "./tabs/ProjectTabs.vue";
import Sidebar from "./sidebar/Sidebar.vue";
import NodesPanel from "./sidebar/NodesPanel.vue";
import WorkflowsPanel from "./sidebar/WorkflowsPanel.vue";
import ProjectsPanel from "./sidebar/ProjectsPanel.vue";

/** How long a starting card waits for the daemon's echo before it goes back to draft (plan ruling 8). */
const START_TIMEOUT_MS = 10_000;
/** Mutable so a browser test can shrink the wait; every new timer is armed with the current value. */
let startTimeoutMs = START_TIMEOUT_MS;

const store = createStore();
/** Holds the canvas so a project being closed can have its pending layout save written first. */
const canvasView = ref<InstanceType<typeof GraphCanvas> | null>(null);
const status = ref<ConnectionStatus>("connecting");
const active = ref<string | null>(null);
const selected = ref<string | null>(null);
const connection = new DaemonConnection(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);

/** Node types for the active project: its own pack, the user's, and the built-ins. */
const nodeTypes = ref<NodeTypeEntry[]>([]);
const nodeTypesLoading = ref(false);
/** Counts loads so a slow answer for an earlier project cannot overwrite a newer one. */
let nodeTypeLoads = 0;
/** What Start all would send: the canvas reports it after every change. */
const counts = ref<DocumentCounts>({ drafts: 0, wires: 0 });
const workflows = ref<WorkflowListing[]>([]);
const workflowsLoading = ref(false);
/** One per project with a Start in flight; an errorOccurred while any is armed reverts that project's starting cards. */
const startTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * DaemonConnection.send throws when the socket is not open, so every command goes through here:
 * a command sent while the bridge is down becomes a line in the status bar, not an exception.
 */
function send(command: DaemonCommand): boolean {
  if (status.value !== "open") {
    store.pushError(`not connected to graphcoded, ${Object.keys(command)[0]} was not sent`);
    return false;
  }
  connection.send(command);
  return true;
}

connection.onEvent((event) => {
  store.applyEvent(event);
  if (!active.value && store.order.length) active.value = store.order[0]!;
  // The daemon's error names neither the draft it refused nor the project, so every project with a
  // start in flight takes its starting cards back (plan ruling 8).
  if ("errorOccurred" in event) for (const project of [...startTimers.keys()]) revertStarting(project, event.errorOccurred._0);
});
connection.onStatus((s) => {
  status.value = s;
  if (s === "open") {
    send({ restoreOpenProjects: {} });
    send({ listRecentProjects: {} });
  }
});

const names = computed(() => Object.fromEntries(store.order.map((p) => [p, store.projects.get(p)?.project.name ?? p])));
const activeGraph = computed(() => (active.value ? store.projects.get(active.value) ?? null : null));
/** The active project once the daemon has actually confirmed it: null for the built-ins-only case, and never a path the daemon rejected (openProject sets `active` before that answer arrives). */
const confirmedProject = computed(() => activeGraph.value?.project.path ?? null);
const lastError = computed(() => store.errors[store.errors.length - 1] ?? "");
const startable = computed(() => counts.value.drafts + counts.value.wires > 0);

/** Drop the tab only once the daemon has been told, so the view cannot disagree with the daemon. */
function closeProject(path: string) {
  if (!send({ closeProject: { path } })) return;
  // Closing a tab other than the one on screen never changes the canvas's own graph prop, so
  // nothing else would ever run this project's debounced save: write the last move now.
  canvasView.value?.flushSave(path);
  store.projects.delete(path);
  store.order = store.order.filter((p) => p !== path);
  if (active.value === path) active.value = store.order[0] ?? null;
}
function openProject(path: string) {
  if (!send({ openProject: { path } })) return;
  active.value = path;
}

async function reloadNodeTypes() {
  const load = ++nodeTypeLoads;
  const project = confirmedProject.value;
  nodeTypesLoading.value = true;
  try {
    const entries = await loadNodeTypes(project);
    if (load === nodeTypeLoads) nodeTypes.value = entries;
  } catch (error) {
    if (load === nodeTypeLoads) store.pushError(error instanceof Error ? error.message : String(error));
  } finally {
    if (load === nodeTypeLoads) nodeTypesLoading.value = false;
  }
}
// A project's own pack can shadow a built-in, so the list follows the project the daemon has
// confirmed, not the tab the user merely asked for.
watch(confirmedProject, () => { void reloadNodeTypes(); }, { immediate: true });

const adapterFor = (project: string | null) => (project ? canvasView.value?.adapter(project) ?? null : null);
const problemText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Start: every draft, or the ones named. createNode for each, then createEdge for each wire whose
 * two ends are ready (plan ruling 2). The cards wait as "starting" for the daemon's echo.
 */
function startCards(only?: string[]) {
  const project = active.value;
  const adapter = adapterFor(project);
  if (!project || !adapter) return;
  const cards = adapter.cards().map((c) => ({ id: String(c.id), mode: c.cardMode, title: c.title, problems: c.cardMode === "draft" ? c.problems() : [], draft: () => c.draft() }));
  const plan = planStart(cards, adapter.draftEdges(), only);
  for (const s of plan.skipped) store.pushError(`"${s.title || "Untitled"}" was not started: ${s.problem}`);
  if (!plan.creates.length && !plan.edges.length) return;
  for (const c of plan.creates) if (!send(graphCommand(project, { createNode: { _0: c.draft } }))) return;
  for (const e of plan.edges) if (!send(graphCommand(project, { createEdge: { from: e.from, to: e.to, spec: edgeSpec(e.kind, e.condition) } }))) return;
  if (plan.creates.length) {
    adapter.markStarting(plan.creates.map((c) => c.id));
    const armed = startTimers.get(project);
    if (armed) clearTimeout(armed);
    startTimers.set(project, setTimeout(() => revertStarting(project, `the daemon did not report the new loop within ${startTimeoutMs / 1000} s`), startTimeoutMs));
  }
  canvasView.value?.touch(project);
}

/** One project's starting cards go back to draft: the daemon said no, or said nothing for too long. */
function revertStarting(project: string, why: string) {
  const armed = startTimers.get(project);
  if (armed) clearTimeout(armed);
  startTimers.delete(project);
  const adapter = adapterFor(project);
  if (!adapter) return;
  // The store holds what the daemon reported even for a project not on screen; a card it has is
  // live the next time that project is shown, so only the cards it does not have go back to draft.
  const reported = new Set((store.projects.get(project)?.nodes ?? []).map((n) => n.id));
  const stale = adapter.cards().filter((c) => c.cardMode === "starting" && !reported.has(String(c.id))).map((c) => String(c.id));
  const reverted = stale.length ? adapter.revertStarting(stale) : [];
  if (!reverted.length) return;
  store.pushError(`${reverted.length === 1 ? "1 card" : `${reverted.length} cards`} went back to draft: ${why}`);
  canvasView.value?.touch(project);
}

function onAction(id: string, action: CardAction) {
  const project = active.value;
  if (!project) return;
  if (action === "start") startCards([id]);
  else if (action === "stop") send(graphCommand(project, { stopNode: { _0: id } }));
  else send(graphCommand(project, { restartNode: { _0: id } }));
}
function onRename(id: string, title: string) {
  if (active.value) send(graphCommand(active.value, { renameNode: { _0: id, title } }));
}
/** The Delete key on live cards: they are the daemon's, so ask once, then send deleteNode for each. */
function onDeleteLive(ids: string[]) {
  const project = active.value;
  const graph = activeGraph.value;
  if (!project || !graph || !ids.length) return;
  const title = graph.nodes.find((n) => n.id === ids[0])?.title ?? ids[0];
  const question = ids.length === 1
    ? `Delete "${title}"? This removes its edges and its session and cannot be undone.`
    : `Delete ${ids.length} loops? This removes their edges and sessions and cannot be undone.`;
  if (!window.confirm(question)) return;
  for (const id of ids) send(graphCommand(project, { deleteNode: { _0: id } }));
}
function onDeleteEdge(edgeID: string) {
  if (!active.value) return;
  if (!window.confirm("Delete this edge? It cannot be undone.")) return;
  send(graphCommand(active.value, { deleteEdge: { _0: edgeID } }));
}

async function refreshWorkflows() {
  workflowsLoading.value = true;
  try { workflows.value = await listWorkflows(); }
  catch (error) { store.pushError(problemText(error)); }
  finally { workflowsLoading.value = false; }
}
/** Every card and wire on the canvas, as a file any project can load as drafts. */
async function saveWorkflow() {
  const project = active.value;
  const adapter = adapterFor(project);
  if (!project || !adapter) return;
  const name = window.prompt("Save this canvas as a workflow named")?.trim();
  if (!name) return;
  if (!WORKFLOW_NAME.test(name)) {
    store.pushError("a workflow name is 1 to 64 letters, digits, spaces, _ - or ., not starting with a space or a dot");
    return;
  }
  try {
    await putWorkflow(adapter.workflow(name));
    await refreshWorkflows();
  } catch (error) {
    store.pushError(problemText(error));
  }
}
async function loadWorkflow(name: string) {
  const project = active.value;
  const adapter = adapterFor(project);
  if (!project || !adapter) return;
  try {
    const file = await getWorkflow(name);
    const made = adapter.loadWorkflow(file);
    const skipped = Object.keys(file.cards).length - made.length;
    if (skipped) store.pushError(`${skipped} card${skipped === 1 ? "" : "s"} in "${name}" skipped: node type not loaded`);
    canvasView.value?.touch(project);
  } catch (error) {
    store.pushError(problemText(error));
  }
}

// A selected card belongs to the project it came from; a tab change clears it.
watch(active, () => { selected.value = null; });

onMounted(() => {
  (window as unknown as { __graphcode: unknown }).__graphcode = {
    store,
    openProject,
    active: () => active.value,
    selected: () => selected.value,
    positions: (project: string) => canvasView.value?.positions(project),
    viewport: () => canvasView.value?.viewport(),
    nodeTypes: () => nodeTypes.value,
    cards: (project: string) => canvasView.value?.cards(project),
    document: (project: string) => canvasView.value?.document(project),
    counts: () => counts.value,
    widgetBox: (project: string, id: string, name: string) => canvasView.value?.widgetBox(project, id, name) ?? null,
    buttonBox: (project: string, id: string, label: string) => canvasView.value?.buttonBox(project, id, label) ?? null,
    setStartTimeout: (ms: number) => { startTimeoutMs = ms; },
  };
  connection.open();
  void refreshWorkflows();
});
</script>

<template>
  <main class="shell">
    <ProjectTabs :paths="store.order" :names="names" :active="active" @select="active = $event" @close="closeProject" @open="openProject" />
    <div class="body">
      <Sidebar>
        <template #nodes><NodesPanel :entries="nodeTypes" :loading="nodeTypesLoading" @reload="reloadNodeTypes" /></template>
        <template #workflows><WorkflowsPanel :workflows="workflows" :loading="workflowsLoading" :can-save="!!activeGraph" @save="saveWorkflow" @load="loadWorkflow" @reload="refreshWorkflows" /></template>
        <template #projects><ProjectsPanel :recent="store.recent" @open="openProject" /></template>
      </Sidebar>
      <section class="center">
        <div v-if="activeGraph" class="toolbar" data-testid="toolbar">
          <button class="primary" data-testid="start-all" :disabled="!startable" :title="`${counts.drafts} draft card(s) and ${counts.wires} draft wire(s)`" @click="startCards()">
            Start all<span v-if="startable" class="count" data-testid="start-count">{{ counts.drafts + counts.wires }}</span>
          </button>
          <button data-testid="save-workflow" @click="saveWorkflow">Save workflow…</button>
          <span class="hint">Drop a node type to draft a card. Nothing runs until Start.</span>
        </div>
        <GraphCanvas v-if="activeGraph" ref="canvasView" :graph="activeGraph" :node-types="nodeTypes" @select="selected = $event" @action="onAction" @rename="onRename" @delete-live="onDeleteLive" @delete-edge="onDeleteEdge" @document-changed="counts = $event" @problem="store.pushError($event)" />
        <div v-else class="empty" data-testid="empty">{{ status === "open" ? "No open projects. Press + to open a folder." : "Connecting to graphcoded…" }}</div>
      </section>
    </div>
    <footer class="status" data-testid="status">{{ status }}<span v-if="lastError" class="error"> · {{ lastError }}</span></footer>
  </main>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
body { background: #17191d; color: #e8e6e1; font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 14px; }
.shell { height: 100%; display: flex; flex-direction: column; }
.body { flex: 1; display: flex; min-height: 0; }
.center { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #1e2126; border-bottom: 1px solid #2f333a; }
.toolbar button { background: #23262c; color: inherit; border: 1px solid #2f333a; border-radius: 4px; padding: 5px 10px; font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.toolbar button.primary { background: #2f6fcf; border-color: #2f6fcf; color: white; }
.toolbar button:disabled { opacity: .5; cursor: default; }
.toolbar button:focus-visible { outline: 2px solid #3b7dd8; outline-offset: 1px; }
.toolbar .count { background: rgba(255, 255, 255, .25); border-radius: 9px; padding: 0 6px; font-size: 12px; }
.toolbar .hint { color: #8b909a; font-size: 12px; }
.empty { flex: 1; display: grid; place-items: center; color: #8b909a; }
.status { padding: 4px 10px; font-size: 12px; color: #8b909a; border-top: 1px solid #2f333a; background: #1e2126; }
.error { color: #f4b58f; }
</style>
