import type { CanvasDoc } from "./adapter.ts";

const url = (project: string) => `/api/canvas?project=${encodeURIComponent(project)}`;

/** The bridge answers with an empty document for a project that has never been laid out. */
export async function getLayout(project: string): Promise<CanvasDoc> {
  const res = await fetch(url(project));
  if (!res.ok) return { version: 1, nodes: {} };
  return (await res.json()) as CanvasDoc;
}

export async function putLayout(project: string, doc: CanvasDoc): Promise<void> {
  await fetch(url(project), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}
