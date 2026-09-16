// @vitest-environment jsdom
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LGraph, LGraphBadge, LiteGraph } from "@comfyorg/litegraph";
import { CARD_WIDTH, LoopCardNode, onUserLinkDrop, OUTPUT_SLOTS, registerLoopCardNode, TITLE_FIELD, type UserLinkDrop } from "../app/canvas/LoopCardNode.ts";
import { FieldWidget } from "../app/canvas/widgets/FieldWidget.ts";
import type { LoopNode } from "../app/daemon/protocol.ts";
import { validateNodeType, type NodeTypeDef } from "../app/nodes/registry.ts";

const load = async (type: string): Promise<NodeTypeDef> => validateNodeType(type, await import(pathToFileURL(path.resolve(import.meta.dirname, "..", "nodes", `${type}.js`)).href));
let goal: NodeTypeDef;
let timed: NodeTypeDef;
beforeAll(async () => { goal = await load("agent/goal"); timed = await load("agent/timed"); });

/** A CardHost whose three methods are typed mocks (a bare `vi.fn()` does not satisfy CardHost's call signatures). */
const host = () => ({
  onChanged: vi.fn<(card: LoopCardNode) => void>(),
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
const field = (c: LoopCardNode, name: string) => name === TITLE_FIELD ? c.titleEditor : (c.widgets ?? []).find((w): w is FieldWidget => w instanceof FieldWidget && w.name === name)!;
/** litegraph types `badges` as badge-or-thunk; every card sets plain badges. */
const badgeText = (c: LoopCardNode) => (c.badges[0] as LGraphBadge).text;

describe("a draft card", () => {
  it("uses the type's default name when an unnamed composite needs a daemon title", async () => {
    const def = await load("group/composite");
    const c = card();
    c.setup(def, { type: def.type, title: "", values: {} });
    expect(c.problems()).toEqual([]);
    expect(c.draft().title).toBe(def.title);
    expect(c.record().title).toBe("");
  });
  it("edits an optional name in the header without a second title field", () => {
    const h = host();
    const c = card(h);
    c.setup(goal, { type: "agent/goal", title: "", values: { summary: "Ship it" } });
    expect(widgetNames(c)).not.toContain(TITLE_FIELD);
    expect(c.getTitle()).toBe("Goal loop");
    expect(c.record().title).toBe("");
    c.onNodeTitleDblClick();
    expect(h.onEditField).toHaveBeenCalledWith(c, c.titleEditor);
    expect(c.titleEditor.boxRect(c)[1]).toBeLessThan(0);
    c.setFieldValue(c.titleEditor, "  Ship release  ");
    expect(c.getTitle()).toBe("Ship release");
    c.setFieldValue(c.titleEditor, "");
    expect(c.getTitle()).toBe("Goal loop");
    expect(c.draft().title).toBe("");
  });

  it("keeps actionable warnings without repeating the draft type and state", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    const status = c.widgets!.find((w) => w.name === "status") as unknown as { warning: string; meta: string; computeLayoutSize(): { minHeight: number } };
    expect(status.warning).toBe("Goal is required.");
    expect(status.meta).toBe("");
    c.setValue("summary", "Ship it");
    expect(status.computeLayoutSize().minHeight).toBe(0);
    expect(badgeText(c)).toBe("DRAFT");
  });

  it("builds the type's body fields and the status block", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    expect(widgetNames(c)).toEqual(["summary", "predicate", "Model", "Backend", "status"]);
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

  it("names its problems until they are fixed", () => {
    const h = host();
    const c = card(h);
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    expect(c.problems()).toEqual(["Goal is required."]);
    c.setValue("summary", "Ship it");
    expect(c.problems()).toEqual([]);
    expect(h.onChanged).toHaveBeenCalledWith(c);
    expect(c.draft()).toMatchObject({ id: String(c.id), title: "", loopType: "goalBased", goal: { summary: "Ship it" } });
  });

  it("takes the title from its header editor and reports a record and a placement", () => {
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

  it("adds and prunes edge inputs without counting the growth as a user resize", () => {
    const h = host();
    const c = card(h);
    c.setup(goal, { type: "agent/goal", title: "", values: {} });
    const min = c.size[1];
    for (let i = 0; i < 7; i++) expect(c.addEdgeInput("handoff")).toBe(i);
    expect(c.inputs).toHaveLength(7);
    expect(c.size[1]).toBeGreaterThan(min);
    expect(c.userResized).toBe(false);
    expect(h.onChanged).not.toHaveBeenCalled();
    c.removeEdgeInput(6);
    expect(c.inputs).toHaveLength(6);
    c.pruneInputs();
    expect(c.inputs).toHaveLength(0);
    expect(c.size[1]).toBe(min);
    expect(c.userResized).toBe(false);
    expect(h.onChanged).not.toHaveBeenCalled();
  });

  it("goes to starting and back", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "", values: { summary: "x" } });
    c.markStarting();
    expect(c.cardMode).toBe("starting");
    expect(badgeText(c)).toBe("STARTING");
    c.revertToDraft();
    expect(c.cardMode).toBe("draft");
    expect(badgeText(c)).toBe("DRAFT");
    c.applyLive(live(), goal);
    c.markStarting();
    expect(c.cardMode).toBe("live");
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
  it("shows the loop's values read-only and its state", () => {
    const h = host();
    const c = card(h);
    c.applyLive(live(), goal);
    expect(c.cardMode).toBe("live");
    expect(c.title).toBe("Build it");
    expect(c.values).toEqual({ summary: "Build the feature", predicate: "pnpm test", model: "capable", backend: "claudeCode" });
    expect(field(c, "summary").value).toBe("Build the feature");
    expect(field(c, "summary").readOnly).toBe(true);
    expect(field(c, TITLE_FIELD).readOnly).toBe(false);
    const model = field(c, "Model");
    expect(model.value).toBe("capable");
    expect(model.readOnly).toBe(true);
    expect(badgeText(c)).toBe("RUNNING");
    c.applyLive(live({ state: { idle: {} } }), goal);
    expect(badgeText(c)).toBe("IDLE");
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
    expect(h.onRename).toHaveBeenLastCalledWith(c, "Goal loop");
    expect(h.onRename).toHaveBeenCalledTimes(2);
  });

  it("draws without fields until its type is known, then with them", () => {
    const c = card();
    c.applyLive(live(), null);
    expect(widgetNames(c)).toEqual(["status"]);
    c.applyLive(live(), goal);
    expect(widgetNames(c)).toEqual(["summary", "predicate", "Model", "Backend", "status"]);
  });

  it("flips a draft to live on the daemon's echo, keeping its size", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "Changelog", values: { summary: "Write it" } });
    c.setSize([CARD_WIDTH, c.size[1] + 100]);
    const tall = c.size[1];
    c.applyLive(live({ title: "Changelog", goal: { summary: "Write it" } }), goal);
    expect(c.cardMode).toBe("live");
    expect(c.size[1]).toBe(tall);
    expect(field(c, "summary").readOnly).toBe(true);
  });

  it("shows a timed loop's interval as a read-only field", () => {
    const c = card();
    c.applyLive(live({ loopType: "timeBased", triggerPrompt: "/loop 1h tidy", heartbeatIntervalSeconds: 900, goal: undefined }), timed);
    const interval = field(c, "Every (seconds)");
    expect(interval.value).toBe("900");
    expect(interval.readOnly).toBe(true);
  });

  it("a starting card keeps its litegraph widgets and ignores a change", () => {
    const c = card();
    c.setup(goal, { type: "agent/goal", title: "", values: { summary: "x" } });
    c.markStarting();
    const model = (c.widgets ?? []).find((w) => w.name === "Model") as unknown as { callback?: (value: unknown) => void; value: unknown };
    model.callback?.("capable");
    expect(c.values.model).toBe("standard");
    expect(model.value).toBe("standard");
  });
});

describe("card slots", () => {
  it("uses the node definition's outputs rather than giving a timed loop success and failure ports", () => {
    const c = card();
    c.setup(timed, { type: "agent/timed", title: "", values: {} });
    expect(c.outputs.map((o) => o.name)).toEqual(["handoff", "message", "spawn"]);
  });
  it("has one output per edge kind and handoff condition, in a fixed order", () => {
    expect(OUTPUT_SLOTS.map((s) => s.name)).toEqual(["handoff", "on success", "on failure", "message", "spawn"]);
    expect(card().outputs.map((o) => o.name)).toEqual(["handoff", "on success", "on failure", "message", "spawn"]);
  });

  it("maps an edge's kind and condition to its output slot", () => {
    const c = card();
    expect(c.outputSlot("handoff", "always")).toBe(0);
    expect(c.outputSlot("handoff", "onSuccess")).toBe(1);
    expect(c.outputSlot("handoff", "onFailure")).toBe(2);
    expect(c.outputSlot("message", "always")).toBe(3);
    expect(c.outputSlot("spawn", "always")).toBe(4);
    expect(c.outputSlot("message", "onSuccess")).toBe(5);
    expect(c.outputSlot("spawn", "onFailure")).toBe(6);
    expect(c.outputDefinition(5)).toMatchObject({ kind: "message", condition: "onSuccess" });
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
