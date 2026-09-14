<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { createStore } from "./daemon/store.ts";
import { DaemonConnection, type ConnectionStatus } from "./daemon/connection.ts";
import type { DaemonCommand, NodeDraft } from "./daemon/protocol.ts";
import { graphCommand } from "./daemon/protocol.ts";
import { loadNodeTypes, type NodeTypeEntry } from "./nodes/registry.ts";
import GraphCanvas from "./canvas/GraphCanvas.vue";
import ProjectTabs from "./tabs/ProjectTabs.vue";
import Sidebar from "./sidebar/Sidebar.vue";
import NodesPanel from "./sidebar/NodesPanel.vue";
import WorkflowsPanel from "./sidebar/WorkflowsPanel.vue";
import Inspector, { type PendingCreate } from "./inspector/Inspector.vue";

const store = createStore();
/** Holds the canvas so a project being closed can have its pending layout save written first. */
const canvasView = ref<InstanceType<typeof GraphCanvas> | null>(null);
const status = ref<ConnectionStatus>("connecting");
const active = ref<string | null>(null);
const connection = new DaemonConnection(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);

/** Node types for the active project: its own pack, the user's, and the built-ins. */
const nodeTypes = ref<NodeTypeEntry[]>([]);
const nodeTypesLoading = ref(false);
/** Counts loads so a slow answer for an earlier project cannot overwrite a newer one. */
let nodeTypeLoads = 0;

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

/** Drop the tab only once the daemon has been told, so the view cannot disagree with the daemon. */
function closeProject(path: string) {
  if (!send({ closeProject: { path } })) return;
  // Closing a tab other than the one on screen never changes the canvas's own graph prop, so
  // nothing else would ever run this project's debounced save: write the last move now, which
  // also drops the timer with the project.
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
// confirmed, not the tab the user merely asked for: a path the daemon rejects (never reaching
// activeGraph) never asks the bridge for a listing, so its own errorOccurred is what the footer shows.
watch(confirmedProject, () => { void reloadNodeTypes(); }, { immediate: true });

/** A node type dropped on the canvas, waiting for its brief to be confirmed. */
const pending = ref<PendingCreate | null>(null);

function onDropType({ type, pos }: { type: string; pos: [number, number] }) {
  const entry = nodeTypes.value.find((e) => e.type === type);
  if (!entry || !entry.ok) { store.pushError(`node type ${type} is not loaded`); return; }
  pending.value = { def: entry.def, pos };
}

/** The brief is confirmed: tell the daemon, then reserve the drop position. A goal loop starts on creation. */
function onCreate(draft: NodeDraft) {
  const project = active.value;
  const drop = pending.value;
  if (!project || !drop) return;
  if (!send(graphCommand(project, { createNode: { _0: draft } }))) return;
  // The daemon answers over the socket, so the reservation is in place before its graphChanged can arrive.
  canvasView.value?.reserveLayout(project, draft.id, drop.pos);
  pending.value = null;
}

// A dropped brief belongs to the project it was dropped on.
watch(active, () => { pending.value = null; });

onMounted(() => {
  (window as unknown as { __graphcode: unknown }).__graphcode = {
    store,
    openProject,
    active: () => active.value,
    positions: (project: string) => canvasView.value?.positions(project),
    viewport: () => canvasView.value?.viewport(),
    nodeTypes: () => nodeTypes.value,
  };
  connection.open();
});
</script>

<template>
  <main class="shell">
    <ProjectTabs :paths="store.order" :names="names" :active="active" @select="active = $event" @close="closeProject" @open="openProject" />
    <div class="body">
      <Sidebar>
        <template #nodes><NodesPanel :entries="nodeTypes" :loading="nodeTypesLoading" @reload="reloadNodeTypes" /></template>
        <template #workflows><WorkflowsPanel :recent="store.recent" @open="openProject" /></template>
      </Sidebar>
      <section class="center">
        <GraphCanvas v-if="activeGraph" ref="canvasView" :graph="activeGraph" @drop-type="onDropType" />
        <div v-else class="empty" data-testid="empty">{{ status === "open" ? "No open projects. Press + to open a folder." : "Connecting to graphcoded…" }}</div>
      </section>
      <Inspector :pending="pending" @create="onCreate" @cancel="pending = null" />
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
.empty { flex: 1; display: grid; place-items: center; color: #8b909a; }
.status { padding: 4px 10px; font-size: 12px; color: #8b909a; border-top: 1px solid #2f333a; background: #1e2126; }
.error { color: #f4b58f; }
</style>
