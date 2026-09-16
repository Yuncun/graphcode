<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LGraph, LGraphCanvas, LiteGraph } from "@comfyorg/litegraph";
import "@comfyorg/litegraph/style.css";
import type { LoopGraph } from "../daemon/protocol.ts";
import type { NodeTypeEntry } from "../nodes/registry.ts";
import { NODE_TYPE_MIME } from "../sidebar/library.ts";
import { GraphAdapter } from "./adapter.ts";
import type { CanvasDoc } from "./document.ts";
import { FieldEditor } from "./FieldEditor.ts";
import { getLayout, putLayout } from "./layoutClient.ts";
import { linkRequestFrom, type DraggedLink, type LinkRequest } from "./linkRequest.ts";
import { LoopCardNode, onUserLinkDrop, TITLE_FIELD, type CardHost } from "./LoopCardNode.ts";
import { createSaveScheduler } from "./saveScheduler.ts";
import { applyViewport, fitToNodes, readViewport, type Viewport } from "./viewport.ts";
import { FieldWidget } from "./widgets/FieldWidget.ts";

interface ProjectView {
  /** The project path, so a save or a count is never keyed by a prop that may have moved on. */
  project: string;
  adapter: GraphAdapter;
  layout: CanvasDoc;
  /** null until the first fit; then the last pan and zoom seen on this project. */
  viewport: Viewport | null;
}

/** What the toolbar shows: how many drafts and draft wires wait for Start. */
export interface DocumentCounts { drafts: number; wires: number }

const SAVE_DELAY_MS = 500;
/**
 * litegraph draws a card's title bar above node.pos, and the state badge above the title bar.
 * The layout puts its first row at y = 40, so both would hang off the top of the viewport if
 * the view started exactly at the corner of the graph. Start it a little way in instead.
 */
const VIEW_MARGIN: [number, number] = [24, LiteGraph.NODE_TITLE_HEIGHT + 24];

const props = defineProps<{ graph: LoopGraph; nodeTypes: NodeTypeEntry[] }>();
const emit = defineEmits<{
  select: [id: string | null];
  rename: [id: string, title: string];
  /** The Delete key on live cards: the daemon's to delete, so App asks first. */
  deleteLive: [ids: string[]];
  /** A live edge picked off its input: likewise. */
  deleteEdge: [edgeID: string];
  documentChanged: [counts: DocumentCounts];
  problem: [message: string];
}>();
const hostEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
let canvas: LGraphCanvas | null = null;
let editor: FieldEditor | null = null;
let resizeObserver: ResizeObserver | null = null;
/**
 * One litegraph graph per project path, so switching tabs keeps each project's cards, drafts and
 * viewport. The map holds the in-flight load of the saved layout rather than the finished view,
 * so two shows of the same project cannot race into building two graphs for it.
 */
const views = new Map<string, Promise<ProjectView>>();
/** Views whose layout has loaded; the exposed methods read from here because they cannot await. */
const resolved = new Map<string, ProjectView>();
/** Debounced per project, so a move in one project cannot cancel another's pending write. */
const saves = createSaveScheduler({ delayMs: SAVE_DELAY_MS, save });
/** Counts show() calls, so a slow one cannot put its project back on screen after a newer one. */
let shows = 0;
/** The view whose graph the canvas is drawing. */
let shown: ProjectView | null = null;

/** What every card asks of the canvas. */
const host: CardHost = {
  onChanged: () => changed(),
  onEditField: (card, widget) => {
    if (canvas && editor) editor.open(canvas, card, widget, (text) => card.setFieldValue(widget, text));
  },
  onRename: (card, title) => emit("rename", String(card.id), title),
};

function viewFor(project: string): Promise<ProjectView> {
  let view = views.get(project);
  if (!view) {
    view = getLayout(project).then((layout) => {
      const adapter = new GraphAdapter(new LGraph(), host);
      adapter.types = props.nodeTypes;
      return { project, adapter, layout, viewport: null };
    });
    views.set(project, view);
    view.then((v) => resolved.set(project, v));
  }
  return view;
}

/** A starting card is no longer the user's to start, so it is not counted; the badge falls the moment Start is pressed. */
function counts(view: ProjectView): DocumentCounts {
  return { drafts: view.adapter.cards().filter((c) => c.cardMode === "draft").length, wires: view.adapter.draftEdges().length };
}

/** The document changed by the user's hand: save it, and tell the toolbar what waits for Start. */
function changed(): void {
  const view = shown;
  if (!view) return;
  view.adapter.refreshInputLabels();
  saves.schedule(view.project);
  emit("documentChanged", counts(view));
}

async function show(graph: LoopGraph): Promise<void> {
  const token = ++shows;
  const view = await viewFor(graph.project.path);
  view.adapter.types = props.nodeTypes;
  const changed = view.adapter.sync(graph, view.layout);
  if (token !== shows || !canvas) return;
  if (canvas.graph !== view.adapter.lgraph) {
    editor?.close(true);
    // litegraph keeps one pan and zoom per canvas, not per graph, so carry them by hand.
    if (shown) shown.viewport = readViewport(canvas.ds);
    canvas.setGraph(view.adapter.lgraph);
    shown = view;
    if (view.viewport) applyViewport(canvas.ds, view.viewport);
  }
  // First time this project has cards on screen: bring them all into view. litegraph only
  // measures a card's boundingRect once per render frame, so a card just added by sync() above
  // still reads as zero-sized until computeVisibleNodes() has measured it at least once.
  if (!view.viewport && view.adapter.lgraph.nodes.length) {
    canvas.computeVisibleNodes();
    if (fitToNodes(canvas, view.adapter.lgraph.nodes)) view.viewport = readViewport(canvas.ds);
  }
  canvas.setDirty(true, true);
  if (changed) saves.schedule(view.project);
  emit("documentChanged", counts(view));
}

async function save(project: string): Promise<void> {
  const view = await views.get(project);
  if (!view) return;
  view.layout = view.adapter.document();
  try {
    await putLayout(project, view.layout);
  } catch (error) {
    emit("problem", `the canvas could not be saved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes(NODE_TYPE_MIME)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

/** A node type dropped from the library: a draft card, at once, where the cursor is. Nothing is sent. */
function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData(NODE_TYPE_MIME);
  const view = shown;
  if (!type || !canvas || !view) return;
  event.preventDefault();
  const [x, y] = canvas.convertEventToCanvasOffset(event);
  const card = view.adapter.addDraft(type, [x, y]);
  if (!card) {
    emit("problem", `node type ${type} is not loaded`);
    return;
  }
  canvas.selectNode(card);
  changed();
}

/** A drag from an output onto a card: a draft wire, whatever the two cards are (plan ruling 2). */
function draftLink(request: LinkRequest): void {
  const view = shown;
  if (!view) return;
  const from = view.adapter.card(request.from);
  const to = view.adapter.card(request.to);
  if (!from || !to) return;
  if (view.adapter.addDraftLink(from, from.outputSlot(request.kind, request.condition), to)) changed();
  else emit("problem", "That connection already exists or its ports cannot be connected.");
}

function fit(): void {
  const parent = canvasEl.value?.parentElement;
  if (!canvas || !parent) return;
  const { width, height } = parent.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  // Both drawing buffers use physical pixels; graph coordinates and pointer events use CSS pixels.
  canvas.resize(Math.round(width * ratio), Math.round(height * ratio));
  canvas.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  canvas.setDirty(true, true);
}

/**
 * A widget's `last_y` is only assigned inside litegraph's own draw pass, which normally runs on
 * the next animation frame; a card added this instant (a drop, a workflow load) has not had one
 * yet, so `widgetBox` would read every widget's stale, undrawn position. Forcing one
 * synchronous frame here makes every widget's geometry correct the moment a browser test asks for it.
 */
function forceLayout(): void {
  canvas?.draw(true, true);
}

onMounted(async () => {
  const view = await viewFor(props.graph.project.path);
  const element = canvasEl.value;
  const hostElement = hostEl.value;
  if (!element || !hostElement) return;
  // The constructor starts litegraph's render loop; stopRendering() below pairs with it.
  canvas = new LGraphCanvas(element, view.adapter.lgraph);
  editor = new FieldEditor(hostElement);
  // litegraph stops drawing text below this scale (its default is 0.6); the fit floor is 0.6,
  // so text survives the fit and one zoom step out.
  canvas.low_quality_zoom_threshold = 0.5;
  shown = view;
  // litegraph's own menus would remove, clone or recolour a card, or delete a link, on the canvas
  // alone (plan ruling 1). Every action here has one path: the card's buttons, the Delete key, or a wire drag.
  canvas.allow_searchbox = false;
  canvas.show_info = false;
  canvas.processContextMenu = () => {};
  canvas.showLinkMenu = () => false;
  LiteGraph.release_link_on_empty_shows_menu = false;
  canvas.ds.offset = [...VIEW_MARGIN];
  canvas.onNodeMoved = () => changed();
  // litegraph calls this on both a select and a deselectAll (an empty-canvas click goes through
  // deselectAll, which skips onNodeDeselected entirely); a multi-selection shows the hint (null).
  canvas.onSelectionChange = (selected) => {
    const ids = Object.keys(selected);
    emit("select", ids.length === 1 ? ids[0]! : null);
  };
  // The editor sits over its field. litegraph draws a frame whenever the canvas is dirty, and a pan
  // or zoom marks it dirty, so placing the editor again on every drawn frame keeps it on its field.
  canvas.onDrawForeground = () => editor?.reposition();
  // The Delete key. litegraph would remove every selected node; `block_delete` on the cards makes
  // that a no-op, so this decides instead: a draft goes at once, a live card is the daemon's.
  const clearSelection = canvas.deleteSelected.bind(canvas);
  canvas.deleteSelected = () => {
    const current = shown;
    if (!canvas || !current || editor?.isOpen()) return;
    const cards = [...canvas.selectedItems].filter((item): item is LoopCardNode => item instanceof LoopCardNode);
    const drafts = cards.filter((c) => c.cardMode !== "live").map((c) => String(c.id));
    const live = cards.filter((c) => c.cardMode === "live").map((c) => String(c.id));
    if (drafts.length) {
      current.adapter.removeDrafts(drafts);
      changed();
    }
    clearSelection();
    if (live.length) emit("deleteLive", live);
  };
  // A user's drop on a card's *input dot* (only a card with an existing wire has one) never
  // reaches the link connector's events; LoopCardNode reports it here instead.
  onUserLinkDrop(({ from, to, fromSlotIndex }) => {
    const request = linkRequestFrom([{ node: from, fromSlotIndex, toType: "input" }], to);
    if (request) draftLink(request);
  });
  const events = canvas.linkConnector.events;
  // A link dropped on a card's body: draw the draft wire ourselves and let litegraph connect nothing.
  events.addEventListener("dropped-on-node", (event) => {
    event.preventDefault();
    const view = shown;
    if (!canvas || !view) return;
    // renderLinks' type also covers a drag to/from a subgraph boundary node, which this app never
    // shows; every real drag here starts and ends on an LGraphNode card.
    const request = linkRequestFrom(canvas.linkConnector.renderLinks as unknown as DraggedLink[], event.detail.node);
    if (!request) return; // dropped on its own origin, or from no slot: a moved wire stays where it was
    const from = view.adapter.card(request.from);
    const to = view.adapter.card(request.to);
    if (!from || !to) return;
    if (!view.adapter.addDraftLink(from, from.outputSlot(request.kind, request.condition), to)) {
      emit("problem", "That connection already exists or its ports cannot be connected.");
      return;
    }
    // A wire being moved off an input still holds its old link: litegraph only lets go of it inside
    // the drop code that preventDefault skipped. Now that the new wire is drawn, let go of the old
    // one (a no-op for a wire dragged fresh from an output), or a move would duplicate the wire.
    canvas.linkConnector.disconnectLinks();
    changed();
  });
  // Picking a wire off its input. A draft wire is the user's to move or drop (litegraph carries
  // it; dropping it on empty canvas removes it). A live edge is the daemon's, so App asks first.
  events.addEventListener("before-move-input", (event) => {
    const current = shown;
    if (!current) return;
    const linkID = (event.detail as { link?: { id: number } }).link?.id;
    if (linkID === undefined || current.adapter.isDraftLink(linkID)) return;
    event.preventDefault();
    const edgeID = current.adapter.edgeIDForLink(linkID);
    if (edgeID) emit("deleteEdge", edgeID);
  });
  // An output carries every wire leaving it; moving all of them at once is not a gesture here.
  events.addEventListener("before-move-output", (event) => event.preventDefault());
  // Whatever litegraph did with a dropped wire, reconcile: adopt a moved draft wire, forget a dropped one, prune empty inputs.
  events.addEventListener("after-drop-links", () => {
    const current = shown;
    if (!current) return;
    current.adapter.sync(props.graph, current.layout);
    changed();
  });
  fit();
  resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(hostElement);
  window.addEventListener("resize", fit);
  await show(props.graph);
});

watch(() => props.graph, (graph, previous) => {
  // A deep change to the same graph reports the same object as `previous`, so this only fires
  // when the tab really changed: save the project being left before its debounce runs out.
  if (previous && previous.project.path !== graph.project.path) saves.flush(previous.project.path);
  void show(graph);
}, { deep: true });

// A project's cards are drawn from its node types; when a pack loads or reloads, every view learns it.
watch(() => props.nodeTypes, (types) => {
  for (const view of resolved.values()) view.adapter.types = types;
  void show(props.graph);
});

defineExpose({
  /** App.vue closes a project that is not the one on screen without the watch above ever firing, so it calls this. */
  flushSave: (project: string) => saves.flush(project),
  positions: (project: string) => resolved.get(project)?.adapter.document().nodes,
  viewport: () => canvas ? { scale: canvas.ds.scale, offset: [canvas.ds.offset[0], canvas.ds.offset[1]] as [number, number], width: canvas.canvas.width, height: canvas.canvas.height } : undefined,
  adapter: (project: string) => resolved.get(project)?.adapter,
  /** App changed a project's document through its adapter (a start, a load): save and recount. */
  touch: (project: string) => {
    if (shown && shown.project === project) changed();
    else saves.schedule(project);
  },
  cards: (project: string) => resolved.get(project)?.adapter.cards().map((c) => ({ id: String(c.id), mode: c.cardMode, title: c.title, values: { ...c.values }, pos: [c.pos[0], c.pos[1]] as [number, number], size: [c.size[0], c.size[1]] as [number, number] })),
  document: (project: string) => resolved.get(project)?.adapter.document(),
  /** A widget's box in node space, so a browser test can click into it: a text field's box, or a litegraph widget's row. */
  widgetBox: (project: string, id: string, name: string): [number, number, number, number] | null => {
    forceLayout();
    const card = resolved.get(project)?.adapter.card(id);
    const widget = name === TITLE_FIELD ? card?.titleEditor : card?.widgets?.find((w) => w.name === name);
    if (!card || !widget) return null;
    if (widget instanceof FieldWidget) return widget.boxRect(card);
    const y = widget.last_y ?? widget.y;
    return [15, y, card.size[0] - 30, widget.computedHeight ?? LiteGraph.NODE_WIDGET_HEIGHT];
  },
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", fit);
  resizeObserver?.disconnect();
  onUserLinkDrop(null);
  editor?.close(false);
  canvas?.stopRendering();
  canvas = null;
});
</script>

<template>
  <div ref="hostEl" class="canvas-host" @dragover="onDragOver" @drop="onDrop"><canvas ref="canvasEl" tabindex="-1"></canvas></div>
</template>

<style scoped>
.canvas-host { flex: 1; min-height: 0; position: relative; overflow: hidden; }
/* Focusable (tabindex, in the template) so litegraph's own canvas.focus() on pointer down actually
   works and its keydown listener (bound to this element) receives Delete/Backspace; litegraph draws
   its own selection outline, so the browser's default focus ring would be redundant chrome. */
canvas { display: block; width: 100%; height: 100%; outline: none; }
</style>

<style>
/* Created by FieldEditor.ts, outside Vue's scoping. */
.field-editor { position: absolute; box-sizing: border-box; margin: 0; background: #17191d; color: #e8e6e1; border: 1px solid #3b7dd8; border-radius: 2px; font-family: -apple-system, "Helvetica Neue", sans-serif; resize: none; outline: none; z-index: 2; }
</style>
