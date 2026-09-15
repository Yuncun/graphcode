// A goal loop runs unattended until its predicate command exits 0. The daemon starts it the moment it is created, which is why a card stays a draft until Start.
export default {
  type: "agent/goal",
  title: "Goal loop",
  category: "agent",
  description: "Runs unattended until a shell command says the goal is met.",
  inputs: [{ name: "start", type: "handoff" }],
  outputs: [
    { name: "handoff", type: "handoff", condition: "always" },
    { name: "on success", type: "handoff", condition: "onSuccess" },
    { name: "on failure", type: "handoff", condition: "onFailure" },
    { name: "message", type: "message" },
    { name: "spawn", type: "spawn" },
  ],
  widgets: [
    { name: "summary", label: "Goal", type: "text", multiline: true, required: true, placeholder: "What done looks like, in your words" },
    { name: "predicate", label: "Done when this command exits 0", type: "text", placeholder: "pnpm test" },
    { name: "model", label: "Model", type: "combo", values: ["fast", "standard", "capable"], default: "standard" },
    { name: "backend", label: "Backend", type: "combo", values: ["claudeCode", "copilotCLI", "codex", "openCode", "pi"], default: "claudeCode" },
  ],
  toDraft(v) {
    return {
      loopType: "goalBased",
      modelTier: v.model,
      backend: v.backend,
      goal: { summary: v.summary, predicate: v.predicate || undefined },
    };
  },
  fromLoop(n) {
    return {
      summary: n.goal?.summary ?? "",
      predicate: n.goal?.predicate ?? "",
      model: n.modelTier ?? "standard",
      backend: n.backend ?? "claudeCode",
    };
  },
};
