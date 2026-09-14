/**
 * The shape of `window.__graphcode` (App.vue, onMounted), as the e2e specs see it. Both
 * phase0-matrix.spec.ts and phase1-matrix.spec.ts augment the global `Window` type with this same
 * property; TypeScript's declaration merging requires every declaration of the same global member
 * to have an identical type, so this lives in one place and each spec imports it rather than
 * redeclaring its own (incompatible) inline shape.
 */
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
  positions(project: string): Record<string, { pos: [number, number] }> | undefined;
  viewport(): { scale: number; offset: [number, number]; width: number; height: number } | undefined;
  selected(): string | null;
  nodeTypes(): Array<{ type: string; ok: boolean }>;
}
