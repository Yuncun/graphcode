import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DOCUMENT_ID, readWorkflowDocument, type DocumentListing, type DocumentMetadata, type WorkflowDocument } from "../shared/workflowDocument.ts";
import type { CanvasDoc } from "../app/canvas/document.ts";

export const defaultDocumentsDir = (home = os.homedir()): string => path.join(home, ".graphcode", "documents");
const missing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";
export class MissingDocumentError extends Error {}

/** Serializes changes to each file so a name/folder update cannot overwrite a concurrent canvas save. */
export function createDocumentStore(dir: string) {
  const pending = new Map<string, Promise<void>>();
  const file = (id: string): string => {
    if (!DOCUMENT_ID.test(id)) throw new Error("invalid document identifier");
    return path.join(dir, `${id}.json`);
  };

  async function read(id: string): Promise<WorkflowDocument | null> {
    let text: string;
    try { text = await fs.readFile(file(id), "utf8"); }
    catch (error) { if (missing(error)) return null; throw error; }
    return readWorkflowDocument(JSON.parse(text), id);
  }

  async function write(doc: WorkflowDocument): Promise<void> {
    const destination = file(doc.id);
    await fs.mkdir(dir, { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(doc, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  function queued(id: string, operation: () => Promise<void>): Promise<void> {
    const previous = pending.get(id) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    pending.set(id, result);
    const clear = () => { if (pending.get(id) === result) pending.delete(id); };
    void result.then(clear, clear);
    return result;
  }

  async function update(id: string, patch: (doc: WorkflowDocument) => WorkflowDocument): Promise<void> {
    return queued(id, async () => {
      const doc = await read(id);
      if (!doc) throw new MissingDocumentError("workflow document not found");
      await write(patch(doc));
    });
  }

  return {
    read,
    put: (doc: WorkflowDocument) => queued(doc.id, () => write(doc)),
    metadata: (id: string, metadata: DocumentMetadata) => update(id, (doc) => ({ ...doc, ...metadata })),
    canvas: (id: string, canvas: CanvasDoc) => update(id, (doc) => ({ ...doc, canvas })),
    async list(): Promise<DocumentListing[]> {
      let files: string[];
      try { files = await fs.readdir(dir); }
      catch (error) { if (missing(error)) return []; throw error; }
      const documents: DocumentListing[] = [];
      for (const name of files) {
        if (!name.endsWith(".json") || !DOCUMENT_ID.test(name.slice(0, -5))) continue;
        const id = name.slice(0, -5);
        const doc = await read(id);
        if (!doc) continue;
        const { mtimeMs } = await fs.stat(file(id));
        documents.push({ id, name: doc.name, project: doc.project, savedAt: mtimeMs });
      }
      return documents.sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
    },
  };
}
