<script setup lang="ts">
defineProps<{ paths: string[]; names: Record<string, string>; active: string | null }>();
const emit = defineEmits<{ select: [path: string]; close: [path: string]; open: [path: string] }>();

function openByPath() {
  const path = window.prompt("Absolute path of the project folder to open");
  if (path && path.trim().startsWith("/")) emit("open", path.trim());
}
</script>

<template>
  <nav class="tabs">
    <button
      v-for="path in paths"
      :key="path"
      class="tab"
      :class="{ active: path === active }"
      :title="path"
      @click="emit('select', path)"
    >
      <span class="name">{{ names[path] ?? path }}</span>
      <span class="close" role="button" aria-label="Close project" @click.stop="emit('close', path)">×</span>
    </button>
    <button class="tab add" title="Open a project folder" @click="openByPath">+</button>
  </nav>
</template>

<style scoped>
.tabs { display: flex; gap: 2px; padding: 6px 8px 0; background: #1e2126; border-bottom: 1px solid #2f333a; }
.tab { display: inline-flex; align-items: center; gap: 8px; background: #23262c; color: #a6a9b0; border: 1px solid #2f333a; border-bottom: none; border-radius: 6px 6px 0 0; padding: 6px 10px; font: inherit; cursor: pointer; }
.tab.active { background: #17191d; color: #e8e6e1; }
.tab.add { padding-inline: 10px; }
.close { opacity: .6; }
.close:hover { opacity: 1; }
</style>
