<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { createStore } from "./daemon/store.ts";
import { DaemonConnection, type ConnectionStatus } from "./daemon/connection.ts";
import type { DaemonCommand } from "./daemon/protocol.ts";
import { edgeSpec, graphCommand, isLocalProjectPath } from "./daemon/protocol.ts";
import { loadNodeTypes, type NodeTypeEntry } from "./nodes/registry.ts";
import { planStart } from "./nodes/start.ts";
import { getWorkflow, listWorkflows, putWorkflow, type WorkflowListing } from "./canvas/workflowClient.ts";
import { WORKFLOW_NAME } from "../shared/workflowName.ts";
import { emptyCanvasDoc } from "./canvas/document.ts";
import { putLayout } from "./canvas/layoutClient.ts";
import { getWorkflowDocument, listWorkflowDocuments, patchWorkflowDocument, putWorkflowDocument, resolveProjectPath } from "./canvas/documentClient.ts";
import { graphForDocument } from "./canvas/documentGraph.ts";
import { DOCUMENT_ID, documentID, documentKey, type DocumentListing, type WorkflowDocument } from "../shared/workflowDocument.ts";
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
const DOCUMENT_TABS_KEY = "graphcode.workflow-tabs.v1";
function savedDocumentTabs(): { open: string[]; active: string | null } {
  try {
    const text = localStorage.getItem(DOCUMENT_TABS_KEY);
    if (!text) return { open: [], active: null };
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || !("open" in value) || !Array.isArray(value.open)) throw new Error("invalid saved workflow tabs");
    const open = value.open.filter((id): id is string => typeof id === "string" && DOCUMENT_ID.test(id));
    const key = "active" in value && typeof value.active === "string" ? value.active : null;
    return { open, active: key && open.some((id) => documentKey(id) === key) ? key : null };
  } catch (error) {
    store.pushError(`workflow tabs could not be restored: ${error instanceof Error ? error.message : String(error)}`);
    return { open: [], active: null };
  }
}
const savedTabs = savedDocumentTabs();
const documents = ref(new Map<string, WorkflowDocument>());
const documentListings = ref<DocumentListing[]>([]);
const openDocuments = ref(savedTabs.open);
const bindingDocument = ref<{ id: string; project: string; saving: boolean } | null>(null);
const savingRun = ref(false);
/** Holds the canvas so a project being closed can have its pending layout save written first. */
const canvasView = ref<InstanceType<typeof GraphCanvas> | null>(null);
const status = ref<ConnectionStatus>("connecting");
const active = ref<string | null>(savedTabs.active);
let openingProject: string | null = null;
const selected = ref<string | null>(null);
const connection = new DaemonConnection(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);

/** Node types for the active project: its own pack, the user's, and the built-ins. */
const nodeTypes = ref<NodeTypeEntry[]>([]);
const nodeTypesLoading = ref(false);
/** Counts loads so a slow answer for an earlier project cannot overwrite a newer one. */
let nodeTypeLoads = 0;
/** What Run would send: the canvas reports it after every change. */
const counts = ref<DocumentCounts>({ drafts: 0, wires: 0 });
const selectionCount = ref(0);
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
  if ("graphChanged" in event && event.graphChanged._0.project.path === openingProject) {
    active.value = openingProject;
    openingProject = null;
  }
  if ("graphChanged" in event && bindingDocument.value?.project === event.graphChanged._0.project.path && !bindingDocument.value.saving) {
    const binding = bindingDocument.value;
    binding.saving = true;
    void finishBinding(binding.id, binding.project);
  }
  if ("errorOccurred" in event) { openingProject = null; bindingDocument.value = null; }
  if (!active.value) active.value = localPaths.value[0] ?? null;
  // The daemon's error names neither the draft it refused nor the project, so every project with a
  // start in flight takes its starting cards back (plan ruling 8).
  if ("errorOccurred" in event) for (const project of [...startTimers.keys()]) revertStarting(project, event.errorOccurred._0);
});
connection.onStatus((s) => {
  status.value = s;
  if (s === "open") {
    send({ restoreOpenProjects: {} });
    send({ listRecentProjects: {} });
    for (const id of openDocuments.value) {
      const project = documents.value.get(id)?.project;
      if (project && !store.projects.has(project)) send({ openProject: { path: project } });
    }
  }
});

const names = computed(() => Object.fromEntries([
  ...store.order.map((p) => [p, store.projects.get(p)?.project.name ?? p]),
  ...openDocuments.value.map((id) => [documentKey(id), documents.value.get(id)?.name ?? "Loading workflow"]),
]));
const localPaths = computed(() => store.order.filter(isLocalProjectPath));
const tabPaths = computed(() => [...localPaths.value, ...openDocuments.value.map(documentKey)]);
const activeDocument = computed(() => {
  const id = active.value && documentID(active.value);
  return id ? documents.value.get(id) ?? null : null;
});
const activeGraph = computed(() => {
  if (activeDocument.value) {
    const doc = activeDocument.value;
    return graphForDocument(doc, doc.project ? store.projects.get(doc.project) ?? null : null);
  }
  return active.value ? store.projects.get(active.value) ?? null : null;
});
/** Only a daemon-confirmed project may supply local node packs. */
const confirmedProject = computed(() => activeDocument.value ? activeDocument.value.project && store.projects.has(activeDocument.value.project) ? activeDocument.value.project : null : activeGraph.value?.project.path ?? null);
const lastError = computed(() => store.errors[store.errors.length - 1] ?? "");
const startable = computed(() => counts.value.drafts + counts.value.wires > 0);
const executionProject = (key: string): string | null => {
  const id = documentID(key);
  return id ? documents.value.get(id)?.project ?? null : key;
};

watch([openDocuments, active], () => {
  try { localStorage.setItem(DOCUMENT_TABS_KEY, JSON.stringify({ open: openDocuments.value, active: active.value })); }
  catch (error) { store.pushError(`workflow tabs could not be saved: ${problemText(error)}`); }
}, { deep: true });

async function refreshDocuments() {
  try { documentListings.value = await listWorkflowDocuments(); }
  catch (error) { store.pushError(problemText(error)); }
}

async function newWorkflow(name?: string) {
  const number = documentListings.value.filter((doc) => doc.name.startsWith("Untitled workflow")).length + 1;
  const doc: WorkflowDocument = { version: 1, id: crypto.randomUUID(), name: name ?? `Untitled workflow${number > 1 ? ` ${number}` : ""}`, project: null, canvas: emptyCanvasDoc() };
  try {
    await putWorkflowDocument(doc);
    documents.value.set(doc.id, doc);
    openDocuments.value.push(doc.id);
    active.value = documentKey(doc.id);
    await refreshDocuments();
  } catch (error) { store.pushError(problemText(error)); }
}

async function openDocument(id: string, focus = true) {
  try {
    const doc = await getWorkflowDocument(id);
    documents.value.set(id, doc);
    if (!openDocuments.value.includes(id)) openDocuments.value.push(id);
    if (focus) active.value = documentKey(id);
    if (doc.project && !store.projects.has(doc.project) && status.value === "open") send({ openProject: { path: doc.project } });
  } catch (error) {
    store.pushError(problemText(error));
    openDocuments.value = openDocuments.value.filter((item) => item !== id);
    if (active.value === documentKey(id)) active.value = localPaths.value[0] ?? null;
  }
}

async function closeTab(key: string) {
  const id = documentID(key);
  if (!id) { closeProject(key); return; }
  if (await canvasView.value?.flushSave(key) === false) return;
  openDocuments.value = openDocuments.value.filter((item) => item !== id);
  if (active.value === key) active.value = openDocuments.value.length ? documentKey(openDocuments.value[0]!) : localPaths.value[0] ?? null;
}

async function renameDocument(key: string) {
  const id = documentID(key);
  const doc = id && documents.value.get(id);
  if (!doc) return;
  const name = window.prompt("Workflow name", doc.name)?.trim();
  if (!name) return;
  try {
    if (await canvasView.value?.flushSave(key) === false) return;
    await patchWorkflowDocument(doc.id, { name });
    doc.name = name;
    await refreshDocuments();
  } catch (error) { store.pushError(problemText(error)); }
}

async function finishBinding(id: string, project: string) {
  const doc = documents.value.get(id);
  if (!doc) return;
  const key = documentKey(id);
  try {
    const adapter = adapterFor(key);
    if (adapter) {
      doc.canvas = adapter.document();
      await putLayout(key, doc.canvas);
    }
    await patchWorkflowDocument(id, { project });
    doc.project = project;
    await refreshDocuments();
  } catch (error) { store.pushError(`folder could not be attached: ${problemText(error)}`); }
  finally { if (bindingDocument.value?.id === id) bindingDocument.value = null; }
}

/** Drop the tab only once the daemon has been told, so the view cannot disagree with the daemon. */
function closeProject(path: string) {
  if (!send({ closeProject: { path } })) return;
  // Closing a tab other than the one on screen never changes the canvas's own graph prop, so
  // nothing else would ever run this project's debounced save: write the last move now.
  canvasView.value?.flushSave(path);
  store.projects.delete(path);
  store.order = store.order.filter((p) => p !== path);
  if (active.value === path) active.value = localPaths.value[0] ?? null;
}
async function openProject(path: string) {
  if (!isLocalProjectPath(path)) {
    store.pushError("The web canvas supports local folders only. Open remote projects in the Mac app.");
    return;
  }
  try {
    const canonical = await resolveProjectPath(path);
    if (!send({ openProject: { path: canonical } })) return;
    openingProject = canonical;
  } catch (error) { store.pushError(problemText(error)); }
}

async function reloadNodeTypes() {
  const load = ++nodeTypeLoads;
  const project = confirmedProject.value;
  nodeTypesLoading.value = true;
  try {
    const entries = await loadNodeTypes(project);
    if (load === nodeTypeLoads) nodeTypes.value = entries;
  } catch (error) {
    if (load === nodeTypeLoads) {
      nodeTypes.value = [];
      store.pushError(error instanceof Error ? error.message : String(error));
    }
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
 * Run: every draft, as ComfyUI's one Queue button runs the whole graph. createNode for each, then
 * createEdge for each wire whose two ends are ready (plan ruling 2). The cards wait as "starting"
 * for the daemon's echo.
 */
async function startCards() {
  const key = active.value;
  const adapter = adapterFor(key);
  if (!key || !adapter || savingRun.value || bindingDocument.value || nodeTypesLoading.value) return;
  const doc = activeDocument.value;
  const project = executionProject(key);
  const cards = adapter.cards().map((c) => ({ id: String(c.id), mode: c.cardMode, title: c.title, problems: c.cardMode === "draft" ? c.problems() : [], draft: () => c.draft() }));
  const plan = planStart(cards, adapter.draftEdges());
  for (const s of plan.skipped) store.pushError(`"${s.title || "Untitled"}" was not started: ${s.problem}`);
  if (!plan.creates.length && !plan.edges.length) return;
  if (doc && !project) {
    if (status.value !== "open") { store.pushError("Connect to graphcoded before choosing a folder and running this workflow."); return; }
    const folder = window.prompt("Choose an absolute project folder for this workflow. No agents start until you press Run again.")?.trim();
    if (!folder) return;
    if (!isLocalProjectPath(folder)) { store.pushError("Choose an absolute local project folder."); return; }
    savingRun.value = true;
    try {
      const canonical = await resolveProjectPath(folder);
      bindingDocument.value = { id: doc.id, project: canonical, saving: false };
      if (!send({ openProject: { path: canonical } })) bindingDocument.value = null;
    } catch (error) { store.pushError(problemText(error)); }
    finally { savingRun.value = false; }
    return;
  }
  if (!project) return;
  const createdIDs = plan.creates.map((card) => card.id);
  if (doc) {
    savingRun.value = true;
    adapter.markStarting(createdIDs);
    doc.canvas = adapter.document();
    try { await putLayout(key, doc.canvas); }
    catch (error) {
      adapter.revertStarting(createdIDs);
      canvasView.value?.touch(key);
      store.pushError(`workflow must be saved before Run: ${problemText(error)}`);
      return;
    } finally { savingRun.value = false; }
  }
  const sendRun = (command: DaemonCommand) => {
    if (send(command)) return true;
    adapter.revertStarting(createdIDs);
    canvasView.value?.touch(key);
    return false;
  };
  for (const c of plan.creates) if (!sendRun(graphCommand(project, { createNode: { _0: c.draft } }))) return;
  for (const e of plan.edges) if (!sendRun(graphCommand(project, { createEdge: { from: e.from, to: e.to, spec: edgeSpec(e.kind, e.condition) } }))) return;
  if (plan.creates.length) {
    adapter.markStarting(plan.creates.map((c) => c.id));
    const armed = startTimers.get(key);
    if (armed) clearTimeout(armed);
    startTimers.set(key, setTimeout(() => revertStarting(key, `the daemon did not report the new loop within ${startTimeoutMs / 1000} s`), startTimeoutMs));
  }
  canvasView.value?.touch(key);
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
  const reported = new Set((store.projects.get(executionProject(project) ?? "")?.nodes ?? []).map((n) => n.id));
  const stale = adapter.cards().filter((c) => c.cardMode === "starting" && !reported.has(String(c.id))).map((c) => String(c.id));
  const reverted = stale.length ? adapter.revertStarting(stale) : [];
  if (!reverted.length) return;
  store.pushError(`${reverted.length === 1 ? "1 card" : `${reverted.length} cards`} went back to draft: ${why}`);
  canvasView.value?.touch(project);
}

function onRename(id: string, title: string) {
  const project = active.value && executionProject(active.value);
  if (project) send(graphCommand(project, { renameNode: { _0: id, title } }));
}
/** The Delete key on live cards: they are the daemon's, so ask once, then send deleteNode for each. */
function onDeleteLive(ids: string[]) {
  const project = active.value && executionProject(active.value);
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
  const project = active.value && executionProject(active.value);
  if (!project) return;
  if (!window.confirm("Delete this edge? It cannot be undone.")) return;
  send(graphCommand(project, { deleteEdge: { _0: edgeID } }));
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
  try {
    const file = await getWorkflow(name);
    if (!activeGraph.value) await newWorkflow(file.name);
    const project = active.value;
    if (!project) return;
    await nextTick();
    await canvasView.value?.ready(project);
    const adapter = adapterFor(project);
    if (!adapter) throw new Error("The canvas is not ready.");
    adapter.loadWorkflow(file);
    canvasView.value?.touch(project);
  } catch (error) {
    store.pushError(problemText(error));
  }
}

// A selected card belongs to the project it came from; a tab change clears it.
watch(active, () => { selected.value = null; selectionCount.value = 0; });

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
    setStartTimeout: (ms: number) => { startTimeoutMs = ms; },
  };
  connection.open();
  void refreshWorkflows();
  void refreshDocuments();
  for (const id of savedTabs.open) void openDocument(id, false);
});
</script>

<template>
  <main class="shell">
    <ProjectTabs :paths="tabPaths" :names="names" :active="active" @select="active = $event" @close="closeTab" @new="newWorkflow()" @rename="renameDocument" />
    <div class="body">
      <Sidebar>
        <template #nodes><NodesPanel :entries="nodeTypes" :loading="nodeTypesLoading" @reload="reloadNodeTypes" /></template>
        <template #workflows><WorkflowsPanel :workflows="workflows" :documents="documentListings" :loading="workflowsLoading" :can-save="!!activeGraph" @save="saveWorkflow" @load="loadWorkflow" @open-document="openDocument" @reload="refreshWorkflows(); refreshDocuments()" /></template>
        <template #projects><ProjectsPanel :recent="store.recent" @open="openProject" /></template>
      </Sidebar>
      <section class="center">
        <div v-if="activeGraph" class="toolbar" data-testid="toolbar">
          <button class="primary" data-testid="run" :disabled="!startable || nodeTypesLoading || !!bindingDocument || savingRun" :title="`${counts.drafts} draft card(s) and ${counts.wires} draft wire(s)`" @click="startCards()">
            Run<span v-if="startable" class="count" data-testid="run-count">{{ counts.drafts + counts.wires }}</span>
          </button>
          <button data-testid="save-workflow" @click="saveWorkflow">Save workflow…</button>
          <button data-testid="select-all" title="Select all cards (Cmd/Ctrl+A)" @click="canvasView?.selectAll()">Select all</button>
          <button data-testid="copy-selection" :disabled="!selectionCount" :title="`Copy ${selectionCount} selected card(s) and their internal wires (Cmd/Ctrl+C)`" @click="canvasView?.copySelection()">Copy</button>
          <button data-testid="paste-workflow" title="Paste workflow as fresh drafts (Cmd/Ctrl+V)" @click="canvasView?.pasteClipboard()">Paste</button>
          <span class="hint">Nothing runs until you press Run.</span>
        </div>
        <div v-if="activeDocument" class="canvas-help" data-testid="project-binding">{{ activeDocument.project ? `Folder: ${activeDocument.project}` : "Autosaved workflow · A folder is only needed before Run." }}</div>
        <div v-if="activeGraph" class="canvas-help">Drag empty canvas to select · Shift-click to add · Space+drag or middle-drag to pan · Wheel to pan · Ctrl+wheel to zoom · Cmd/Ctrl+A/C/V</div>
        <GraphCanvas v-if="activeGraph" ref="canvasView" :graph="activeGraph" :node-types="nodeTypes" :types-loading="nodeTypesLoading" @select="selected = $event" @rename="onRename" @delete-live="onDeleteLive" @delete-edge="onDeleteEdge" @document-changed="counts = $event" @selection-changed="selectionCount = $event" @problem="store.pushError($event)" />
        <div v-else class="empty" data-testid="empty">{{ activeDocument?.project ? "Waiting for the bound project. Your workflow is saved." : active && documentID(active) ? "Loading workflow…" : "Press + for a blank workflow, or open a folder from Projects." }}</div>
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
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 10px; background: #1e2126; border-bottom: 1px solid #2f333a; }
.canvas-help { padding: 5px 10px; color: #a4a9b2; background: #1e2126; font-size: 12px; }
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
