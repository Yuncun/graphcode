// A composite holds a sub-graph of its own and only needs a name at creation; its contents are
// edited afterwards (phase 2 brings the sub-graph editor).
export default {
  type: "group/composite",
  title: "Composite",
  category: "group",
  description: "A group of loops with its own sub-graph, piloted before it is armed.",
  inputs: [{ name: "start", type: "handoff" }],
  outputs: [
    { name: "handoff", type: "handoff", condition: "always" },
    { name: "on success", type: "handoff", condition: "onSuccess" },
    { name: "on failure", type: "handoff", condition: "onFailure" },
    { name: "message", type: "message" },
    { name: "spawn", type: "spawn" },
  ],
  widgets: [],
  toDraft() {
    return { loopType: "proactive" };
  },
  fromLoop() {
    return {};
  },
};
