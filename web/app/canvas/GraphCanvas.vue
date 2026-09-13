<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LGraph, LGraphCanvas, LiteGraph } from "@comfyorg/litegraph";
import "@comfyorg/litegraph/style.css";
import type { LoopGraph } from "../daemon/protocol.ts";
import { GraphAdapter, type CanvasDoc } from "./adapter.ts";
import { getLayout, putLayout } from "./layoutClient.ts";

interface ProjectView { adapter: GraphAdapter; layout: CanvasDoc }

const SAVE_DELAY_MS = 500;
/**
 * litegraph draws a card's title bar above node.pos, and the state badge above the title bar.
 * The layout puts its first row at y = 40, so both would hang off the top of the viewport if
 * the view started exactly at the corner of the graph. Start it a little way in instead.
 */
const VIEW_MARGIN: [number, number] = [24, LiteGraph.NODE_TITLE_HEIGHT + 24];

const props = defineProps<{ graph: LoopGraph }>();
const canvasEl = ref<HTMLCanvasElement | null>(null);
let canvas: LGraphCanvas | null = null;
/**
 * One litegraph graph per project path, so switching tabs keeps each project's cards and
 * viewport. The map holds the in-flight load of the saved layout rather than the finished
 * view, so two shows of the same project cannot race into building two graphs for it.
 */
const views = new Map<string, Promise<ProjectView>>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Counts show() calls, so a slow one cannot put its project back on screen after a newer one. */
let shows = 0;

function viewFor(project: string): Promise<ProjectView> {
  let view = views.get(project);
  if (!view) {
    view = getLayout(project).then((layout) => ({ adapter: new GraphAdapter(new LGraph()), layout }));
    views.set(project, view);
  }
  return view;
}

async function show(graph: LoopGraph): Promise<void> {
  const token = ++shows;
  const view = await viewFor(graph.project.path);
  view.adapter.sync(graph, view.layout);
  if (token !== shows || !canvas) return;
  if (canvas.graph !== view.adapter.lgraph) canvas.setGraph(view.adapter.lgraph);
  canvas.setDirty(true, true);
}

function scheduleSave(project: string): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save(project);
  }, SAVE_DELAY_MS);
}

async function save(project: string): Promise<void> {
  const view = await views.get(project);
  if (!view) return;
  view.layout = view.adapter.positions();
  try {
    await putLayout(project, view.layout);
  } catch (error) {
    console.warn("graphcode: could not save the canvas layout", error);
  }
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
  canvas.allow_searchbox = false;
  canvas.ds.offset = [...VIEW_MARGIN];
  canvas.onNodeMoved = () => scheduleSave(props.graph.project.path);
  fit();
  window.addEventListener("resize", fit);
  await show(props.graph);
});

watch(() => props.graph, (graph) => { void show(graph); }, { deep: true });

onBeforeUnmount(() => {
  window.removeEventListener("resize", fit);
  canvas?.stopRendering();
  canvas = null;
});
</script>

<template>
  <div class="canvas-host"><canvas ref="canvasEl"></canvas></div>
</template>

<style scoped>
.canvas-host { flex: 1; min-height: 0; position: relative; }
canvas { display: block; width: 100%; height: 100%; }
</style>
