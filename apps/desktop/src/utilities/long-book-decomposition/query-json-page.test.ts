import { expect, it } from "vitest";
import { pageJsonValue } from "./query-json-page";

it.each([1, 7, 37, 12000])(
  "preserves JSON.stringify output across %i-character page boundaries",
  (pageCharacters) => {
    const value = {
      omitted: undefined,
      'quote"': '中文😀\ud800\n\t\\"'.repeat(20),
      values: [undefined, null, true, false, -0, Infinity, NaN],
      records: [
        { absent: undefined, title: "第一章" },
        { title: "第二章", nested: { absent: undefined, present: null } }
      ]
    };
    const expected = JSON.stringify(value);
    let cursor = 0;
    let content = "";
    do {
      const page = pageJsonValue(value, cursor, pageCharacters);
      expect(page.content).toBe(
        expected.slice(cursor, cursor + pageCharacters)
      );
      expect(page.content.length).toBeLessThanOrEqual(pageCharacters);
      expect(page.totalCharacters).toBe(expected.length);
      content += page.content;
      if (page.nextCursor === null) break;
      expect(page.nextCursor).toBe(cursor + pageCharacters);
      cursor = page.nextCursor;
    } while (cursor < expected.length);
    expect(content).toBe(expected);
    expect(JSON.parse(content)).toEqual(JSON.parse(expected));
  }
);

it("returns an empty terminal page for a cursor at or beyond the end", () => {
  const value = { chapter: "终章" };
  const totalCharacters = JSON.stringify(value).length;
  for (const cursor of [totalCharacters, totalCharacters + 100]) {
    expect(pageJsonValue(value, cursor, 7)).toEqual({
      content: "",
      nextCursor: null,
      totalCharacters
    });
  }
});
