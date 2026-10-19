/** Serialize plain query data in fragments, preserving JSON's optional fields. */
function* jsonFragments(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    yield "[";
    for (const [index, item] of value.entries()) {
      if (index > 0) yield ",";
      yield* jsonFragments(item);
    }
    yield "]";
    return;
  }
  if (value !== null && typeof value === "object") {
    yield "{";
    let separator = "";
    for (const [key, item] of Object.entries(value)) {
      // JSON omits undefined object properties but uses null in arrays.
      if (item === undefined) continue;
      yield `${separator}${JSON.stringify(key)}:`;
      yield* jsonFragments(item);
      separator = ",";
    }
    yield "}";
    return;
  }
  yield JSON.stringify(value) ?? "null";
}

export function pageJsonValue(
  value: unknown,
  cursor: number,
  pageCharacters: number
): { content: string; nextCursor: number | null; totalCharacters: number } {
  const start = Math.max(0, cursor);
  const end = start + pageCharacters;
  let offset = 0;
  let content = "";
  for (const fragment of jsonFragments(value)) {
    const fragmentEnd = offset + fragment.length;
    if (fragmentEnd > start && offset < end) {
      content += fragment.slice(
        Math.max(0, start - offset),
        Math.min(fragment.length, end - offset)
      );
    }
    offset = fragmentEnd;
  }
  return {
    content,
    nextCursor: end < offset ? end : null,
    totalCharacters: offset
  };
}
