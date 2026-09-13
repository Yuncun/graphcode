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
    <!-- Each tab is a plain container holding two real buttons, so both the project and its
         close control are keyboard focusable. A button cannot legally contain another button. -->
    <div v-for="path in paths" :key="path" class="tab" :class="{ active: path === active }" :title="path">
      <button class="name" :aria-current="path === active ? 'true' : undefined" @click="emit('select', path)">
        {{ names[path] ?? path }}
      </button>
      <button class="close" aria-label="Close project" @click="emit('close', path)">×</button>
    </div>
    <button class="tab add" title="Open a project folder" @click="openByPath">+</button>
  </nav>
</template>

<style scoped>
.tabs { display: flex; gap: 2px; padding: 6px 8px 0; background: #1e2126; border-bottom: 1px solid #2f333a; }
.tab { display: inline-flex; align-items: center; gap: 8px; background: #23262c; color: #a6a9b0; border: 1px solid #2f333a; border-bottom: none; border-radius: 6px 6px 0 0; padding: 6px 10px; font: inherit; }
.tab.active { background: #17191d; color: #e8e6e1; }
.tab.add { padding-inline: 10px; cursor: pointer; }
.tab button { background: none; border: 0; margin: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; }
.close { opacity: .6; }
.close:hover { opacity: 1; }
.tab button:focus-visible, .tab.add:focus-visible { outline: 2px solid #3b7dd8; outline-offset: 1px; }
</style>
