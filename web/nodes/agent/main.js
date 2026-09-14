// A main loop (the engine's "sketch") is a bare attended session with no goal and no cadence. It
// runs when a human opens it, and can be promoted to another type later.
export default {
  type: "agent/main",
  title: "Main loop",
  category: "agent",
  description: "A bare session that works with you until you promote or close it.",
  inputs: [{ name: "start", type: "handoff" }],
  outputs: [
    { name: "handoff", type: "handoff", condition: "always" },
    { name: "message", type: "message" },
    { name: "spawn", type: "spawn" },
  ],
  widgets: [
    { name: "note", label: "Starting note", type: "text", multiline: true, placeholder: "Optional: what to start on" },
    { name: "backend", label: "Backend", type: "combo", values: ["claudeCode", "copilotCLI", "codex", "openCode", "pi"], default: "claudeCode" },
  ],
  toDraft(v) {
    return { loopType: "sketch", firstInstruction: v.note || undefined, backend: v.backend };
  },
};
