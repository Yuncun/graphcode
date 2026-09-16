import { emptyCanvasDoc, readCanvasDoc, type CanvasDoc } from "./document.ts";
import { documentID, readDocumentCanvas } from "../../shared/workflowDocument.ts";

const url = (project: string) => {
  const id = documentID(project);
  return id ? `/api/documents/canvas?id=${encodeURIComponent(id)}` : `/api/canvas?project=${encodeURIComponent(project)}`;
};
const documentWrites = new Map<string, Promise<void>>();

/** The bridge answers with an empty document for a project that has never been laid out; a version 1 file, a phase 1 layout, is laid out afresh. */
export async function getLayout(project: string, fetchFn: typeof fetch = fetch): Promise<CanvasDoc> {
  const res = await fetchFn(url(project));
  if (documentID(project)) {
    if (!res.ok) throw new Error(`the workflow canvas could not be read (HTTP ${res.status})`);
    return readDocumentCanvas(await res.json());
  }
  if (!res.ok) return emptyCanvasDoc();
  return readCanvasDoc(await res.json());
}

export async function putLayout(project: string, doc: CanvasDoc, fetchFn: typeof fetch = fetch): Promise<void> {
  const body = JSON.stringify(doc);
  const write = async () => {
    const res = await fetchFn(url(project), { method: "PUT", headers: { "content-type": "application/json" }, body });
    if (!res.ok) throw new Error(`the bridge refused the canvas layout (HTTP ${res.status})`);
  };
  if (!documentID(project)) return write();
  // Network delays must not let an older autosave arrive after a newer one.
  const previous = documentWrites.get(project) ?? Promise.resolve();
  const result = previous.then(write, write);
  documentWrites.set(project, result);
  const clear = () => { if (documentWrites.get(project) === result) documentWrites.delete(project); };
  void result.then(clear, clear);
  return result;
}
