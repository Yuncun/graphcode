import { readWorkflowDocument, type DocumentListing, type DocumentMetadata, type WorkflowDocument } from "../../shared/workflowDocument.ts";

export async function resolveProjectPath(project: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`/api/projects/resolve?project=${encodeURIComponent(project)}`);
  if (res.status === 400) throw new Error(`no project at ${project}`);
  if (!res.ok) throw new Error(`project folder could not be resolved (HTTP ${res.status})`);
  return ((await res.json()) as { project: string }).project;
}

export async function listWorkflowDocuments(fetchFn: typeof fetch = fetch): Promise<DocumentListing[]> {
  const res = await fetchFn("/api/documents");
  if (!res.ok) throw new Error(`workflow documents could not be listed (HTTP ${res.status})`);
  return ((await res.json()) as { documents: DocumentListing[] }).documents;
}

export async function getWorkflowDocument(id: string, fetchFn: typeof fetch = fetch): Promise<WorkflowDocument> {
  const res = await fetchFn(`/api/documents/file?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`workflow document could not be read (HTTP ${res.status})`);
  return readWorkflowDocument(await res.json(), id);
}

export async function putWorkflowDocument(doc: WorkflowDocument, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`/api/documents/file?id=${encodeURIComponent(doc.id)}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`workflow document could not be saved (HTTP ${res.status})`);
}

export async function patchWorkflowDocument(id: string, metadata: DocumentMetadata, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`/api/documents/file?id=${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(metadata),
  });
  if (!res.ok) throw new Error(`workflow document could not be updated (HTTP ${res.status})`);
}
