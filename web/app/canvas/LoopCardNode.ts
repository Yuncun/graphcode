import { LGraphBadge, LGraphNode, LiteGraph, type IWidget } from "@comfyorg/litegraph";
import type { EdgeCondition, EdgeKind, LoopNode, LoopStateName, LoopType, NodeDraft } from "../daemon/protocol.ts";
import { LOOP_TYPE_LABEL, stateName } from "../daemon/protocol.ts";
import { buildDraft, draftProblems } from "../nodes/draft.ts";
import type { NodeTypeDef } from "../nodes/registry.ts";
import { valuesForLoop } from "../nodes/registry.ts";
import { defaultValues, missingRequired, type WidgetDef, type WidgetValues } from "../nodes/widgets.ts";
import type { CardRecord, Placed } from "./document.ts";
import { ageLabel } from "./time.ts";
import { liveLine } from "./liveLine.ts";
import { ButtonRowWidget } from "./widgets/ButtonRowWidget.ts";
import { FieldWidget } from "./widgets/FieldWidget.ts";
import { StatusWidget } from "./widgets/StatusWidget.ts";

export const CARD_WIDTH = 300;
/** The title field's widget name; no node type may use it. */
export const TITLE_FIELD = "__title";

export type CardMode = "draft" | "starting" | "live";
export type CardAction = "start" | "stop" | "restart";

/** What a card asks of the canvas around it. */
export interface CardHost {
  /** A value, title or size changed: the layout wants saving. */
  onChanged(card: LoopCardNode): void;
  onAction(card: LoopCardNode, action: CardAction): void;
  onEditField(card: LoopCardNode, widget: FieldWidget): void;
  /** A live card's title field was committed with a new title. */
  onRename(card: LoopCardNode, title: string): void;
}

/** What the card reads and writes on a litegraph combo, number or toggle widget. `addWidget` returns a union that is not `IWidget`; this is the part in use. */
interface ValueWidget { value?: unknown; disabled?: boolean }

export interface OutputSlotDef { name: string; kind: EdgeKind; condition: EdgeCondition }

/** The card's outputs in slot order. A drag from one of them makes a wire of that kind and condition. */
export const OUTPUT_SLOTS: readonly OutputSlotDef[] = [
  { name: "handoff", kind: "handoff", condition: "always" },
  { name: "on success", kind: "handoff", condition: "onSuccess" },
  { name: "on failure", kind: "handoff", condition: "onFailure" },
  { name: "message", kind: "message", condition: "always" },
  { name: "spawn", kind: "spawn", condition: "always" },
];

/** The output slot that draws an edge of this kind and condition. Message and spawn have one slot each, whatever the condition. */
export function outputSlotFor(kind: EdgeKind, condition: EdgeCondition): number {
  const index = OUTPUT_SLOTS.findIndex((s) => s.kind === kind && (kind !== "handoff" || s.condition === condition));
  return index === -1 ? 0 : index;
}

const typeColor: Record<LoopType, string> = { sketch: "#8a8f99", goalBased: "#2f8f6b", timeBased: "#b8860b", turnBased: "#8a5cc7", proactive: "#3b7dd8" };
const stateColor: Record<LoopStateName, string> = {
  idle: "#6b7079", running: "#3b82f6", awaitingInput: "#f59e0b", blocked: "#f59e0b", succeeded: "#22c55e",
  failed: "#ef4444", stalled: "#f59e0b", waiting: "#6b7079", stopped: "#6b7079",
};
const stateWord: Record<LoopStateName, string> = {
  idle: "IDLE", running: "RUNNING", awaitingInput: "NEEDS YOU", blocked: "BLOCKED", succeeded: "DONE",
  failed: "FAILED", stalled: "STALLED", waiting: "WAITING", stopped: "STOPPED",
};
const STOPPABLE: readonly LoopStateName[] = ["running", "awaitingInput", "blocked", "stalled", "waiting"];

/** `stopNode` resolves an unresolved loop; a loop that is idle, done, failed or already stopped has nothing to stop. */
export function canStop(node: LoopNode): boolean {
  return STOPPABLE.includes(stateName(node));
}

/**
 * litegraph asks both nodes before it makes any connection, and it uses that one path for a user
 * dragging one slot onto another as well as for the adapter drawing a link. Every link on the graph,
 * live or draft, is the adapter's to make (plan ruling 3), so a card only accepts a connection made
 * inside `connectAsAdapter`; a user's drop is reported through `onUserLinkDrop` instead.
 */
let adapterIsConnecting = false;

export function connectAsAdapter<T>(connect: () => T): T {
  adapterIsConnecting = true;
  try {
    return connect();
  } finally {
    adapterIsConnecting = false;
  }
}

export interface UserLinkDrop { from: LGraphNode; to: LGraphNode; fromSlotIndex: number }
let userLinkHandler: ((drop: UserLinkDrop) => void) | null = null;
/** GraphCanvas registers here; a user's link dropped on a card's input dot reaches it through onConnectInput. */
export function onUserLinkDrop(handler: ((drop: UserLinkDrop) => void) | null): void { userLinkHandler = handler; }

/**
 * One card: a draft the user is composing, a draft the daemon has been asked for (starting), or a
 * loop the daemon reports (live). Its widgets come from its node type: a title field, one widget per
 * `widgets` entry (text fields drawn here, combo/number/toggle from litegraph), a button row, and the
 * status block. litegraph lays them out under the slot rows and grows the card to fit; a multiline
 * field takes the room a resize gives.
 */
export class LoopCardNode extends LGraphNode {
  static override title = "Loop";
  /** litegraph reads this static for the title text (`this.constructor.title_text_color`); its default grey is faint on the type-coloured title bar. Not declared on LGraphNode, so no `override`. */
  static title_text_color = "#ffffff";
  cardMode: CardMode = "draft";
  nodeType = "";
  def: NodeTypeDef | null = null;
  loop: LoopNode | null = null;
  values: WidgetValues = {};
  host: CardHost | null = null;
  /** Set once a height came from anywhere but `fitHeight`; sync then leaves the height alone. */
  userResized = false;
  private sizing = false;
  private readonly titleField = new FieldWidget(TITLE_FIELD, "Title", "", { placeholder: "Optional; a loop names itself once it starts" });
  private readonly fields = new Map<string, FieldWidget>();
  private readonly builtins = new Map<string, ValueWidget>();
  private readonly actions = new ButtonRowWidget();
  private readonly status = new StatusWidget();

  constructor() {
    super("Loop", "graphcode/loop");
    this.resizable = true;
    // litegraph must never remove a card on its own: GraphCanvas routes the Delete key (a draft
    // goes at once, a live card asks and sends deleteNode). Copy, clone and paste are off too.
    this.block_delete = true;
    this.clonable = false;
    this.bgcolor = "#23262c";
    // addOutput grows the node to fit on its own; that growth is not the user's resize.
    this.sizing = true;
    try {
      for (const slot of OUTPUT_SLOTS) this.addOutput(slot.name, slot.kind);
      this.size = [CARD_WIDTH, this.computeSize()[1]];
    } finally {
      this.sizing = false;
    }
  }

  /** Builds the card for a node type: title field, the type's widgets in order, buttons, status. */
  setup(def: NodeTypeDef, record: CardRecord): void {
    this.def = def;
    this.nodeType = record.type;
    this.title = record.title;
    this.values = { ...defaultValues(def.widgets), ...record.values };
    // litegraph's addWidget grows the card through setSize; that growth is not the user's resize.
    this.sizing = true;
    try {
      this.widgets = [];
      this.fields.clear();
      this.builtins.clear();
      this.titleField.value = this.title;
      this.addCustomWidget(this.titleField as unknown as IWidget);
      for (const w of def.widgets) this.addWidgetFor(w);
      this.addCustomWidget(this.actions as unknown as IWidget);
      this.addCustomWidget(this.status as unknown as IWidget);
    } finally {
      this.sizing = false;
    }
    this.refresh();
    this.fitHeight();
  }

  private addWidgetFor(w: WidgetDef): void {
    const label = w.label ?? w.name;
    switch (w.type) {
      case "text": {
        const field = new FieldWidget(w.name, label, String(this.values[w.name] ?? ""), { multiline: !!w.multiline, placeholder: w.placeholder ?? "", required: !!w.required });
        this.fields.set(w.name, field);
        this.addCustomWidget(field as unknown as IWidget);
        break;
      }
      case "combo":
        this.builtins.set(w.name, this.addWidget("combo", label, String(this.values[w.name] ?? w.values?.[0] ?? ""), (value) => this.setValue(w.name, value), { values: w.values ?? [] }));
        break;
      case "number":
        // The widget shows 0 for "no value"; the record keeps null so the draft carries no interval.
        this.builtins.set(w.name, this.addWidget("number", label, Number(this.values[w.name] ?? 0), (value) => this.setValue(w.name, typeof value === "number" && value > 0 ? value : null), { min: 0, precision: 0, step: 10 }));
        break;
      case "toggle":
        this.builtins.set(w.name, this.addWidget("toggle", label, Boolean(this.values[w.name]), (value) => this.setValue(w.name, Boolean(value))));
        break;
    }
  }

  /** From a litegraph widget's callback or the editor: one value changed. */
  setValue(name: string, value: unknown): void {
    this.values[name] = value;
    this.refresh();
    this.host?.onChanged(this);
  }

  /** The editor committed a field. The title on a live card renames through the daemon and shows the daemon's title until it answers. */
  setFieldValue(widget: FieldWidget, text: string): void {
    if (widget === this.titleField) {
      const title = text.trim();
      if (this.cardMode === "live") {
        if (title && title !== this.title) this.host?.onRename(this, title);
        this.titleField.value = this.title;
        return;
      }
      this.title = title;
      this.titleField.value = title;
      this.refresh();
      this.host?.onChanged(this);
      return;
    }
    widget.value = text;
    this.setValue(widget.name, text);
  }

  /** `FieldWidget.mouse` calls this on pointer down. */
  onEditField(widget: FieldWidget): void {
    this.host?.onEditField(this, widget);
  }

  /** The daemon reports this loop. The type may be null until the packs are loaded. */
  applyLive(loop: LoopNode, def: NodeTypeDef | null): void {
    const rebuild = this.cardMode !== "live" || def !== this.def;
    this.cardMode = "live";
    this.loop = loop;
    if (rebuild) {
      if (def) this.setup(def, { type: def.type, title: loop.title, values: valuesForLoop(def, loop) });
      else this.setupBare(loop.title);
    } else if (def) {
      this.values = valuesForLoop(def, loop);
      for (const [name, field] of this.fields) field.value = String(this.values[name] ?? "");
      for (const [name, widget] of this.builtins) widget.value = this.values[name] ?? widget.value;
    }
    this.title = loop.title;
    this.titleField.value = loop.title;
    this.refresh();
  }

  /** A live loop with no loaded type: title, buttons and status only. */
  private setupBare(title: string): void {
    this.def = null;
    this.nodeType = "";
    this.title = title;
    this.values = {};
    this.sizing = true;
    try {
      this.widgets = [];
      this.fields.clear();
      this.builtins.clear();
      this.titleField.value = title;
      this.addCustomWidget(this.titleField as unknown as IWidget);
      this.addCustomWidget(this.actions as unknown as IWidget);
      this.addCustomWidget(this.status as unknown as IWidget);
    } finally {
      this.sizing = false;
    }
    this.fitHeight();
  }

  markStarting(): void {
    this.cardMode = "starting";
    this.refresh();
  }

  revertToDraft(): void {
    if (this.cardMode !== "starting") return;
    this.cardMode = "draft";
    this.refresh();
  }

  /** Everything that follows from mode, values and loop: colour, badge, read-only state, buttons, status lines. */
  refresh(): void {
    this.color = typeColor[this.loopTypeGuess()] ?? typeColor.sketch;
    const live = this.cardMode === "live";
    const starting = this.cardMode === "starting";
    for (const field of this.fields.values()) field.readOnly = live || starting;
    this.titleField.readOnly = starting;
    for (const widget of this.builtins.values()) widget.disabled = live || starting;
    if (live && this.loop) {
      const state = stateName(this.loop);
      this.badges = [new LGraphBadge({ text: stateWord[state] ?? state, bgColor: stateColor[state] ?? "#6b7079", fgColor: "#ffffff" })];
      this.actions.buttons = [
        { label: "Stop", enabled: canStop(this.loop), onClick: () => this.host?.onAction(this, "stop") },
        { label: "Restart", enabled: true, onClick: () => this.host?.onAction(this, "restart") },
      ];
      this.status.warning = "";
      this.status.live = liveLine(this.loop);
      this.status.meta = `${LOOP_TYPE_LABEL[this.loop.loopType] ?? this.loop.loopType} · ${ageLabel(this.loop.createdAt)}${this.loop.modelTier ? " · " + this.loop.modelTier : ""}`;
    } else {
      this.badges = [new LGraphBadge({ text: starting ? "STARTING" : "DRAFT", bgColor: starting ? "#3b82f6" : "#6b7079", fgColor: "#ffffff" })];
      const problems = this.problems();
      this.actions.buttons = [{ label: starting ? "Starting…" : "Start", enabled: !starting && problems.length === 0, onClick: () => this.host?.onAction(this, "start") }];
      this.status.warning = problems[0] ?? "";
      this.status.live = "";
      this.status.meta = `${this.def?.title ?? this.nodeType} · not started`;
    }
    this.setDirtyCanvas(true, true);
  }

  /** What the daemon would refuse, worded for the status line; empty when Start may be pressed. */
  problems(): string[] {
    if (!this.def) return ["This card has no node type."];
    // A blank required field is one problem, not two: the daemon's own rule for it is not asked until it is filled.
    const missing = missingRequired(this.def.widgets, this.values).map((w) => `${w.label ?? w.name} is required.`);
    if (missing.length) return missing;
    try {
      return draftProblems(buildDraft(this.def, this.values, this.title, String(this.id)));
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)];
    }
  }

  /** The draft the daemon gets. Callers check `problems()` first; this throws for a card without a type. */
  draft(): NodeDraft {
    if (!this.def) throw new Error("This card has no node type.");
    return buildDraft(this.def, this.values, this.title, String(this.id));
  }

  private loopTypeGuess(): LoopType {
    if (this.loop) return this.loop.loopType;
    if (!this.def) return "sketch";
    try { return this.def.toDraft(this.values).loopType ?? "sketch"; } catch { return "sketch"; }
  }

  record(): CardRecord {
    return { type: this.nodeType, title: this.title, values: { ...this.values } };
  }

  placed(): Placed {
    return { pos: [this.pos[0], this.pos[1]], size: [this.size[0], this.size[1]] };
  }

  /**
   * Sizes the card for its slots and widgets. A height the user chose is kept unless the widgets no
   * longer fit in it; the width never drops below litegraph's minimum for the widgets.
   */
  fitHeight(): void {
    const min = this.computeSize();
    const width = Math.max(this.size[0] || CARD_WIDTH, min[0]);
    const height = this.userResized ? Math.max(this.size[1], min[1]) : min[1];
    this.sizing = true;
    try { this.setSize([width, height]); } finally { this.sizing = false; }
  }

  /** litegraph calls this from every setSize: a pointer resize, its own grow-to-fit, or `fitHeight`. Only the last is not the user's. */
  override onResize(): void {
    if (this.sizing) return;
    this.userResized = true;
    this.host?.onChanged(this);
  }

  override onConnectInput(_targetSlot: number, _type: unknown, _output: unknown, node: unknown, slot: number): boolean {
    if (!adapterIsConnecting && node instanceof LGraphNode) userLinkHandler?.({ from: node, to: this, fromSlotIndex: slot });
    return adapterIsConnecting;
  }

  override onConnectOutput(): boolean {
    return adapterIsConnecting;
  }

  /** A draft wears a dashed outline (blue while starting) around the whole card, title bar included. */
  override onDrawForeground(ctx: CanvasRenderingContext2D): void {
    if (this.cardMode === "live" || this.flags.collapsed) return;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.cardMode === "starting" ? "#3b82f6" : "#8b909a";
    ctx.strokeRect(1, 1 - LiteGraph.NODE_TITLE_HEIGHT, this.size[0] - 2, this.size[1] + LiteGraph.NODE_TITLE_HEIGHT - 2);
    ctx.restore();
  }
}

export function registerLoopCardNode(): void {
  if (!LiteGraph.registered_node_types["graphcode/loop"]) LiteGraph.registerNodeType("graphcode/loop", LoopCardNode);
}
