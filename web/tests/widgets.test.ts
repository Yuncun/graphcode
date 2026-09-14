import { describe, expect, it } from "vitest";
import { defaultValues, missingRequired, validateWidgets, type WidgetDef } from "../app/nodes/widgets.ts";

const widgets: WidgetDef[] = [
  { name: "summary", type: "text", required: true, multiline: true },
  { name: "predicate", type: "text" },
  { name: "model", type: "combo", values: ["fast", "standard"], default: "standard" },
  { name: "backend", type: "combo", values: ["claudeCode", "pi"] },
  { name: "interval", type: "number", default: 3600 },
  { name: "budget", type: "number" },
  { name: "pause", type: "toggle" },
];

describe("defaultValues", () => {
  it("fills every widget: text empty, combo its default or first value, number its default or null, toggle false", () => {
    expect(defaultValues(widgets)).toEqual({ summary: "", predicate: "", model: "standard", backend: "claudeCode", interval: 3600, budget: null, pause: false });
  });
});

describe("missingRequired", () => {
  it("names required widgets that are empty, blank, null or undefined", () => {
    const values = { ...defaultValues(widgets), summary: "  " };
    expect(missingRequired(widgets, values).map((w) => w.name)).toEqual(["summary"]);
    expect(missingRequired(widgets, { ...values, summary: "done" })).toEqual([]);
    expect(missingRequired([{ name: "n", type: "number", required: true }], { n: null }).map((w) => w.name)).toEqual(["n"]);
    expect(missingRequired([{ name: "n", type: "number", required: true }], { n: 0 })).toEqual([]);
  });
});

describe("validateWidgets", () => {
  it("accepts the four widget types and refuses anything malformed", () => {
    expect(validateWidgets(widgets)).toEqual(widgets);
    expect(validateWidgets(undefined)).toEqual([]);
    expect(() => validateWidgets("nope")).toThrow("widgets must be an array");
    expect(() => validateWidgets([{ type: "text" }])).toThrow("widget 0 needs a name");
    expect(() => validateWidgets([{ name: "x", type: "slider" }])).toThrow('widget "x" has unknown type "slider"');
    expect(() => validateWidgets([{ name: "x", type: "combo" }])).toThrow('combo "x" needs a non-empty values array');
    expect(() => validateWidgets([{ name: "x", type: "text" }, { name: "x", type: "text" }])).toThrow('widget name "x" is used twice');
  });
});
