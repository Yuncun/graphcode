import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WORKFLOW_NAME } from "../shared/workflowName.ts";

export interface WorkflowListing { name: string; savedAt: number }

export function defaultWorkflowsDir(home = os.homedir()): string {
  return path.join(home, ".graphcode", "workflows");
}

/** Every `<name>.json` in the directory whose name passes WORKFLOW_NAME, newest first; a missing directory is an empty list. */
export async function listWorkflows(dir: string): Promise<WorkflowListing[]> {
  let files: string[];
  try { files = await fs.readdir(dir); } catch { return []; }
  const out: WorkflowListing[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const name = file.slice(0, -".json".length);
    if (!WORKFLOW_NAME.test(name)) continue;
    // Removed between readdir and stat: not listed, not an error.
    try { out.push({ name, savedAt: (await fs.stat(path.join(dir, file))).mtimeMs }); } catch { /* skipped */ }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

/** The parsed file, or null when the name is malformed, the file is missing, or it is not JSON. */
export async function readWorkflow(dir: string, name: string): Promise<unknown | null> {
  if (!WORKFLOW_NAME.test(name)) return null;
  try { return JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), "utf8")) as unknown; } catch { return null; }
}

/** Writes the file, creating the directory. Throws on a malformed name or a body that is not a JSON object. */
export async function writeWorkflow(dir: string, name: string, body: unknown): Promise<void> {
  if (!WORKFLOW_NAME.test(name)) throw new Error("malformed workflow name");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("a workflow is a JSON object");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
}
