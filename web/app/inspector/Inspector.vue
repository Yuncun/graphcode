<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { NodeDraft } from "../daemon/protocol.ts";
import type { NodeTypeDef } from "../nodes/registry.ts";
import { defaultValues, missingRequired } from "../nodes/widgets.ts";
import { buildDraft, draftProblems, newNodeID } from "../nodes/draft.ts";

export interface PendingCreate { def: NodeTypeDef; pos: [number, number] }

const props = defineProps<{ pending: PendingCreate | null }>();
const emit = defineEmits<{ create: [draft: NodeDraft]; cancel: [] }>();

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
</style>
