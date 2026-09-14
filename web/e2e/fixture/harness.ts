import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { startBridge } from "../../server/main.ts";
import { alphaGraph, betaGraph } from "./graph.ts";
import { startScriptedDaemon, type ScriptedDaemon } from "./scriptedDaemon.ts";

export interface HarnessDirs { alpha: string; beta: string; gamma: string; userNodesDir: string }

export interface Harness extends HarnessDirs {
  url: string;
  /** null when launched with `daemonUp: false`. */
  daemon: ScriptedDaemon | null;
  /** Page errors collected by `openApp`. Assert it is empty at the end of a row. */
  pageErrors: string[];
  close(): Promise<void>;
}

export interface LaunchOptions {
  daemonUp?: boolean;
  /** Runs after the temp folders exist and before the bridge starts: write project-local node packs here. */
  before?: (dirs: HarnessDirs) => void;
}

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function launch({ daemonUp = true, before }: LaunchOptions = {}): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-e2e-"));
  const dirs: HarnessDirs = {
    alpha: path.join(root, "alpha"),
    beta: path.join(root, "beta"),
    // Listed in recents but never created, so opening it is the daemon's "no project" error.
    gamma: path.join(root, "gamma"),
    userNodesDir: path.join(root, "user-nodes"),
  };
  for (const d of [dirs.alpha, dirs.beta, dirs.userNodesDir]) fs.mkdirSync(d, { recursive: true });
  before?.(dirs);
  const daemon = daemonUp
    ? await startScriptedDaemon({
        graphs: [alphaGraph(dirs.alpha), betaGraph(dirs.beta)],
        recents: [
          { path: dirs.alpha, name: "alpha" },
          { path: dirs.beta, name: "beta" },
          { path: dirs.gamma, name: "gamma" },
        ],
      })
    : null;
  const bridge = await startBridge({
    port: 0,
    socketPath: daemon?.path ?? path.join(root, "absent.sock"),
    distDir: path.join(WEB_ROOT, "dist"),
    nodeTypeRoots: { builtin: path.join(WEB_ROOT, "nodes"), user: dirs.userNodesDir },
  });
  return {
    ...dirs,
    url: `http://localhost:${bridge.port}`,
    daemon,
    pageErrors: [],
    close: async () => {
      await bridge.close();
      await daemon?.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Loads the app and waits until its socket to the bridge is open, which is when commands may be sent. */
export async function openApp(page: Page, harness: Harness): Promise<void> {
  page.on("pageerror", (e) => harness.pageErrors.push(e.message));
  await page.goto(harness.url);
  await expect(page.getByTestId("status")).toContainText("open", { timeout: 15_000 });
}

/** Commands of one name the daemon has received so far, decoded. */
export function receivedCommands(harness: Harness, name: string): Record<string, any>[] {
  return harness.daemon!.received.filter((c): c is Record<string, any> => typeof c === "object" && c !== null && name in c);
}

/** Graph commands of one name, unwrapped from `graphCommand`. */
export function receivedGraphCommands(harness: Harness, name: string): Record<string, any>[] {
  return receivedCommands(harness, "graphCommand")
    .map((c) => c.graphCommand.command)
    .filter((c) => name in c);
}

export const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/out/${name}.png` });
