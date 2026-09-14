import { emptyCanvasDoc, readCanvasDoc, type CanvasDoc } from "./document.ts";

const url = (project: string) => `/api/canvas?project=${encodeURIComponent(project)}`;

/** The bridge answers with an empty document for a project that has never been laid out; a version 1 file is read as version 2. */
export async function getLayout(project: string): Promise<CanvasDoc> {
  const res = await fetch(url(project));
  if (!res.ok) return emptyCanvasDoc();
  return readCanvasDoc(await res.json());
}

export async function putLayout(project: string, doc: CanvasDoc): Promise<void> {
  const res = await fetch(url(project), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  // A refusal answers with a status, not a thrown error, so without this a rejected layout
  // would look exactly like a saved one.
  if (!res.ok) console.warn(`graphcode: the bridge refused the canvas layout (HTTP ${res.status})`);
}
