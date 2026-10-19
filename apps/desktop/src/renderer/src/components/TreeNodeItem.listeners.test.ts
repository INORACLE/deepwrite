import { createRenderer, defineComponent, h, ssrContextKey } from "vue";
import type { Component } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import TreeNodeItem from "./TreeNodeItem.vue";
import { registerTreeNodeActionListeners } from "../utils/treeNodeActionListeners";

const renderer = createRenderer({
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shares one listener set across mounted node instances and removes it on unmount", () => {
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("window", new EventTarget());
  const addDocument = vi.spyOn(document, "addEventListener");
  const addWindow = vi.spyOn(window, "addEventListener");
  const removeDocument = vi.spyOn(document, "removeEventListener");
  const removeWindow = vi.spyOn(window, "removeEventListener");
  const node = { ...TreeNodeItem, render: () => null } as Component;
  const app = renderer.createApp(
    defineComponent({
      setup: () => () =>
        h(
          "div",
          Array.from({ length: 3 }, (_, index) =>
            h(node, {
              node: { id: `node-${index}`, label: `Node ${index}` },
              depth: 0,
              selectedId: "",
              pinnable: true
            })
          )
        )
    })
  );
  app.provide(ssrContextKey, { modules: new Set() });
  try {
    app.mount({});
    expect(addDocument.mock.calls.map(([type]) => type)).toEqual([
      "pointerdown",
      "keydown"
    ]);
    expect(addWindow.mock.calls.map(([type]) => type)).toEqual(["resize"]);
  } finally {
    app.unmount();
  }
  expect(removeDocument.mock.calls.map(([type]) => type)).toEqual([
    "pointerdown",
    "keydown"
  ]);
  expect(removeWindow.mock.calls.map(([type]) => type)).toEqual(["resize"]);
});

it("keeps remaining menus responsive after another node unregisters", () => {
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("window", new EventTarget());
  const first = {
    containsTarget: () => true,
    close: vi.fn(),
    updatePlacement: vi.fn()
  };
  const second = {
    containsTarget: () => false,
    close: vi.fn(),
    updatePlacement: vi.fn()
  };
  const removeFirst = registerTreeNodeActionListeners(first);
  const removeSecond = registerTreeNodeActionListeners(second);
  try {
    document.dispatchEvent(new Event("pointerdown"));
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).toHaveBeenCalledOnce();
    removeFirst();
    window.dispatchEvent(new Event("resize"));
    const escape = new Event("keydown");
    Object.defineProperty(escape, "key", { value: "Escape" });
    document.dispatchEvent(escape);
    expect(first.updatePlacement).not.toHaveBeenCalled();
    expect(second.updatePlacement).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledTimes(2);
  } finally {
    removeSecond();
  }
  window.dispatchEvent(new Event("resize"));
  expect(second.updatePlacement).toHaveBeenCalledOnce();
});
