<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { LoopGraph, LoopNode, NodeDraft } from "../daemon/protocol.ts";
import type { NodeTypeDef } from "../nodes/registry.ts";
import { defaultValues, missingRequired } from "../nodes/widgets.ts";
import { buildDraft, draftProblems, newNodeID } from "../nodes/draft.ts";
import { canDetach, canStop, edgesFor, fieldsFor } from "./model.ts";

export interface PendingCreate { def: NodeTypeDef; pos: [number, number] }

const props = defineProps<{ pending: PendingCreate | null; node: LoopNode | null; graph: LoopGraph | null }>();
const emit = defineEmits<{
  create: [draft: NodeDraft];
  cancel: [];
  rename: [id: string, title: string];
  stop: [id: string];
  restart: [id: string];
  detach: [id: string];
  remove: [id: string];
  deleteEdge: [edgeID: string];
}>();

// New-loop brief (Task 8).
const title = ref("");
// `any` rather than `unknown`: the template binds these to inputs, selects and checkboxes.
const values = reactive<Record<string, any>>({});
let id = newNodeID();

watch(() => props.pending, (p) => {
  title.value = "";
  for (const key of Object.keys(values)) delete values[key];
  if (p) Object.assign(values, defaultValues(p.def.widgets));
  id = newNodeID();
}, { immediate: true });

const draft = computed<NodeDraft | null>(() => {
  if (!props.pending) return null;
  try { return buildDraft(props.pending.def, values, title.value, id); } catch { return null; }
});

const problems = computed<string[]>(() => {
  if (!props.pending) return [];
  const missing = missingRequired(props.pending.def.widgets, values).map((w) => `${w.label ?? w.name} is required.`);
  return [...missing, ...(draft.value ? draftProblems(draft.value) : ["This node type's toDraft threw."])];
});

function create() {
  if (draft.value && problems.value.length === 0) emit("create", draft.value);
}

// Selected loop.
const renameTitle = ref("");
// Reset on a new node or a title change from the daemon, not on every live-line update, so typing is not clobbered.
watch(() => [props.node?.id, props.node?.title] as const, ([, t]) => { renameTitle.value = t ?? ""; }, { immediate: true });
const fields = computed(() => (props.node ? fieldsFor(props.node) : []));
const edges = computed(() => (props.node && props.graph ? edgesFor(props.graph, props.node.id) : []));
const renameReady = computed(() => !!props.node && renameTitle.value.trim() !== "" && renameTitle.value.trim() !== props.node.title);

function confirmDelete() {
  if (!props.node) return;
  if (window.confirm(`Delete "${props.node.title}"? This removes its edges and its session and cannot be undone.`)) emit("remove", props.node.id);
}
</script>

<template>
  <aside class="inspector" data-testid="inspector">
    <template v-if="pending">
      <h2 data-testid="inspector-heading">New {{ pending.def.title }}</h2>
      <p v-if="pending.def.description" class="hint">{{ pending.def.description }}</p>
      <label class="field">
        <span>Title</span>
        <input v-model="title" data-testid="inspector-title" placeholder="Optional; a loop names itself once it starts" />
      </label>
      <label v-for="w in pending.def.widgets" :key="w.name" class="field">
        <span>{{ w.label ?? w.name }}<em v-if="w.required" title="required"> *</em></span>
        <textarea v-if="w.type === 'text' && w.multiline" v-model="values[w.name]" rows="4" :placeholder="w.placeholder" :data-testid="`widget-${w.name}`"></textarea>
        <input v-else-if="w.type === 'text'" v-model="values[w.name]" :placeholder="w.placeholder" :data-testid="`widget-${w.name}`" />
        <select v-else-if="w.type === 'combo'" v-model="values[w.name]" :data-testid="`widget-${w.name}`">
          <option v-for="v in w.values" :key="v" :value="v">{{ v }}</option>
        </select>
        <input v-else-if="w.type === 'number'" v-model.number="values[w.name]" type="number" :data-testid="`widget-${w.name}`" />
        <input v-else-if="w.type === 'toggle'" v-model="values[w.name]" type="checkbox" :data-testid="`widget-${w.name}`" />
        <small v-if="w.help">{{ w.help }}</small>
      </label>
      <ul v-if="problems.length" class="problems" data-testid="inspector-problems">
        <li v-for="p in problems" :key="p">{{ p }}</li>
      </ul>
      <div class="actions">
        <button class="primary" data-testid="inspector-create" :disabled="problems.length > 0" @click="create">Create</button>
        <button data-testid="inspector-cancel" @click="emit('cancel')">Cancel</button>
      </div>
    </template>

    <template v-else-if="node">
      <div class="rename">
        <input v-model="renameTitle" data-testid="inspector-node-title" aria-label="Title" />
        <button data-testid="inspector-rename" :disabled="!renameReady" @click="emit('rename', node.id, renameTitle.trim())">Rename</button>
      </div>
      <dl class="fields" data-testid="inspector-fields">
        <template v-for="f in fields" :key="f.label">
          <dt>{{ f.label }}</dt>
          <dd>{{ f.value }}</dd>
        </template>
      </dl>
      <h3>Edges</h3>
      <ul class="edges" data-testid="inspector-edges">
        <li v-for="e in edges" :key="e.id" data-testid="edge-row" :data-edge="e.id">
          <span class="other">{{ e.direction === "out" ? "→" : "←" }} {{ e.other }}</span>
          <small>{{ e.kind }} · {{ e.condition }}</small>
          <button data-testid="edge-delete" aria-label="Delete edge" title="Delete edge" @click="emit('deleteEdge', e.id)">×</button>
        </li>
        <li v-if="!edges.length" class="hint">No edges. Drag from an output slot onto another card.</li>
      </ul>
      <div class="actions">
        <button data-testid="action-stop" :disabled="!canStop(node)" @click="emit('stop', node.id)">Stop</button>
        <button data-testid="action-restart" @click="emit('restart', node.id)">Restart</button>
        <button data-testid="action-detach" :disabled="!canDetach(node)" @click="emit('detach', node.id)">Detach from template</button>
        <button class="danger" data-testid="action-delete" @click="confirmDelete">Delete</button>
      </div>
    </template>

    <p v-else class="hint" data-testid="inspector-hint">Select a card, or drag a node type from the Nodes tab onto the canvas.</p>
  </aside>
</template>

<style scoped>
.inspector { width: 300px; flex: none; overflow: auto; background: #1e2126; border-left: 1px solid #2f333a; padding: 10px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; }
h2 { font-size: 14px; margin: 0; }
.hint { color: #8b909a; font-size: 12px; margin: 0; }
.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #a6a9b0; }
.field em { color: #f4b58f; font-style: normal; }
.field input:not([type=checkbox]), .field textarea, .field select { background: #17191d; color: #e8e6e1; border: 1px solid #2f333a; border-radius: 4px; padding: 5px 8px; font: inherit; font-size: 13px; }
.field input[type=checkbox] { align-self: flex-start; }
.field small { color: #8b909a; }
.problems { margin: 0; padding-left: 18px; color: #f4b58f; font-size: 12px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.actions button { background: #23262c; color: inherit; border: 1px solid #2f333a; border-radius: 4px; padding: 6px 10px; font: inherit; cursor: pointer; }
.actions button.primary { background: #2f6fcf; border-color: #2f6fcf; color: white; }
.actions button:disabled { opacity: .5; cursor: default; }
.actions button:focus-visible { outline: 2px solid #3b7dd8; outline-offset: 1px; }
.rename { display: flex; gap: 6px; }
.rename input { flex: 1; min-width: 0; background: #17191d; color: #e8e6e1; border: 1px solid #2f333a; border-radius: 4px; padding: 5px 8px; font: inherit; }
.rename button { background: #23262c; color: inherit; border: 1px solid #2f333a; border-radius: 4px; padding: 0 10px; font: inherit; cursor: pointer; }
.rename button:disabled { opacity: .5; cursor: default; }
.fields { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 0; font-size: 12px; }
.fields dt { color: #8b909a; }
.fields dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
h3 { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8b909a; margin: 4px 0 0; }
.edges { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.edges li { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; padding: 4px 6px; border: 1px solid #2f333a; border-radius: 4px; }
.edges small { color: #8b909a; }
.edges button { background: none; border: 0; color: inherit; cursor: pointer; opacity: .6; font: inherit; }
.edges button:hover { opacity: 1; }
.actions button.danger { border-color: #7a3b3b; color: #f4b58f; }
</style>
