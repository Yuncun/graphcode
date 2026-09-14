// A turn loop pauses after every turn for a human to look. The first instruction is required: a
// loop with nothing to start on is not a loop.
export default {
  type: "agent/turn",
  title: "Turn loop",
  category: "agent",
  description: "Works one turn per round and waits for you between turns.",
  inputs: [{ name: "start", type: "handoff" }],
  outputs: [
    { name: "handoff", type: "handoff", condition: "always" },
    { name: "on success", type: "handoff", condition: "onSuccess" },
    { name: "on failure", type: "handoff", condition: "onFailure" },
    { name: "message", type: "message" },
    { name: "spawn", type: "spawn" },
  ],
  widgets: [
    { name: "instruction", label: "First instruction", type: "text", multiline: true, required: true, placeholder: "What to start doing" },
    { name: "check", label: "What you will check each turn", type: "text", placeholder: "Optional" },
    { name: "pauseWrites", label: "Pause only before writes", type: "toggle", default: false },
    { name: "model", label: "Model", type: "combo", values: ["fast", "standard", "capable"], default: "standard" },
    { name: "backend", label: "Backend", type: "combo", values: ["claudeCode", "copilotCLI", "codex", "openCode", "pi"], default: "claudeCode" },
  ],
  toDraft(v) {
    return {
      loopType: "turnBased",
      firstInstruction: v.instruction,
      checkDescription: v.check || undefined,
      pausesBeforeWritesOnly: Boolean(v.pauseWrites),
      modelTier: v.model,
      backend: v.backend,
    };
  },
};
