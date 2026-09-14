import { emptyCanvasDoc, readCanvasDoc, type CanvasDoc } from "./document.ts";

const url = (project: string) => `/api/canvas?project=${encodeURIComponent(project)}`;

/** The bridge answers with an empty document for a project that has never been laid out; a version 1 file, a phase 1 layout, is laid out afresh. */
export async function getLayout(project: string, fetchFn: typeof fetch = fetch): Promise<CanvasDoc> {
  const res = await fetchFn(url(project));
  if (!res.ok) return emptyCanvasDoc();
  return readCanvasDoc(await res.json());
}

export async function putLayout(project: string, doc: CanvasDoc, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(url(project), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  // A refusal answers with a status, not a thrown error; the caller decides what a failed save means to the user.
  if (!res.ok) throw new Error(`the bridge refused the canvas layout (HTTP ${res.status})`);
}
