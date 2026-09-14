/**
 * The shape of `window.__graphcode` (App.vue, onMounted), as the e2e specs see it. Every spec
 * augments the global `Window` type with this same property; TypeScript's declaration merging
 * requires every declaration of the same global member to have an identical type, so this lives
 * in one place and each spec imports it.
 */
export interface CardView { id: string; mode: "draft" | "starting" | "live"; title: string; values: Record<string, unknown>; pos: [number, number]; size: [number, number] }
export type Box = [number, number, number, number];

export interface GraphcodeWindow {
  store: {
    projects: Map<string, {
      nodes: Array<{ id: string; title: string; state: Record<string, unknown> }>;
      edges: Array<{ id: string; from: string; to: string; kind: string; condition: string }>;
    }>;
    order: string[];
    errors: string[];
  };
  openProject(path: string): void;
  active(): string | null;
  positions(project: string): Record<string, { pos: [number, number]; size?: [number, number] }> | undefined;
  viewport(): { scale: number; offset: [number, number]; width: number; height: number } | undefined;
  selected(): string | null;
  nodeTypes(): Array<{ type: string; ok: boolean }>;
  cards(project: string): CardView[] | undefined;
  document(project: string): { nodes: Record<string, unknown>; drafts: Record<string, unknown>; draftEdges: unknown[] } | undefined;
  counts(): { drafts: number; wires: number };
  widgetBox(project: string, id: string, name: string): Box | null;
  buttonBox(project: string, id: string, label: string): Box | null;
}
