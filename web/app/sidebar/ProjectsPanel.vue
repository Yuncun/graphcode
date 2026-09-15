<script setup lang="ts">
import type { ProjectRef } from "../daemon/protocol.ts";
defineProps<{ recent: ProjectRef[] }>();
const emit = defineEmits<{ open: [path: string] }>();
</script>

<template>
  <div class="projects-panel">
    <h3>Recent projects</h3>
    <button v-for="p in recent" :key="p.path" class="recent" data-testid="recent-project" :title="p.path" @click="emit('open', p.path)">
      <span class="title">{{ p.name }}</span>
      <small>{{ p.path }}</small>
    </button>
    <p v-if="!recent.length" class="hint">The daemon has no recent projects. Use + in the tab strip to open a folder.</p>
  </div>
</template>

<style scoped>
.projects-panel { padding: 8px; display: flex; flex-direction: column; gap: 4px; }
h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8b909a; }
.recent { text-align: left; padding: 6px 8px; border: 1px solid #2f333a; border-radius: 4px; background: #23262c; color: inherit; font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.recent small { color: #8b909a; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent:focus-visible { outline: 2px solid #3b7dd8; }
.hint { color: #8b909a; margin: 0; font-size: 12px; }
</style>
