export function orderLongChapterNavigationItems<
  T extends { id: string; narrativeOrder?: number }
>(items: readonly T[]): T[] {
  if (items.some(({ narrativeOrder }) => narrativeOrder === undefined)) {
    return [...items];
  }
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => {
      const leftOrder = left.item.narrativeOrder ?? 0;
      const rightOrder = right.item.narrativeOrder ?? 0;
      return leftOrder - rightOrder || left.sourceIndex - right.sourceIndex;
    })
    .map(({ item }) => item);
}

export type LongChapterNavigationMove = "allowed" | "edge" | "recorded";

/** Swapping with a neighbour moves both, so a recorded chapter on either side blocks it. */
export function longChapterNavigationMove(
  orderedItems: readonly { recorded?: boolean }[],
  index: number,
  direction: "up" | "down"
): LongChapterNavigationMove {
  const neighbour = orderedItems[direction === "up" ? index - 1 : index + 1];
  if (!neighbour || !orderedItems[index]) return "edge";
  return orderedItems[index].recorded || neighbour.recorded
    ? "recorded"
    : "allowed";
}
