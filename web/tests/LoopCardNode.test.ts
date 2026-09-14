// @vitest-environment jsdom
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LGraph, LGraphBadge, LiteGraph } from "@comfyorg/litegraph";
import { canStop, CARD_WIDTH, LoopCardNode, onUserLinkDrop, OUTPUT_SLOTS, outputSlotFor, registerLoopCardNode, TITLE_FIELD, type CardAction, type UserLinkDrop } from "../app/canvas/LoopCardNode.ts";
import { FieldWidget } from "../app/canvas/widgets/FieldWidget.ts";
import type { LoopNode } from "../app/daemon/protocol.ts";
import { validateNodeType, type NodeTypeDef } from "../app/nodes/registry.ts";

const load = async (type: string): Promise<NodeTypeDef> => validateNodeType(type, await import(pathToFileURL(path.resolve(import.meta.dirname, "..", "nodes", `${type}.js`)).href));
let goal: NodeTypeDef;
let timed: NodeTypeDef;
beforeAll(async () => { goal = await load("agent/goal"); timed = await load("agent/timed"); });

/** A CardHost whose four methods are typed mocks (a bare `vi.fn()` does not satisfy CardHost's call signatures). */
const host = () => ({
  onChanged: vi.fn<(card: LoopCardNode) => void>(),
  onAction: vi.fn<(card: LoopCardNode, action: CardAction) => void>(),
  onEditField: vi.fn<(card: LoopCardNode, widget: FieldWidget) => void>(),
  onRename: vi.fn<(card: LoopCardNode, title: string) => void>(),
});

function card(h: ReturnType<typeof host> = host()): LoopCardNode {
  registerLoopCardNode();
  const graph = new LGraph();
  const c = LiteGraph.createNode("graphcode/loop") as LoopCardNode;
  c.host = h;
  graph.add(c);
  return c;
}

const live = (extra: Partial<LoopNode> = {}): LoopNode => ({ id: "L1", title: "Build it", loopType: "goalBased", state: { running: {} }, createdAt: 0, pausesBeforeWritesOnly: false, pilotState: "notPiloted", goal: { summary: "Build the feature", predicate: "pnpm test" }, modelTier: "capable", ...extra });

const widgetNames = (c: LoopCardNode) => (c.widgets ?? []).map((w) => w.name);
const field = (c: LoopCardNode, name: string) => (c.widgets ?? []).find((w): w is FieldWidget => w instanceof FieldWidget && w.name === name)!;
/** litegraph types `badges` as badge-or-thunk; every card sets plain badges. */
const badgeText = (c: LoopCardNode) => (c.badges[0] as LGraphBadge).text;

describe("a draft card", () => {
  it("builds a title field, the type's widgets in order, the buttons and the status block", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    expect(widgetNames(c)).toEqual([TITLE_FIELD, "summary", "predicate", "Model", "Backend", "actions", "status"]);
    expect(c.cardMode).toBe("draft");
    expect(c.nodeType).toBe("agent/goal");
    expect(c.values).toEqual({ summary: "", predicate: "", model: "standard", backend: "claudeCode" });
    expect(field(c, "summary").multiline).toBe(true);
    expect(field(c, "summary").readOnly).toBe(false);
    expect(c.size[0]).toBe(CARD_WIDTH);
    expect(c.size[1]).toBeGreaterThan(OUTPUT_SLOTS.length * LiteGraph.NODE_SLOT_HEIGHT);
    expect(badgeText(c)).toBe("DRAFT");
    expect(c.resizable).toBe(true);
  });

  it("names its problems and disables Start until they are fixed", () => {
    const h = host();
    const c = card(h);
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    expect(c.problems()).toEqual(["Goal is required."]);
    const start = (c.widgets ?? []).find((w) => w.name === "actions") as unknown as { buttons: Array<{ label: string; enabled: boolean; onClick(): void }> };
    expect(start.buttons.map((b) => [b.label, b.enabled])).toEqual([["Start", false]]);
    c.setValue("summary", "Ship it");
    expect(c.problems()).toEqual([]);
    expect(start.buttons[0]!.enabled).toBe(true);
    expect(h.onChanged).toHaveBeenCalledWith(c);
    start.buttons[0]!.onClick();
    expect(h.onAction).toHaveBeenCalledWith(c, "start");
    expect(c.draft()).toMatchObject({ id: String(c.id), title: "", loopType: "goalBased", goal: { summary: "Ship it" } });
  });

  it("takes the title from its field and reports a record and a placement", () => {
    const h = host();
    const c = card(h);
    c.setup(goal, { type: "agent/goal", title: "Old", values: { summary: "x" } });
    c.pos = [10, 20];
    c.setFieldValue(field(c, TITLE_FIELD), "  Changelog ");
    expect(c.title).toBe("Changelog");
    expect(h.onRename).not.toHaveBeenCalled();
    expect(c.record()).toEqual({ type: "agent/goal", title: "Changelog", values: { summary: "x", predicate: "", model: "standard", backend: "claudeCode" } });
    expect(c.placed()).toEqual({ pos: [10, 20], size: [c.size[0], c.size[1]] });
  });

  it("asks its host to open the editor for a field", () => {
    const h = host();
    const c = card(h);
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    c.onEditField(field(c, "summary"));
    expect(h.onEditField).toHaveBeenCalledWith(c, field(c, "summary"));
  });

  it("goes to starting and back", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "", values: { summary: "x" } });
    c.markStarting();
    expect(c.cardMode).toBe("starting");
    expect(badgeText(c)).toBe("STARTING");
    const start = (c.widgets ?? []).find((w) => w.name === "actions") as unknown as { buttons: Array<{ enabled: boolean }> };
    expect(start.buttons[0]!.enabled).toBe(false);
    c.revertToDraft();
    expect(c.cardMode).toBe("draft");
    expect(start.buttons[0]!.enabled).toBe(true);
  });

  it("keeps a height the user chose, and never shrinks below what its widgets need", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    expect(c.userResized).toBe(false);
    const min = c.size[1];
    c.setSize([CARD_WIDTH, min + 100]);
    expect(c.userResized).toBe(true);
    c.fitHeight();
    expect(c.size[1]).toBe(min + 100);
    c.addInput("handoff", "handoff");
    c.fitHeight();
    expect(c.size[1]).toBeGreaterThanOrEqual(min + 100);
  });
});

describe("a live card", () => {
  it("shows the loop's values read-only, its state, and Stop and Restart", () => {
    const h = host();
    const c = card(h);
    c.applyLive(live(), goal);
    expect(c.cardMode).toBe("live");
    expect(c.title).toBe("Build it");
    expect(c.values).toEqual({ summary: "Build the feature", predicate: "pnpm test", model: "capable", backend: "claudeCode" });
    expect(field(c, "summary").value).toBe("Build the feature");
    expect(field(c, "summary").readOnly).toBe(true);
    expect(field(c, TITLE_FIELD).readOnly).toBe(false);
    const combo = (c.widgets ?? []).find((w) => w.name === "Model") as unknown as { value: unknown; disabled?: boolean };
    expect(combo.value).toBe("capable");
    expect(combo.disabled).toBe(true);
    expect(badgeText(c)).toBe("RUNNING");
    const actions = (c.widgets ?? []).find((w) => w.name === "actions") as unknown as { buttons: Array<{ label: string; enabled: boolean; onClick(): void }> };
    expect(actions.buttons.map((b) => [b.label, b.enabled])).toEqual([["Stop", true], ["Restart", true]]);
    actions.buttons[0]!.onClick();
    expect(h.onAction).toHaveBeenCalledWith(c, "stop");
    c.applyLive(live({ state: { idle: {} } }), goal);
    expect(actions.buttons[0]!.enabled).toBe(false);
  });

  it("renames through its host and keeps the daemon's title until it answers", () => {
    const h = host();
    const c = card(h);
    c.applyLive(live(), goal);
    c.setFieldValue(field(c, TITLE_FIELD), "Build v2");
    expect(h.onRename).toHaveBeenCalledWith(c, "Build v2");
    expect(c.title).toBe("Build it");
    expect(field(c, TITLE_FIELD).value).toBe("Build it");
    c.setFieldValue(field(c, TITLE_FIELD), "   ");
    expect(h.onRename).toHaveBeenCalledTimes(1);
  });

  it("draws without fields until its type is known, then with them", () => {
    const c = card();
    c.applyLive(live(), null);
    expect(widgetNames(c)).toEqual([TITLE_FIELD, "actions", "status"]);
    c.applyLive(live(), goal);
    expect(widgetNames(c)).toEqual([TITLE_FIELD, "summary", "predicate", "Model", "Backend", "actions", "status"]);
  });

  it("flips a draft to live on the daemon's echo, keeping its size", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "Changelog", values: { summary: "Write it" } });
    c.setSize([CARD_WIDTH, c.size[1] + 40]);
    const tall = c.size[1];
    c.applyLive(live({ title: "Changelog", goal: { summary: "Write it" } }), goal);
    expect(c.cardMode).toBe("live");
    expect(c.size[1]).toBe(tall);
    expect(field(c, "summary").readOnly).toBe(true);
  });

  it("shows a timed loop's interval as a number widget", () => {
    const c = card();
    c.applyLive(live({ loopType: "timeBased", triggerPrompt: "/loop 1h tidy", heartbeatIntervalSeconds: 900, goal: undefined }), timed);
    const interval = (c.widgets ?? []).find((w) => w.name === "Every (seconds)") as unknown as { value: unknown };
    expect(interval.value).toBe(900);
  });
});

describe("canStop", () => {
  it("allows Stop only while the loop is unresolved and running in some sense", () => {
    for (const state of ["running", "awaitingInput", "blocked", "stalled", "waiting"]) expect(canStop(live({ state: { [state]: {} } }))).toBe(true);
    for (const state of ["idle", "succeeded", "failed", "stopped"]) expect(canStop(live({ state: { [state]: {} } }))).toBe(false);
  });
});

describe("card slots", () => {
  it("has one output per edge kind and handoff condition, in a fixed order", () => {
    expect(OUTPUT_SLOTS.map((s) => s.name)).toEqual(["handoff", "on success", "on failure", "message", "spawn"]);
    expect(card().outputs.map((o) => o.name)).toEqual(["handoff", "on success", "on failure", "message", "spawn"]);
  });

  it("maps an edge's kind and condition to its output slot", () => {
    expect(outputSlotFor("handoff", "always")).toBe(0);
    expect(outputSlotFor("handoff", "onSuccess")).toBe(1);
    expect(outputSlotFor("handoff", "onFailure")).toBe(2);
    expect(outputSlotFor("message", "onSuccess")).toBe(3);
    expect(outputSlotFor("spawn", "onFailure")).toBe(4);
  });
});

describe("onUserLinkDrop", () => {
  it("reports a user's drag onto a card's input dot, and never actually connects it", () => {
    const drops: UserLinkDrop[] = [];
    onUserLinkDrop((d) => drops.push(d));
    const graph = new LGraph();
    const a = LiteGraph.createNode("graphcode/loop") as LoopCardNode;
    const b = LiteGraph.createNode("graphcode/loop") as LoopCardNode;
    graph.add(a); graph.add(b);
    b.addInput("handoff", "handoff");
    expect(a.connect(0, b, 0)).toBe(null);
    expect(drops).toEqual([{ from: a, to: b, fromSlotIndex: 0 }]);
    onUserLinkDrop(null);
  });
});
