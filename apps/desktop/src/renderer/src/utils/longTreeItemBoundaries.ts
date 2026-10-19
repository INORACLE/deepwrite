import type {
  LongTreeCollectionKind,
  ResourceTreeNode
} from "../types/workspace";

export interface LongTreeItemBoundary {
  first: boolean;
  last: boolean;
}

/** Keep two ids per kind; appending siblings never copies the preceding ids. */
export function createLongTreeItemBoundaries(
  children: readonly ResourceTreeNode[]
): Map<string, LongTreeItemBoundary> {
  const groups = new Map<
    LongTreeCollectionKind,
    { first: string; last: string }
  >();
  for (const child of children) {
    const kind = child.longTreeItem?.kind;
    if (!kind) continue;
    const group = groups.get(kind);
    if (group) group.last = child.id;
    else groups.set(kind, { first: child.id, last: child.id });
  }
  const boundaries = new Map<string, LongTreeItemBoundary>();
  for (const { first, last } of groups.values()) {
    boundaries.set(first, { first: true, last: first === last });
    if (first !== last) boundaries.set(last, { first: false, last: true });
  }
  return boundaries;
}
