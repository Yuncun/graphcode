import { LGraph, LiteGraph, type LinkId, type LLink } from "@comfyorg/litegraph";
import type { LoopEdge, LoopGraph } from "../daemon/protocol.ts";
import { newNodeID } from "../nodes/draft.ts";
import { defByName, typeForLoop, type NodeTypeEntry } from "../nodes/registry.ts";
import { emptyCanvasDoc, instantiate, loadOffset, workflowFile, type CanvasDoc, type CardRecord, type CardSnapshot, type EdgeRecord, type Placed, type WorkflowFile } from "./document.ts";
import { CARD_WIDTH, connectAsAdapter, LoopCardNode, registerLoopCardNode, type CardHost } from "./LoopCardNode.ts";
import { placeNodes } from "./placement.ts";

const conditionColor: Record<string, string> = { always: "#cfd3d8", onSuccess: "#22c55e", onFailure: "#ef4444" };
/** A wire the daemon has not been told about. */
export const DRAFT_LINK_COLOR = "#6b7079";

const sameEdge = (edge: LoopEdge, record: EdgeRecord) => edge.from === record.from && edge.to === record.to && edge.kind === record.kind && edge.condition === record.condition;

/** Drafts from canvas.json whose node type is not loaded: kept out of the graph and written back untouched (plan ruling 10). */
interface Orphans { drafts: Record<string, CardRecord>; nodes: Record<string, Placed>; edges: EdgeRecord[] }

/**
 * The canvas is the document. Live cards and live links mirror the daemon's graph; draft cards and
 * draft links are the user's and survive every sync until Start, the Delete key or a drag-off removes
 * them. Every link on the graph is made here (plan ruling 3): live ones are known by edge id, draft
 * ones by link id, and anything else found on the graph is adopted as a draft.
 */
export class GraphAdapter {
  readonly lgraph: LGraph;
  /** The loaded node types; GraphCanvas sets this whenever they change. */
  types: NodeTypeEntry[] = [];
  private readonly host: CardHost;
  private readonly newID: () => string;
  private readonly linkByEdge = new Map<string, LLink>();
  private readonly draftLinks = new Map<LinkId, EdgeRecord>();
  /** The layout's drafts wait here until the types are loaded, so a save before that still carries them. */
  private pendingLayout: CanvasDoc | null = null;
  private restored = false;
  private orphans: Orphans = { drafts: {}, nodes: {}, edges: [] };

  constructor(lgraph: LGraph, host: CardHost, newID: () => string = newNodeID) {
    this.lgraph = lgraph;
    this.host = host;
    this.newID = newID;
    registerLoopCardNode();
  }

  cards(): LoopCardNode[] {
    return this.lgraph.nodes.filter((node): node is LoopCardNode => node instanceof LoopCardNode);
  }

  card(id: string): LoopCardNode | null {
    const node = this.lgraph.getNodeById(id);
    return node instanceof LoopCardNode ? node : null;
  }

  drafts(): LoopCardNode[] {
    return this.cards().filter((card) => card.cardMode !== "live");
  }

  draftEdges(): EdgeRecord[] {
    return [...this.draftLinks.values()].map((edge) => ({ ...edge }));
  }

  isDraftLink(linkID: LinkId): boolean {
    return this.draftLinks.has(linkID);
  }

  edgeIDForLink(linkID: LinkId): string | null {
    for (const [edgeID, link] of this.linkByEdge) if (link.id === linkID) return edgeID;
    return null;
  }

  /**
   * Overlays the daemon's graph: live cards and links follow it, drafts and draft links are left alone.
   * Returns whether the document changed under the daemon's hand, so the caller can save it.
   */
  sync(graph: LoopGraph, layout: CanvasDoc): boolean {
    let changed = false;
    if (!this.restored) this.pendingLayout = layout;
    const positions = placeNodes(graph, layout.nodes);
    const wanted = new Set(graph.nodes.map((node) => node.id));
    for (const card of this.cards()) if (card.cardMode === "live" && !wanted.has(String(card.id))) this.removeCard(card);
    for (const loop of graph.nodes) {
      const card = this.card(loop.id) ?? this.newCard(loop.id, positions.get(loop.id) ?? [40, 40], layout.nodes[loop.id]?.size);
      if (card.cardMode !== "live") changed = true;
      card.applyLive(loop, typeForLoop(this.types, loop.loopType));
    }
    // Drafts come after the live cards, so a draft wire into a live card finds its end.
    if (!this.restored && this.types.length) {
      this.restored = true;
      this.pendingLayout = null;
      this.restoreDrafts(layout);
    }
    // A draft wire litegraph removed (dropped on empty canvas) is forgotten; one the daemon now
    // reports as an edge is the daemon's from here on and is redrawn below as a live link.
    for (const [linkID, record] of [...this.draftLinks]) {
      if (!this.lgraph.links.get(linkID)) { this.draftLinks.delete(linkID); changed = true; }
      else if (graph.edges.some((edge) => sameEdge(edge, record))) { this.dropLink(linkID); changed = true; }
    }

    const wantedEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
    for (const [edgeID, link] of [...this.linkByEdge]) {
      const edge = wantedEdges.get(edgeID);
      // Stale if the edge is gone, its link was removed some other way, or the edge now points
      // somewhere else (from/to/kind changed under the same edge id): recreated below.
      const stale = !edge
        || !this.lgraph.links.get(link.id)
        || link.origin_id !== edge.from
        || link.target_id !== edge.to
        || link.origin_slot !== this.card(edge.from)?.outputSlot(edge.kind, edge.condition);
      if (stale) {
        if (this.lgraph.links.get(link.id)) this.lgraph.removeLink(link.id);
        this.linkByEdge.delete(edgeID);
      }
    }
    for (const edge of graph.edges) {
      if (this.linkByEdge.has(edge.id)) continue;
      const from = this.card(edge.from);
      const to = this.card(edge.to);
      if (!from || !to) continue;
      const index = to.addEdgeInput(edge.kind);
      const link = connectAsAdapter(() => from.connect(from.outputSlot(edge.kind, edge.condition), to, index));
      if (!link) { to.removeEdgeInput(index); continue; }
      this.linkByEdge.set(edge.id, link);
    }
    this.adoptUnknownLinks();
    this.refreshInputLabels();
    // Colour follows the edge's condition every sync, not just at creation, so an edge whose
    // condition changes under a stable id (no retarget) still gets repainted.
    for (const [edgeID, link] of this.linkByEdge) link.color = conditionColor[wantedEdges.get(edgeID)!.condition] ?? conditionColor.always;
    for (const card of this.cards()) card.pruneInputs();
    this.lgraph.setDirtyCanvas(true, true);
    return changed;
  }

  /** A draft card at `pos`. `record` supplies title and values when restoring or loading; `id` and `size` likewise. Null when the type is not loaded. */
  addDraft(type: string, pos: [number, number], record?: Partial<CardRecord>, id: string = this.newID(), size?: [number, number]): LoopCardNode | null {
    const def = defByName(this.types, type);
    if (!def) return null;
    const card = this.newCard(id, pos, size);
    card.setup(def, { type, title: record?.title ?? "", values: record?.values ?? {} });
    return card;
  }

  /** A draft wire from `from`'s output `slot` to a new input on `to`. Null for a card wired to itself or a slot that does not exist. */
  addDraftLink(from: LoopCardNode, slot: number, to: LoopCardNode, preserve = false): LLink | null {
    const def = from.outputDefinition(slot);
    if (!def || from === to) return null;
    if (!preserve && from.hasOutputLinkTo(to, slot)) return null;
    const index = to.addEdgeInput(def.kind);
    const link = connectAsAdapter(() => from.connect(slot, to, index));
    if (!link) {
      to.removeEdgeInput(index);
      return null;
    }
    link.color = DRAFT_LINK_COLOR;
    this.draftLinks.set(link.id, { from: String(from.id), to: String(to.id), kind: def.kind, condition: def.condition });
    this.labelInput(link);
    to.fitHeight();
    return link;
  }

  /** Removes the named cards that are drafts (or starting); live ids are ignored, since those are the daemon's to delete. A card they were wired into loses that input row at once. */
  removeDrafts(ids: string[]): void {
    let removed = false;
    for (const id of ids) {
      const card = this.card(id);
      if (!card || card.cardMode === "live") continue;
      this.removeCard(card);
      removed = true;
    }
    if (removed) for (const card of this.cards()) card.pruneInputs();
  }

  markStarting(ids: string[]): void {
    for (const id of ids) this.card(id)?.markStarting();
  }

  /** Returns the ids that went back to draft: those named, or every starting card when none are. */
  revertStarting(ids?: string[]): string[] {
    const reverted: string[] = [];
    for (const card of this.cards()) {
      if (card.cardMode !== "starting" || (ids && !ids.includes(String(card.id)))) continue;
      card.revertToDraft();
      reverted.push(String(card.id));
    }
    return reverted;
  }

  /** canvas.json: every card's layout, the drafts and draft wires, and any orphans carried through. */
  document(): CanvasDoc {
    const doc = emptyCanvasDoc();
    for (const card of this.cards()) {
      doc.nodes[String(card.id)] = card.placed();
      if (card.cardMode !== "live") doc.drafts[String(card.id)] = card.record();
    }
    doc.draftEdges = this.draftEdges();
    const pending = this.restored ? this.orphans : this.pendingOrphans();
    Object.assign(doc.nodes, pending.nodes);
    Object.assign(doc.drafts, pending.drafts);
    doc.draftEdges.push(...pending.edges.map((edge) => ({ ...edge })));
    return doc;
  }

  /** Before the types load, every draft in the layout is still pending: the file must keep them all. */
  private pendingOrphans(): Orphans {
    const layout = this.pendingLayout;
    if (!layout) return { drafts: {}, nodes: {}, edges: [] };
    const nodes: Record<string, Placed> = {};
    for (const id of Object.keys(layout.drafts)) if (layout.nodes[id]) nodes[id] = layout.nodes[id]!;
    return { drafts: { ...layout.drafts }, nodes, edges: [...layout.draftEdges] };
  }

  /** A workflow file: every card with a type as a draft definition, and every wire, live or draft. */
  workflow(name: string): WorkflowFile {
    const cards: CardSnapshot[] = this.cards().filter((card) => card.def).map((card) => ({ id: String(card.id), record: card.record(), placed: card.placed() }));
    const live: EdgeRecord[] = [...this.linkByEdge.values()].map((link) => {
      const slot = this.card(String(link.origin_id))!.outputDefinition(link.origin_slot)!;
      return { from: String(link.origin_id), to: String(link.target_id), kind: slot.kind, condition: slot.condition };
    });
    return workflowFile(name, cards, [...this.draftEdges(), ...live]);
  }

  /** Loads a workflow as drafts with fresh ids, one gap right of what is on the canvas. Returns the new ids in the file's order. */
  loadWorkflow(file: WorkflowFile): string[] {
    const offset = loadOffset(this.cards().map((card) => card.placed()), Object.values(file.cards), CARD_WIDTH);
    const { cards, edges } = instantiate(file, this.newID, offset);
    const made = new Map<string, LoopCardNode>();
    for (const c of cards) {
      const card = this.addDraft(c.record.type, c.placed.pos, c.record, c.id, c.placed.size);
      if (card) made.set(c.id, card);
    }
    for (const edge of edges) {
      const from = made.get(edge.from);
      const to = made.get(edge.to);
      if (from && to) this.addDraftLink(from, from.outputSlot(edge.kind, edge.condition), to, true);
    }
    return [...made.keys()];
  }

  private newCard(id: string, pos: [number, number], size?: [number, number]): LoopCardNode {
    const card = LiteGraph.createNode("graphcode/loop") as LoopCardNode;
    card.host = this.host;
    card.id = id;
    card.pos = [pos[0], pos[1]];
    if (size) {
      card.userResized = true;
      card.size = [size[0], size[1]];
    }
    this.lgraph.add(card);
    return card;
  }

  private removeCard(card: LoopCardNode): void {
    const id = String(card.id);
    for (const [linkID, edge] of [...this.draftLinks]) if (edge.from === id || edge.to === id) this.draftLinks.delete(linkID);
    for (const [edgeID, link] of [...this.linkByEdge]) if (String(link.origin_id) === id || String(link.target_id) === id) this.linkByEdge.delete(edgeID);
    this.lgraph.remove(card);
  }

  private dropLink(linkID: LinkId): void {
    if (this.lgraph.links.get(linkID)) this.lgraph.removeLink(linkID);
    this.draftLinks.delete(linkID);
  }

  refreshInputLabels(): void {
    for (const link of this.lgraph.links.values()) this.labelInput(link);
  }

  private labelInput(link: LLink): void {
    const from = this.card(String(link.origin_id));
    const to = this.card(String(link.target_id));
    const spec = from?.outputDefinition(link.origin_slot);
    const input = to?.inputs[link.target_slot];
    if (!from || !spec || !input) return;
    const source = from.getTitle();
    const limit = spec.condition === "always" ? 24 : 12;
    const name = source.length > limit ? `${source.slice(0, limit - 3)}...` : source;
    const outcome = spec.condition === "onSuccess" ? " succeeds" : spec.condition === "onFailure" ? " fails" : "";
    input.label = spec.kind === "handoff" ? `After ${name}${outcome}` : `${spec.kind === "message" ? "From" : "Copy for"} ${name}${outcome}`;
  }

  /** Anything on the graph that is neither a live link nor a known draft is the user's: adopt it, or drop it if it makes no sense. */
  private adoptUnknownLinks(): void {
    const live = new Set([...this.linkByEdge.values()].map((link) => link.id));
    for (const [linkID, link] of [...this.lgraph.links]) {
      if (live.has(linkID) || this.draftLinks.has(linkID)) continue;
      const from = this.card(String(link.origin_id));
      const slot = from?.outputDefinition(link.origin_slot);
      const to = this.card(String(link.target_id));
      if (!slot || !from || !to || from === to) {
        this.lgraph.removeLink(linkID);
        continue;
      }
      link.color = DRAFT_LINK_COLOR;
      this.draftLinks.set(linkID, { from: String(from.id), to: String(to.id), kind: slot.kind, condition: slot.condition });
    }
  }

  private restoreDrafts(layout: CanvasDoc): void {
    this.orphans = { drafts: {}, nodes: {}, edges: [] };
    for (const [id, record] of Object.entries(layout.drafts)) {
      // A draft the daemon has since reported is live; its stale entry goes on the next save.
      if (this.card(id)) continue;
      const placed = layout.nodes[id];
      if (this.addDraft(record.type, placed?.pos ?? [40, 40], record, id, placed?.size)) continue;
      this.orphans.drafts[id] = record;
      if (placed) this.orphans.nodes[id] = placed;
    }
    for (const edge of layout.draftEdges) {
      const from = this.card(edge.from);
      const to = this.card(edge.to);
      if (from && to) this.addDraftLink(from, from.outputSlot(edge.kind, edge.condition), to, true);
      else if (edge.from in this.orphans.drafts || edge.to in this.orphans.drafts) this.orphans.edges.push(edge);
    }
  }
}
