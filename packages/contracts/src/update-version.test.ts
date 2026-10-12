import { describe, expect, it } from "vitest";
import { compareVersions } from "./update-version";

describe("DeepWrite release ordering", () => {
  it.each([
    ["1.6.3", "1.6.303"],
    ["1.6.303", "1.6.308"],
    ["1.6.303", "1.6.4"],
    ["1.6.308", "1.6.4"],
    ["1.6.399", "1.6.4"],
    ["1.6.10", "1.6.9"],
    ["1.10.0", "1.9.0"],
    ["10.0.0", "2.0.0"],
    ["1.7.303", "1.7.4"],
    ["2.6.303", "2.6.4"]
  ])("orders %s before %s by characters", (older, newer) => {
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
  });

  it("uses character order for prerelease suffixes and their numeric identifiers", () => {
    expect(compareVersions("1.6.303-beta.10", "1.6.303-beta.2")).toBeLessThan(
      0
    );
    expect(compareVersions("1.6.303-beta.10", "1.6.303")).toBeGreaterThan(0);
    expect(compareVersions("1.6.308", "1.6.4-beta.1")).toBeLessThan(0);
    expect(compareVersions("1.6.4-beta.1", "1.6.4")).toBeGreaterThan(0);
    expect(compareVersions("1.6.4-alpha", "1.6.4-beta")).toBeLessThan(0);
  });

  it("recognizes equal versions and rejects malformed versions", () => {
    expect(compareVersions("1.6.303", "1.6.303")).toBe(0);
    expect(compareVersions("1.6.4", "1.6.4")).toBe(0);
    expect(compareVersions(" 1.6.4 ", "1.6.4")).toBe(0);
    expect(() => compareVersions("invalid", "1.6.4")).toThrow("无法比较版本号");
  });
});
