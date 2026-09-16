<script setup lang="ts">
import type { WorkflowListing } from "../canvas/workflowClient.ts";
import type { DocumentListing } from "../../shared/workflowDocument.ts";
defineProps<{ workflows: WorkflowListing[]; documents: DocumentListing[]; loading: boolean; canSave: boolean }>();
const emit = defineEmits<{ save: []; load: [name: string]; reload: []; openDocument: [id: string] }>();
const when = (ms: number) => new Date(ms).toLocaleString();
</script>

<template>
  <div class="workflows-panel">
    <div class="toolbar">
      <button class="primary" data-testid="workflow-save" :disabled="!canSave" @click="emit('save')">Save template…</button>
      <button data-testid="workflows-reload" title="Reload the list" :disabled="loading" @click="emit('reload')">↻</button>
    </div>
    <h3>Workflows</h3>
    <button v-for="doc in documents" :key="doc.id" class="workflow" data-testid="document-item" :data-id="doc.id" :title="doc.project ?? 'Reopen workflow'" @click="emit('openDocument', doc.id)">
      <span class="title">{{ doc.name }}</span>
    </button>
    <h3>Templates</h3>
    <button v-for="w in workflows" :key="w.name" class="workflow" data-testid="workflow-item" :data-name="w.name" title="Load as fresh draft cards" @click="emit('load', w.name)">
      <span class="title">{{ w.name }}</span>
      <small>{{ when(w.savedAt) }}</small>
    </button>
    <p v-if="loading" class="hint">Loading…</p>
    <p v-else-if="!workflows.length" class="hint">No templates</p>
  </div>
</template>

<style scoped>
.workflows-panel { padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.toolbar { display: flex; gap: 6px; margin-bottom: 6px; }
.toolbar button { background: #23262c; color: inherit; border: 1px solid #2f333a; border-radius: 4px; padding: 6px 8px; font: inherit; cursor: pointer; }
.toolbar button.primary { flex: 1; background: #2f6fcf; border-color: #2f6fcf; color: white; }
.toolbar button:disabled { opacity: .5; cursor: default; }
h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8b909a; }
.workflow { text-align: left; padding: 6px 8px; border: 1px solid #2f333a; border-radius: 4px; background: #23262c; color: inherit; font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.workflow small { color: #8b909a; font-size: 11px; }
.workflow:focus-visible, .toolbar button:focus-visible { outline: 2px solid #3b7dd8; }
.hint { color: #8b909a; margin: 0; font-size: 12px; }
</style>
