import { readWorkflowFile, type WorkflowFile } from "./document.ts";

export interface WorkflowListing { name: string; savedAt: number }

export async function listWorkflows(fetchFn: typeof fetch = fetch): Promise<WorkflowListing[]> {
  const res = await fetchFn("/api/workflows");
  if (!res.ok) throw new Error(`workflow listing failed: HTTP ${res.status}`);
  return ((await res.json()) as { workflows: WorkflowListing[] }).workflows;
}

export async function getWorkflow(name: string, fetchFn: typeof fetch = fetch): Promise<WorkflowFile> {
  const res = await fetchFn(`/api/workflows/file?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`workflow "${name}" could not be read (HTTP ${res.status})`);
  return readWorkflowFile(await res.json());
}

export async function putWorkflow(file: WorkflowFile, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`/api/workflows/file?name=${encodeURIComponent(file.name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(file),
  });
  if (!res.ok) throw new Error(`the bridge refused the workflow (HTTP ${res.status})`);
}
