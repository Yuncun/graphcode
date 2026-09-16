# GraphCode, web canvas fork

A fork of [GraphCode](https://github.com/scgopi/GraphCode) by [scgopi](https://github.com/scgopi).
GraphCode, its daemon and its Mac app are his work and keep his license (see `LICENSE`).
This fork adds one thing in `web/`: a ComfyUI-style canvas, in a browser tab, on top of his unchanged daemon.
Cards are drafts you fill in on the canvas, wires are drawn between them, and nothing runs until you press Run.

## Run it

You need GraphCode installed and running (its daemon listens at `~/.graphcode/graphcoded.sock`) and [mise](https://mise.jdx.dev).

```sh
make web-install
cd web && mise exec -- pnpm build && cd ..
make web-serve
```

Then open http://localhost:4747. Press **+** for a new workflow, or open a project folder from the Projects tab.
