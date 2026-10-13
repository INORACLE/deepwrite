import { describe, expect, it } from "vitest";
import {
  findComposerReferenceMatch,
  insertComposerReference
} from "./composerReferences";

describe("composer references", () => {
  it("detects skill and material triggers at the caret", () => {
    expect(findComposerReferenceMatch("/剧情", 3)).toEqual({
      trigger: "/",
      start: 0,
      caret: 3,
      query: "剧情"
    });
    expect(findComposerReferenceMatch("参考@人物", 5)).toEqual({
      trigger: "@",
      start: 2,
      caret: 5,
      query: "人物"
    });
  });

  it("does not treat URLs, email addresses, or completed tokens as triggers", () => {
    expect(findComposerReferenceMatch("https://example.com", 19)).toBeNull();
    expect(findComposerReferenceMatch("name@example", 12)).toBeNull();
    expect(findComposerReferenceMatch("/剧情 后续", 6)).toBeNull();
  });

  it("replaces the active query and keeps surrounding text", () => {
    const match = findComposerReferenceMatch("请使用 /剧 完成", 6);
    expect(match).not.toBeNull();
    expect(
      insertComposerReference("请使用 /剧 完成", match!, "剧情库 · 节奏设计")
    ).toEqual({
      value: "请使用 /剧情库 · 节奏设计 完成",
      caret: 15
    });
  });

  it("detects the team member trigger only when it is enabled", () => {
    const triggers = ["/", "@", "#"] as const;
    expect(findComposerReferenceMatch("请 #文风", 5, triggers)).toEqual({
      trigger: "#",
      start: 2,
      caret: 5,
      query: "文风"
    });
    expect(findComposerReferenceMatch("请 #文风", 5)).toBeNull();
    expect(findComposerReferenceMatch("/剧情 #", 4, triggers)).toBeNull();
    expect(findComposerReferenceMatch("/剧情 #", 5, triggers)).toMatchObject({
      trigger: "#",
      query: ""
    });
  });

  it("does not treat C#, fragments or completed team mentions as triggers", () => {
    const triggers = ["/", "@", "#"] as const;
    expect(findComposerReferenceMatch("C#", 2, triggers)).toBeNull();
    expect(findComposerReferenceMatch("page#top", 8, triggers)).toBeNull();
    expect(findComposerReferenceMatch("#文风 润色", 6, triggers)).toBeNull();
  });

  it("inserts a team member reference with the # prefix", () => {
    const value = "请 #文";
    const match = findComposerReferenceMatch(value, 5, ["/", "@", "#"]);
    expect(insertComposerReference(value, match!, "文风润色师")).toEqual({
      value: "请 #文风润色师 ",
      caret: 9
    });
  });
});
