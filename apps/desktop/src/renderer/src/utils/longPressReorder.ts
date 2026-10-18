import { moveLongEntry } from "./longEntryReorder";

export interface LongPressReorderGroup {
  ids: readonly string[];
  canReorder?: (ids: string[]) => boolean;
}

export interface LongPressReorderOptions {
  scope: string;
  disabled: boolean;
  groups: Record<string, LongPressReorderGroup>;
  reorder: (group: string, ids: string[]) => void;
}

const ITEM = "[data-long-reorder-item]";
const GROUP = "[data-long-reorder-group]";
const HOLD_MS = 350;

export function bindLongPressReorder(
  root: HTMLElement,
  read: () => LongPressReorderOptions
): () => void {
  let gesture:
    | {
        pointerId: number;
        scope: string;
        group: string;
        container: HTMLElement;
        source: HTMLElement;
        ids: readonly string[];
        idSet: ReadonlySet<string>;
        x: number;
        y: number;
        active: boolean;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let marker: HTMLElement | undefined;
  let proposal: string[] | undefined;
  let candidateKey = "";
  let suppressClick = false;

  function clearMarker(): void {
    marker?.classList.remove("is-reorder-before", "is-reorder-after");
    marker = undefined;
    proposal = undefined;
  }

  function reset(): void {
    if (timer !== undefined) clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearMarker();
    const previous = gesture;
    gesture = undefined;
    previous?.source.classList.remove("is-reorder-dragging");
    root.classList.remove("is-entry-sorting");
    if (previous?.source.hasPointerCapture(previous.pointerId)) {
      previous.source.releasePointerCapture(previous.pointerId);
    }
    candidateKey = "";
  }

  function current(): boolean {
    if (!gesture) return false;
    const options = read();
    const ids = options.groups[gesture.group]?.ids;
    return (
      !options.disabled &&
      gesture.source.isConnected &&
      options.scope === gesture.scope &&
      Boolean(
        ids &&
        ids.length === gesture.ids.length &&
        ids.every((id, index) => id === gesture?.ids[index])
      )
    );
  }

  function updateTarget(): void {
    if (!gesture || !current()) {
      reset();
      return;
    }
    const { container, group, x, y, ids, source } = gesture;
    const bounds = container.getBoundingClientRect();
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    ) {
      clearMarker();
      candidateKey = "";
      return;
    }
    const horizontal = container.dataset.longReorderAxis === "horizontal";
    const coordinate = horizontal ? x : y;
    const items = [...container.querySelectorAll<HTMLElement>(ITEM)].filter(
      (item) => gesture?.idSet.has(item.dataset.longReorderItem ?? "")
    );
    let nearest: HTMLElement | undefined;
    let distance = Infinity;
    let position: "before" | "after" = "before";
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const center = horizontal
        ? rect.left + rect.width / 2
        : rect.top + rect.height / 2;
      if (Math.abs(coordinate - center) < distance) {
        nearest = item;
        distance = Math.abs(coordinate - center);
        position = coordinate < center ? "before" : "after";
      }
    }
    const key = `${nearest?.dataset.longReorderItem}:${position}`;
    if (key === candidateKey) return;
    candidateKey = key;
    clearMarker();
    if (!nearest || nearest === source) return;
    const next = moveLongEntry(
      ids,
      source.dataset.longReorderItem!,
      nearest.dataset.longReorderItem!,
      position
    );
    if (
      next.every((id, index) => id === ids[index]) ||
      read().groups[group]?.canReorder?.(next) === false
    )
      return;
    proposal = next;
    marker = nearest;
    nearest.classList.add(
      position === "before" ? "is-reorder-before" : "is-reorder-after"
    );
  }

  function autoScroll(): void {
    if (!gesture?.active) return;
    if (!current()) {
      reset();
      return;
    }
    const { container, x, y } = gesture;
    const rect = container.getBoundingClientRect();
    if (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      const horizontal = container.dataset.longReorderAxis === "horizontal";
      const start = horizontal ? rect.left : rect.top;
      const end = horizontal ? rect.right : rect.bottom;
      const point = horizontal ? x : y;
      const delta = point < start + 28 ? -8 : point > end - 28 ? 8 : 0;
      const previous = horizontal ? container.scrollLeft : container.scrollTop;
      if (horizontal) container.scrollLeft += delta;
      else container.scrollTop += delta;
      if (
        previous !== (horizontal ? container.scrollLeft : container.scrollTop)
      )
        updateTarget();
    }
    frame = requestAnimationFrame(autoScroll);
  }

  function down(event: PointerEvent): void {
    reset();
    suppressClick = false;
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      read().disabled ||
      !(event.target instanceof Element)
    )
      return;
    const source = event.target.closest<HTMLElement>(ITEM);
    const container = source?.closest<HTMLElement>(GROUP);
    const group = container?.dataset.longReorderGroup;
    const ids = group ? read().groups[group]?.ids : undefined;
    if (
      !source ||
      !container ||
      !root.contains(container) ||
      !group ||
      !ids ||
      ids.length < 2 ||
      !ids.includes(source.dataset.longReorderItem ?? "")
    )
      return;
    gesture = {
      pointerId: event.pointerId,
      scope: read().scope,
      group,
      container,
      source,
      ids: [...ids],
      idSet: new Set(ids),
      x: event.clientX,
      y: event.clientY,
      active: false
    };
    timer = setTimeout(() => {
      if (!current() || !gesture) {
        reset();
        return;
      }
      gesture.active = true;
      suppressClick = true;
      source.setPointerCapture(event.pointerId);
      source.classList.add("is-reorder-dragging");
      root.classList.add("is-entry-sorting");
      frame = requestAnimationFrame(autoScroll);
    }, HOLD_MS);
  }

  function move(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!gesture.active) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6)
        reset();
      return;
    }
    event.preventDefault();
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    updateTarget();
  }

  function up(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.active) {
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      updateTarget();
    }
    const group = gesture?.group;
    const ids = current() ? proposal : undefined;
    reset();
    if (group && ids) read().reorder(group, ids);
  }

  function click(event: MouseEvent): void {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && gesture) {
      event.preventDefault();
      reset();
    }
  }
  function cancel(event: PointerEvent): void {
    if (event.pointerId === gesture?.pointerId) reset();
  }
  function nativeDrag(event: DragEvent): void {
    if (gesture) {
      event.preventDefault();
      reset();
    }
  }
  function contextMenu(event: MouseEvent): void {
    if (gesture?.active) event.preventDefault();
  }

  root.addEventListener("pointerdown", down);
  root.addEventListener("click", click, true);
  root.addEventListener("dragstart", nativeDrag);
  root.addEventListener("contextmenu", contextMenu);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("lostpointercapture", cancel);
  window.addEventListener("blur", reset);
  window.addEventListener("keydown", keydown);
  return () => {
    reset();
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("click", click, true);
    root.removeEventListener("dragstart", nativeDrag);
    root.removeEventListener("contextmenu", contextMenu);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("blur", reset);
    window.removeEventListener("keydown", keydown);
  };
}
