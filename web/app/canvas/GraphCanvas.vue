<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LGraph, LGraphCanvas, LiteGraph } from "@comfyorg/litegraph";
import "@comfyorg/litegraph/style.css";
import type { LoopGraph } from "../daemon/protocol.ts";
import { NODE_TYPE_MIME } from "../sidebar/library.ts";
import { GraphAdapter, type CanvasDoc } from "./adapter.ts";
import { getLayout, putLayout } from "./layoutClient.ts";
import { createSaveScheduler } from "./saveScheduler.ts";
import { applyViewport, fitToNodes, readViewport, type Viewport } from "./viewport.ts";

interface ProjectView {
  adapter: GraphAdapter;
  layout: CanvasDoc;
  /** null until the first fit; then the last pan and zoom seen on this project. */
  viewport: Viewport | null;
  /** Positions reserved for nodes the daemon has not reported yet, keyed by the id the app minted. */
  pending: Map<string, [number, number]>;
}

const SAVE_DELAY_MS = 500;
/**
 * litegraph draws a card's title bar above node.pos, and the state badge above the title bar.
 * The layout puts its first row at y = 40, so both would hang off the top of the viewport if
 * the view started exactly at the corner of the graph. Start it a little way in instead.
 */
const VIEW_MARGIN: [number, number] = [24, LiteGraph.NODE_TITLE_HEIGHT + 24];

const props = defineProps<{ graph: LoopGraph }>();
const emit = defineEmits<{ dropType: [payload: { type: string; pos: [number, number] }] }>();
const canvasEl = ref<HTMLCanvasElement | null>(null);
let canvas: LGraphCanvas | null = null;
/**
 * One litegraph graph per project path, so switching tabs keeps each project's cards and
 * viewport. The map holds the in-flight load of the saved layout rather than the finished
 * view, so two shows of the same project cannot race into building two graphs for it.
 */
const views = new Map<string, Promise<ProjectView>>();
/** Views whose layout has loaded; the debug hooks read from here because they cannot await. */
const resolved = new Map<string, ProjectView>();
/** Debounced per project, so a move in one project cannot cancel another's pending write. */
const saves = createSaveScheduler({ delayMs: SAVE_DELAY_MS, save });
/** Counts show() calls, so a slow one cannot put its project back on screen after a newer one. */
let shows = 0;
/** The view whose graph the canvas is drawing, so its pan and zoom can be saved when the tab changes. */
let shown: ProjectView | null = null;

function viewFor(project: string): Promise<ProjectView> {
  let view = views.get(project);
  if (!view) {
    view = getLayout(project).then((layout) => ({ adapter: new GraphAdapter(new LGraph()), layout, viewport: null, pending: new Map() }));
    views.set(project, view);
    view.then((v) => resolved.set(project, v));
  }
  return view;
}

async function show(graph: LoopGraph): Promise<void> {
  const token = ++shows;
  const view = await viewFor(graph.project.path);
  view.adapter.sync(graph, view.layout);
  if (token !== shows || !canvas) return;
  if (canvas.graph !== view.adapter.lgraph) {
    // litegraph keeps one pan and zoom per canvas, not per graph, so carry them by hand.
    if (shown) shown.viewport = readViewport(canvas.ds);
    canvas.setGraph(view.adapter.lgraph);
    shown = view;
    if (view.viewport) applyViewport(canvas.ds, view.viewport);
  }
  // First time this project has cards on screen: bring them all into view. litegraph only
  // measures a card's boundingRect once per render frame, so a card just added by sync() above
  // still reads as zero-sized until computeVisibleNodes() (normally run inside the render loop)
  // has measured it at least once.
  if (!view.viewport && view.adapter.lgraph.nodes.length) {
    canvas.computeVisibleNodes();
    if (fitToNodes(canvas, view.adapter.lgraph.nodes)) view.viewport = readViewport(canvas.ds);
  }
  canvas.setDirty(true, true);
}

async function save(project: string): Promise<void> {
  const view = await views.get(project);
  if (!view) return;
  const doc = view.adapter.positions();
  for (const [id, pos] of view.pending) {
    if (doc.nodes[id]) view.pending.delete(id);
    else doc.nodes[id] = { pos };
  }
  view.layout = doc;
  try {
    await putLayout(project, view.layout);
  } catch (error) {
    console.warn("graphcode: could not save the canvas layout", error);
  }
}

/**
 * The card for a node the daemon is about to report must land where it was dropped: the position is
 * written into the layout now under the id the app minted, and `placeNodes` honours it on the sync
 * that brings the node.
 */
function reserveLayout(project: string, id: string, pos: [number, number]): void {
  const view = resolved.get(project);
  if (!view) return;
  view.layout.nodes[id] = { pos };
  view.pending.set(id, pos);
  saves.schedule(project);
}

function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes(NODE_TYPE_MIME)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData(NODE_TYPE_MIME);
  if (!type || !canvas) return;
  event.preventDefault();
  // Graph-space point under the cursor; it becomes the new card's top-left.
  const [x, y] = canvas.convertEventToCanvasOffset(event);
  emit("dropType", { type, pos: [x, y] });
}

function fit(): void {
  const parent = canvasEl.value?.parentElement;
  if (!canvas || !parent) return;
  // litegraph's resize() owns the element's width and height: it also resizes the offscreen
  // background canvas that links and the grid are drawn on, and it does nothing at all when
  // the element already has the size being asked for.
  canvas.resize(parent.clientWidth, parent.clientHeight);
  canvas.setDirty(true, true);
}

onMounted(async () => {
  const view = await viewFor(props.graph.project.path);
  const element = canvasEl.value;
  if (!element) return;
  // The constructor starts litegraph's render loop; stopRendering() below pairs with it.
  canvas = new LGraphCanvas(element, view.adapter.lgraph);
  // litegraph stops drawing text below this scale (its default is 0.6); the fit floor is 0.6,
  // so text survives the fit and one zoom step out.
  canvas.low_quality_zoom_threshold = 0.5;
  shown = view;
  canvas.allow_searchbox = false;
  canvas.show_info = false;
  canvas.ds.offset = [...VIEW_MARGIN];
  canvas.onNodeMoved = () => saves.schedule(props.graph.project.path);
  fit();
  window.addEventListener("resize", fit);
  await show(props.graph);
});

watch(() => props.graph, (graph, previous) => {
  // A deep change to the same graph reports the same object as `previous`, so this only fires
  // when the tab really changed: save the project being left before its debounce runs out.
  if (previous && previous.project.path !== graph.project.path) saves.flush(previous.project.path);
  void show(graph);
}, { deep: true });

/**
 * App.vue closes a project that is not the one on screen without the watch above ever firing,
 * so it calls this: write the move the user made just before closing, and drop the timer with it.
 */
defineExpose({
  flushSave: (project: string) => saves.flush(project),
  positions: (project: string) => resolved.get(project)?.adapter.positions().nodes,
  viewport: () => canvas ? { scale: canvas.ds.scale, offset: [canvas.ds.offset[0], canvas.ds.offset[1]] as [number, number], width: canvas.canvas.width, height: canvas.canvas.height } : undefined,
  reserveLayout,
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", fit);
  canvas?.stopRendering();
  canvas = null;
});
</script>

<template>
  <div class="canvas-host" @dragover="onDragOver" @drop="onDrop"><canvas ref="canvasEl"></canvas></div>
</template>

<style scoped>
.canvas-host { flex: 1; min-height: 0; position: relative; }
canvas { display: block; width: 100%; height: 100%; }
</style>
