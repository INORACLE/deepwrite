import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindLongPressReorder,
  type LongPressReorderOptions
} from "./longPressReorder";

class Surface {
  listeners = new Map<string, Set<(event: never) => void>>();
  addEventListener(type: string, listener: (event: never) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: never) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(type: string, details = {}) {
    const event = {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 50,
      clientY: 50,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      ...details
    };
    this.listeners.get(type)?.forEach((listener) => listener(event as never));
    return event;
  }
}

class Row extends Surface {
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) =>
      names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) =>
      names.forEach((name) => this.classes.delete(name))
  };
  isConnected = true;
  scrollTop = 0;
  scrollLeft = 0;
  parent: Row | undefined;
  children: Row[] = [];
  capture = new Set<number>();
  bounds = {
    left: 0,
    right: 200,
    top: 0,
    bottom: 200,
    width: 200,
    height: 200
  };
  getBoundingClientRect() {
    return this.bounds;
  }
  hasPointerCapture(id: number) {
    return this.capture.has(id);
  }
  setPointerCapture(id: number) {
    this.capture.add(id);
  }
  releasePointerCapture(id: number) {
    this.capture.delete(id);
  }
  contains(other: Row): boolean {
    return (
      this === other || this.children.some((child) => child.contains(other))
    );
  }
  closest(selector: string): Row | undefined {
    const key = selector.includes("-group")
      ? "longReorderGroup"
      : "longReorderItem";
    return this.dataset[key] ? this : this.parent?.closest(selector);
  }
  querySelectorAll() {
    return this.children.filter((child) => child.dataset.longReorderItem);
  }
}

function setup(horizontal = false) {
  const windowSurface = new Surface();
  const root = new Row(),
    container = new Row();
  container.parent = root;
  root.children = [container];
  container.dataset = {
    longReorderGroup: "items",
    ...(horizontal ? { longReorderAxis: "horizontal" } : {})
  };
  const rows = ["overview", "a", "b", "c"].map((id, i) => {
    const row = new Row();
    row.parent = container;
    if (id !== "overview") row.dataset.longReorderItem = id;
    row.bounds = horizontal
      ? {
          left: i * 40,
          right: i * 40 + 40,
          top: 0,
          bottom: 100,
          width: 40,
          height: 100
        }
      : {
          left: 0,
          right: 100,
          top: i * 40,
          bottom: i * 40 + 40,
          width: 100,
          height: 40
        };
    return row;
  });
  container.children = rows;
  const reorder = vi.fn();
  const options: LongPressReorderOptions = {
    scope: "book:list",
    disabled: false,
    groups: { items: { ids: ["a", "b", "c"] } },
    reorder
  };
  vi.stubGlobal("Element", Row);
  vi.stubGlobal("window", windowSurface);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const dispose = bindLongPressReorder(
    root as unknown as HTMLElement,
    () => options
  );
  function point(position: number) {
    return horizontal
      ? { clientX: position, clientY: 50 }
      : { clientX: 50, clientY: position };
  }
  function down(row = rows[3]!) {
    return root.send("pointerdown", {
      target: row,
      ...point(horizontal ? row.bounds.left + 20 : row.bounds.top + 20)
    });
  }
  function move(position: number) {
    windowSurface.send("pointermove", point(position));
  }
  function up(position: number) {
    windowSurface.send("pointerup", point(position));
  }
  return {
    root,
    rows,
    options,
    reorder,
    down,
    move,
    up,
    dispose,
    windowSurface
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("long press drag gesture", () => {
  it.each([false, true])(
    "holds before sorting, moves across multiple entries and keeps overview first (horizontal: %s)",
    (horizontal) => {
      const test = setup(horizontal);
      test.down();
      vi.advanceTimersByTime(349);
      expect(test.root.classes.has("is-entry-sorting")).toBe(false);
      vi.advanceTimersByTime(1);
      expect(test.root.classes.has("is-entry-sorting")).toBe(true);
      test.move(20); // over the fixed overview, inserts after it
      expect(test.rows[1]!.classes.has("is-reorder-before")).toBe(true);
      test.up(20);
      expect(test.reorder).toHaveBeenCalledExactlyOnceWith("items", [
        "c",
        "a",
        "b"
      ]);
      expect(test.root.classes.size).toBe(0);
      const click = test.root.send("click", { detail: 1 });
      expect(click.preventDefault).toHaveBeenCalledOnce();
      test.dispose();
    }
  );

  it("keeps quick clicks and scrolling from starting a reorder", () => {
    const test = setup();
    test.down();
    test.up(140);
    expect(
      test.root.send("click", { detail: 1 }).preventDefault
    ).not.toHaveBeenCalled();
    test.down();
    test.move(90);
    vi.advanceTimersByTime(500);
    test.up(20);
    expect(test.reorder).not.toHaveBeenCalled();
    test.dispose();
  });

  it("cannot pick up the overview or reorder a disabled group", () => {
    const test = setup();
    test.down(test.rows[0]);
    vi.advanceTimersByTime(500);
    test.up(140);
    test.options.disabled = true;
    test.down();
    vi.advanceTimersByTime(500);
    test.up(20);
    expect(test.reorder).not.toHaveBeenCalled();
    test.dispose();
  });

  it.each([
    "Escape",
    "pointercancel",
    "blur",
    "scope",
    "ids",
    "disabled",
    "outside",
    "dispose"
  ])("cancels on %s without saving", (reason) => {
    const test = setup();
    test.down();
    vi.advanceTimersByTime(350);
    test.move(20);
    if (reason === "Escape")
      test.windowSurface.send("keydown", { key: "Escape" });
    else if (reason === "scope") test.options.scope = "other-book:list";
    else if (reason === "ids")
      test.options.groups.items!.ids = ["a", "b", "new"];
    else if (reason === "disabled") test.options.disabled = true;
    else if (reason === "outside") test.move(250);
    else if (reason === "dispose") test.dispose();
    else test.windowSurface.send(reason);
    test.up(reason === "outside" ? 250 : 20);
    expect(test.reorder).not.toHaveBeenCalled();
    expect(test.root.classes.size).toBe(0);
    test.dispose();
  });

  it("rejects a forbidden destination and ignores a hold without a move", () => {
    const test = setup();
    test.options.groups.items!.canReorder = () => false;
    test.down();
    vi.advanceTimersByTime(350);
    test.up(20);
    test.down();
    vi.advanceTimersByTime(350);
    test.up(140);
    expect(test.reorder).not.toHaveBeenCalled();
    test.dispose();
  });
});
