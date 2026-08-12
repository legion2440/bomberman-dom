/**
 * PushOK mounting.
 */
import { patch } from "./dom.js";
import { normalizeChildren } from "./vdom.js";

export function mount({ store, view, root }) {
  let currentTree = [];

  function draw() {
    const nextTree = normalizeChildren([view(store.getState())]);
    patch(root, currentTree, nextTree);
    currentTree = nextTree;
  }

  root.replaceChildren();
  draw();
  const unsubscribe = store.subscribe(draw);

  return {
    unmount() {
      unsubscribe();
      root.replaceChildren();
      currentTree = [];
    },
  };
}
