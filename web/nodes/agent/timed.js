// A timed loop wakes on a cadence. The daemon can beat the drum itself (the interval below) or the
// prompt can carry a /loop directive and let the agent re-trigger its own work.
export default {
  type: "agent/timed",
  title: "Timed loop",
  category: "agent",
  description: "Runs its prompt again and again on an interval.",
  inputs: [{ name: "start", type: "handoff" }],
  outputs: [
    { name: "handoff", type: "handoff", condition: "always" },
    { name: "message", type: "message" },
    { name: "spawn", type: "spawn" },
  ],
  widgets: [
    { name: "prompt", label: "Prompt", type: "text", multiline: true, required: true, placeholder: "What to do on every wake" },
    { name: "interval", label: "Every (seconds)", type: "number", default: 3600, help: "Clear it to let a /loop directive in the prompt set the cadence." },
    { name: "model", label: "Model", type: "combo", values: ["fast", "standard", "capable"], default: "standard" },
    { name: "backend", label: "Backend", type: "combo", values: ["claudeCode", "copilotCLI", "codex", "openCode", "pi"], default: "claudeCode" },
  ],
  toDraft(v) {
    const interval = v.interval === "" || v.interval == null ? undefined : Number(v.interval);
    return { loopType: "timeBased", triggerPrompt: v.prompt, heartbeatIntervalSeconds: interval, modelTier: v.model, backend: v.backend };
  },
};
