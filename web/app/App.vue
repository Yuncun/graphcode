<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { createStore } from "./daemon/store.ts";
import { DaemonConnection, type ConnectionStatus } from "./daemon/connection.ts";
import type { DaemonCommand } from "./daemon/protocol.ts";
import GraphCanvas from "./canvas/GraphCanvas.vue";
import ProjectTabs from "./tabs/ProjectTabs.vue";

const store = createStore();
/** Holds the canvas so a project being closed can have its pending layout save written first. */
const canvasView = ref<InstanceType<typeof GraphCanvas> | null>(null);
const status = ref<ConnectionStatus>("connecting");
const active = ref<string | null>(null);
const connection = new DaemonConnection(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);

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

onMounted(() => {
  (window as unknown as { __graphcode: unknown }).__graphcode = {
    store,
    openProject,
    active: () => active.value,
    positions: (project: string) => canvasView.value?.positions(project),
    viewport: () => canvasView.value?.viewport(),
  };
  connection.open();
});
</script>

<template>
  <main class="shell">
    <ProjectTabs :paths="store.order" :names="names" :active="active" @select="active = $event" @close="closeProject" @open="openProject" />
    <GraphCanvas v-if="activeGraph" ref="canvasView" :graph="activeGraph" />
    <div v-else class="empty" data-testid="empty">{{ status === "open" ? "No open projects. Press + to open a folder." : "Connecting to graphcoded…" }}</div>
    <footer class="status" data-testid="status">{{ status }}<span v-if="lastError" class="error"> · {{ lastError }}</span></footer>
  </main>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
body { background: #17191d; color: #e8e6e1; font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 14px; }
.shell { height: 100%; display: flex; flex-direction: column; }
.empty { flex: 1; display: grid; place-items: center; color: #8b909a; }
.status { padding: 4px 10px; font-size: 12px; color: #8b909a; border-top: 1px solid #2f333a; background: #1e2126; }
.error { color: #f4b58f; }
</style>
