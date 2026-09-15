<script setup lang="ts">
import { computed, ref } from "vue";
import type { NodeTypeEntry } from "../nodes/registry.ts";
import { brokenEntries, groupByCategory, NODE_TYPE_MIME } from "./library.ts";

const props = defineProps<{ entries: NodeTypeEntry[]; loading: boolean }>();
const emit = defineEmits<{ reload: [] }>();
const query = ref("");
const groups = computed(() => groupByCategory(props.entries, query.value));
const broken = computed(() => brokenEntries(props.entries));

function start(event: DragEvent, type: string) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(NODE_TYPE_MIME, type);
  event.dataTransfer.effectAllowed = "copy";
}
</script>

<template>
  <div class="nodes-panel">
    <div class="toolbar">
      <input v-model="query" data-testid="node-search" type="search" placeholder="Search node types" aria-label="Search node types" />
      <button data-testid="nodes-reload" title="Reload node packs" :disabled="loading" @click="emit('reload')">↻</button>
    </div>
    <p v-if="loading" class="hint">Loading node packs…</p>
    <section v-for="group in groups" :key="group.category" class="group" data-testid="node-category" :data-category="group.category">
      <h3>{{ group.category }}</h3>
      <div v-for="item in group.items" :key="item.type" class="node-type" draggable="true" data-testid="node-type" :data-type="item.type" :title="item.def.description" @dragstart="start($event, item.type)">
        <span class="title">{{ item.def.title }}</span>
        <small>{{ item.type }}<template v-if="item.source !== 'builtin'"> · {{ item.source }}</template></small>
      </div>
    </section>
    <p v-if="!loading && !groups.length" class="hint">No node types match.</p>
    <section v-if="broken.length" class="group broken">
      <h3>Could not load</h3>
      <div v-for="item in broken" :key="item.type" class="node-type-error" data-testid="node-type-error">
        <span class="title">{{ item.type }}</span>
        <small>{{ item.error }}</small>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nodes-panel { padding: 8px; display: flex; flex-direction: column; gap: 10px; }
.toolbar { display: flex; gap: 6px; }
.toolbar input { flex: 1; background: #17191d; color: inherit; border: 1px solid #2f333a; border-radius: 4px; padding: 5px 8px; font: inherit; }
.toolbar button { background: #23262c; color: inherit; border: 1px solid #2f333a; border-radius: 4px; padding: 0 8px; cursor: pointer; }
.group h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8b909a; }
.node-type { padding: 6px 8px; border: 1px solid #2f333a; border-radius: 4px; background: #23262c; cursor: grab; display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
.node-type:active { cursor: grabbing; }
.node-type small, .node-type-error small { color: #8b909a; font-size: 11px; }
.node-type-error { padding: 6px 8px; border: 1px solid #7a3b3b; border-radius: 4px; background: #2a1f1f; display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
.hint { color: #8b909a; margin: 0; font-size: 12px; }
</style>
