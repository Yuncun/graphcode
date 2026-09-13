import path from "node:path";

/** Same rule as GraphcodeKit DaemonSocketPath.swift: GRAPHCODE_SOCKET, else support dir, else ~/.graphcode. */
export function resolveSocketPath(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.GRAPHCODE_SOCKET?.trim();
  if (override) return override.startsWith("~") ? path.join(home, override.slice(1)) : override;
  const supportDir = env.GRAPHCODE_SUPPORT_DIR?.trim();
  if (supportDir) return path.join(supportDir, "graphcoded.sock");
  return path.join(home, ".graphcode", "graphcoded.sock");
}
