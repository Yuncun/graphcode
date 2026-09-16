import type { EdgeCondition, EdgeKind } from "../daemon/protocol.ts";
import type { WidgetValues } from "../nodes/widgets.ts";

/** Where a card sits; `size` is absent until a card has been drawn or resized. */
export interface Placed { pos: [number, number]; size?: [number, number] }
/** A card as a definition: enough to make a draft of it again. */
export interface CardRecord { type: string; title: string; values: WidgetValues }
export interface EdgeRecord { from: string; to: string; kind: EdgeKind; condition: EdgeCondition }

/**
 * `<project>/.graphcode/canvas.json`, version 2: the layout of every card, plus the drafts and the
 * draft wires, which exist nowhere else (the daemon has never heard of them). `orphans` are drafts
 * whose node type was not loaded when the file was read; they are written back untouched.
 */
export interface CanvasDoc {
  version: 2;
  nodes: Record<string, Placed>;
  drafts: Record<string, CardRecord>;
  draftEdges: EdgeRecord[];
}

/** A saved workflow: every card as a draft definition with its layout, and every wire. Ids are local to the file. */
export interface WorkflowFile { version: 1; name: string; cards: Record<string, CardRecord & Placed>; edges: EdgeRecord[] }

/** A card as the adapter reports it for saving. */
export interface CardSnapshot { id: string; record: CardRecord; placed: Placed }

export const emptyCanvasDoc = (): CanvasDoc => ({ version: 2, nodes: {}, drafts: {}, draftEdges: [] });

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const KINDS: readonly string[] = ["handoff", "message", "spawn"];
const CONDITIONS: readonly string[] = ["always", "onSuccess", "onFailure"];

function readPlaced(raw: unknown): Placed | null {
  if (!isObject(raw) || !isPoint(raw.pos)) return null;
  const placed: Placed = { pos: [raw.pos[0], raw.pos[1]] };
  if (isPoint(raw.size)) placed.size = [raw.size[0], raw.size[1]];
  return placed;
}

function readRecord(raw: unknown): CardRecord | null {
  if (!isObject(raw) || typeof raw.type !== "string" || typeof raw.title !== "string" || !isObject(raw.values)) return null;
  return { type: raw.type, title: raw.title, values: { ...raw.values } };
}

function readEdge(raw: unknown): EdgeRecord | null {
  if (!isObject(raw) || typeof raw.from !== "string" || typeof raw.to !== "string") return null;
  if (!KINDS.includes(raw.kind as string) || !CONDITIONS.includes(raw.condition as string)) return null;
  return { from: raw.from, to: raw.to, kind: raw.kind as EdgeKind, condition: raw.condition as EdgeCondition };
}

/**
 * Reads a version 2 document, dropping entries that are not well formed. A version 1 file — a
 * phase 1 layout, made for cards a third as tall — is not read at all: its positions would overlap
 * phase 2's taller cards, so it yields the empty document and phase 2's placement lays the cards
 * out afresh. Anything else is also the empty document.
 */
export function readCanvasDoc(raw: unknown): CanvasDoc {
  const doc = emptyCanvasDoc();
  if (!isObject(raw) || raw.version !== 2 || !isObject(raw.nodes)) return doc;
  for (const [id, node] of Object.entries(raw.nodes)) {
    const placed = readPlaced(node);
    if (placed) doc.nodes[id] = placed;
  }
  if (isObject(raw.drafts)) {
    for (const [id, record] of Object.entries(raw.drafts)) {
      const r = readRecord(record);
      if (r) doc.drafts[id] = r;
    }
  }
  if (Array.isArray(raw.draftEdges)) doc.draftEdges = raw.draftEdges.map(readEdge).filter((e): e is EdgeRecord => e !== null);
  return doc;
}

/** Throws with a message fit for the footer when the value is not a workflow file. */
export function readWorkflowFile(raw: unknown): WorkflowFile {
  if (!isObject(raw) || raw.version !== 1 || typeof raw.name !== "string" || !isObject(raw.cards) || !Array.isArray(raw.edges)) {
    throw new Error("not a workflow file");
  }
  const cards: WorkflowFile["cards"] = Object.fromEntries(Object.entries(raw.cards).map(([id, card]) => {
    const record = readRecord(card);
    const placed = readPlaced(card);
    if (!record || !placed) throw new Error(`card ${id} is not well formed`);
    if (isObject(card) && "size" in card && (!isPoint(card.size) || card.size.some((n) => n <= 0))) throw new Error(`card ${id} is not well formed`);
    return [id, { ...record, ...placed }];
  }));
  const edges = raw.edges.map((edge, i) => {
    const e = readEdge(edge);
    if (!e || e.from === e.to || !Object.hasOwn(cards, e.from) || !Object.hasOwn(cards, e.to)) throw new Error(`edge ${i} is not well formed`);
    return e;
  });
  return { version: 1, name: raw.name, cards, edges };
}

/** The file for a canvas: every card with its layout, and the wires whose both ends are among them. */
export function workflowFile(name: string, cards: CardSnapshot[], edges: EdgeRecord[]): WorkflowFile {
  const file: WorkflowFile = { version: 1, name, cards: {}, edges: [] };
  for (const c of cards) {
    file.cards[c.id] = { type: c.record.type, title: c.record.title, values: { ...c.record.values }, pos: [c.placed.pos[0], c.placed.pos[1]], ...(c.placed.size ? { size: [c.placed.size[0], c.placed.size[1]] as [number, number] } : {}) };
  }
  const ids = new Set(cards.map((c) => c.id));
  file.edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ ...e }));
  return file;
}

/** Fresh ids so the same file can be loaded twice; positions shifted by `offset`; nothing shared with the file. */
export function instantiate(file: WorkflowFile, newID: () => string, offset: [number, number]): { cards: CardSnapshot[]; edges: EdgeRecord[] } {
  const ids = new Map(Object.keys(file.cards).map((id) => [id, newID()]));
  const cards: CardSnapshot[] = Object.entries(file.cards).map(([id, c]) => ({
    id: ids.get(id)!,
    record: { type: c.type, title: c.title, values: structuredClone(c.values) },
    placed: { pos: [c.pos[0] + offset[0], c.pos[1] + offset[1]], ...(c.size ? { size: [c.size[0], c.size[1]] as [number, number] } : {}) },
  }));
  const edges = file.edges.map((e) => ({ ...e, from: ids.get(e.from)!, to: ids.get(e.to)! }));
  return { cards, edges };
}

/** Space between a canvas's rightmost card and a loaded workflow's leftmost one. */
const LOAD_GAP = 40;

/**
 * Where a loaded workflow lands: at its own positions on an empty canvas; otherwise one gap to the right
 * of everything already there, its top row aligned with the highest existing card. A card without a
 * saved size is as wide as a new card (`defaultWidth`).
 */
export function loadOffset(existing: Placed[], incoming: Placed[], defaultWidth = 300): [number, number] {
  if (!existing.length || !incoming.length) return [0, 0];
  const right = Math.max(...existing.map((p) => p.pos[0] + (p.size?.[0] ?? defaultWidth)));
  const top = Math.min(...existing.map((p) => p.pos[1]));
  const left = Math.min(...incoming.map((p) => p.pos[0]));
  const incomingTop = Math.min(...incoming.map((p) => p.pos[1]));
  return [right + LOAD_GAP - left, top - incomingTop];
}
