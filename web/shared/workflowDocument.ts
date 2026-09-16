import { readCanvasDoc, type CanvasDoc } from "../app/canvas/document.ts";

export interface WorkflowDocument {
  version: 1;
  id: string;
  name: string;
  project: string | null;
  canvas: CanvasDoc;
}

export interface DocumentListing { id: string; name: string; project: string | null; savedAt: number }
export interface DocumentMetadata { name?: string; project?: string | null }

export const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const documentKey = (id: string): string => `workflow:${id}`;
export const documentID = (key: string): string | null => key.startsWith("workflow:") && DOCUMENT_ID.test(key.slice(9)) ? key.slice(9) : null;

export class DocumentFormatError extends Error {}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const point = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number" && Number.isFinite(v));
const safeID = (id: string): boolean => !["__proto__", "constructor", "prototype"].includes(id);
const validName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\r\n\0]/.test(value);
const validProject = (value: unknown): value is string | null => value === null || typeof value === "string" && value.startsWith("/") && !value.includes("\0");

/** Autosave refuses malformed content rather than replacing it with a partially empty document. */
export function readDocumentCanvas(raw: unknown): CanvasDoc {
  if (!object(raw) || raw.version !== 2 || !object(raw.nodes) || !object(raw.drafts) || !Array.isArray(raw.draftEdges)) throw new DocumentFormatError("not a canvas document");
  for (const [id, placed] of Object.entries(raw.nodes)) {
    if (!safeID(id) || !object(placed) || !point(placed.pos) || placed.size !== undefined && (!point(placed.size) || placed.size.some((v) => v <= 0))) throw new DocumentFormatError(`invalid position or size for card ${id}`);
  }
  for (const id of Object.keys(raw.drafts)) if (!safeID(id)) throw new DocumentFormatError("invalid card identifier");
  const canvas = readCanvasDoc(raw);
  if (Object.keys(canvas.drafts).length !== Object.keys(raw.drafts).length || canvas.draftEdges.length !== raw.draftEdges.length) throw new DocumentFormatError("invalid card or edge");
  return canvas;
}

export function readDocumentMetadata(raw: unknown): DocumentMetadata {
  if (!object(raw) || Object.keys(raw).some((key) => key !== "name" && key !== "project")) throw new DocumentFormatError("only name and project may be changed");
  const metadata: DocumentMetadata = {};
  if ("name" in raw) {
    if (!validName(raw.name)) throw new DocumentFormatError("name must be 1 to 100 characters");
    metadata.name = raw.name.trim();
  }
  if ("project" in raw) {
    if (!validProject(raw.project)) throw new DocumentFormatError("project must be an absolute local path or null");
    metadata.project = raw.project;
  }
  return metadata;
}

export function readWorkflowDocument(raw: unknown, expectedID?: string): WorkflowDocument {
  if (!object(raw) || raw.version !== 1 || typeof raw.id !== "string" || !DOCUMENT_ID.test(raw.id) || expectedID !== undefined && raw.id !== expectedID) throw new DocumentFormatError("invalid workflow document identifier or version");
  if (!validName(raw.name) || !validProject(raw.project)) throw new DocumentFormatError("invalid workflow document name or project");
  return { version: 1, id: raw.id, name: raw.name.trim(), project: raw.project, canvas: readDocumentCanvas(raw.canvas) };
}
