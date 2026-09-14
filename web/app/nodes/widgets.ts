export type WidgetType = "text" | "combo" | "number" | "toggle";

/** One field of a node type's brief, as declared by its module (spec section 6). */
export interface WidgetDef {
  name: string;
  type: WidgetType;
  label?: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  /** text only */
  multiline?: boolean;
  /** combo only */
  values?: string[];
  default?: unknown;
}

export type WidgetValues = Record<string, unknown>;

const WIDGET_TYPES: readonly WidgetType[] = ["text", "combo", "number", "toggle"];

export function defaultValues(widgets: WidgetDef[]): WidgetValues {
  const values: WidgetValues = {};
  for (const w of widgets) {
    switch (w.type) {
      case "text": values[w.name] = w.default ?? ""; break;
      case "combo": values[w.name] = w.default ?? w.values?.[0] ?? ""; break;
      case "number": values[w.name] = w.default ?? null; break;
      case "toggle": values[w.name] = w.default ?? false; break;
    }
  }
  return values;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** Required widgets whose value is missing or blank. */
export function missingRequired(widgets: WidgetDef[], values: WidgetValues): WidgetDef[] {
  return widgets.filter((w) => w.required && isBlank(values[w.name]));
}

/** Checks a module's `widgets` array, throwing a message that names the offending widget. */
export function validateWidgets(raw: unknown): WidgetDef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("widgets must be an array");
  const names = new Set<string>();
  return raw.map((item, index) => {
    const w = item as Record<string, unknown>;
    if (typeof w?.name !== "string" || !w.name) throw new Error(`widget ${index} needs a name`);
    if (names.has(w.name)) throw new Error(`widget name "${w.name}" is used twice`);
    names.add(w.name);
    if (!WIDGET_TYPES.includes(w.type as WidgetType)) throw new Error(`widget "${w.name}" has unknown type "${String(w.type)}"`);
    if (w.type === "combo" && (!Array.isArray(w.values) || w.values.length === 0)) throw new Error(`combo "${w.name}" needs a non-empty values array`);
    return w as unknown as WidgetDef;
  });
}
