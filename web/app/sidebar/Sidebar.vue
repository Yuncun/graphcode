<script setup lang="ts">
import { ref } from "vue";
type Tab = "nodes" | "workflows";
const tab = ref<Tab>("nodes");
</script>

<template>
  <aside class="sidebar" data-testid="sidebar">
    <div class="sidebar-tabs" role="tablist">
      <button role="tab" data-testid="sidebar-tab-nodes" :aria-selected="tab === 'nodes'" :class="{ active: tab === 'nodes' }" @click="tab = 'nodes'">Nodes</button>
      <button role="tab" data-testid="sidebar-tab-workflows" :aria-selected="tab === 'workflows'" :class="{ active: tab === 'workflows' }" @click="tab = 'workflows'">Workflows</button>
    </div>
    <div class="sidebar-body">
      <slot :name="tab" />
    </div>
  </aside>
</template>

<style scoped>
.sidebar { width: 240px; flex: none; display: flex; flex-direction: column; background: #1e2126; border-right: 1px solid #2f333a; min-height: 0; }
.sidebar-tabs { display: flex; border-bottom: 1px solid #2f333a; }
.sidebar-tabs button { flex: 1; background: none; border: 0; padding: 8px 0; color: #8b909a; font: inherit; cursor: pointer; border-bottom: 2px solid transparent; }
.sidebar-tabs button.active { color: #e8e6e1; border-bottom-color: #3b7dd8; }
.sidebar-tabs button:focus-visible { outline: 2px solid #3b7dd8; outline-offset: -2px; }
.sidebar-body { flex: 1; overflow: auto; min-height: 0; }
</style>
