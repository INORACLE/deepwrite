type TreeNodeActionListeners = {
  containsTarget: (target: EventTarget | null) => boolean;
  close: () => void;
  updatePlacement: () => void;
};

const treeNodeActionListeners = new Set<TreeNodeActionListeners>();

function handleTreeNodePointerDown(event: PointerEvent): void {
  for (const listener of [...treeNodeActionListeners]) {
    if (!listener.containsTarget(event.target)) listener.close();
  }
}

function handleTreeNodeKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  for (const listener of [...treeNodeActionListeners]) listener.close();
}

function handleTreeNodeResize(): void {
  for (const listener of [...treeNodeActionListeners]) {
    listener.updatePlacement();
  }
}

export function registerTreeNodeActionListeners(
  listener: TreeNodeActionListeners
): () => void {
  const wasEmpty = treeNodeActionListeners.size === 0;
  treeNodeActionListeners.add(listener);
  if (wasEmpty) {
    document.addEventListener("pointerdown", handleTreeNodePointerDown);
    document.addEventListener("keydown", handleTreeNodeKeydown);
    window.addEventListener("resize", handleTreeNodeResize);
  }

  return () => {
    treeNodeActionListeners.delete(listener);
    if (treeNodeActionListeners.size > 0) return;
    document.removeEventListener("pointerdown", handleTreeNodePointerDown);
    document.removeEventListener("keydown", handleTreeNodeKeydown);
    window.removeEventListener("resize", handleTreeNodeResize);
  };
}
