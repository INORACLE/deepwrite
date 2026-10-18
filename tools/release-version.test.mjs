import { describe, expect, it } from "vitest";
import { releaseVersion } from "./release-version.mjs";
import { pnpmInvocation } from "./pnpm-command.mjs";

describe("release version validation", () => {
  it("accepts a tag matching both package versions", () => {
    expect(releaseVersion("v9.8.7", "9.8.7", "9.8.7")).toBe("9.8.7");
    expect(releaseVersion("v0.0.0", "0.0.0", "0.0.0")).toBe("0.0.0");
  });

  it.each([undefined, "", "9.8.7", "v09.8.7", "v9.8", "v9.8.7-beta.1"])(
    "rejects invalid release tag %s",
    (tag) => {
      expect(() => releaseVersion(tag, "9.8.7", "9.8.7")).toThrow("标签必须");
    }
  );

  it.each([
    ["9.8.6", "9.8.7"],
    ["9.8.7", "9.8.6"],
    ["9.8.6", "9.8.6"]
  ])("rejects mismatched package versions %s / %s", (root, desktop) => {
    expect(() => releaseVersion("v9.8.7", root, desktop)).toThrow(
      "两个 package.json"
    );
  });
});

describe("cross-platform pnpm invocation", () => {
  it.each(["win32", "darwin", "linux"])(
    "runs the pnpm JS entry without a shell on %s",
    (platform) => {
      const args = ["exec", "node", "folder with spaces/check.mjs"];
      expect(
        pnpmInvocation(args, {
          platform,
          execPath: "/runtime with spaces/node",
          npmExecPath: "/package manager/pnpm.cjs"
        })
      ).toEqual({
        command: "/runtime with spaces/node",
        args: ["/package manager/pnpm.cjs", ...args]
      });
    }
  );

  it("reports a missing Windows CLI instead of spawning a .cmd shim", () => {
    expect(() =>
      pnpmInvocation(["verify"], { platform: "win32", npmExecPath: "" })
    ).toThrow("pnpm pack:test:");
  });

  it("retains direct node invocation on POSIX hosts", () => {
    expect(
      pnpmInvocation(["verify"], { platform: "darwin", npmExecPath: "" })
    ).toEqual({ command: "pnpm", args: ["verify"] });
  });
});
