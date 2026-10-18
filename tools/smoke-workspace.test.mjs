import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { GeneralSettingsSchema } from "../packages/contracts/src/general-settings.ts";
import { prepareSmokeWorkspace } from "../apps/desktop/scripts/smoke-workspace.mjs";

it("seeds deterministic UI language without overwriting settings on reopen", async () => {
  const profile = await mkdtemp(
    join(tmpdir(), "deepwrite-smoke-profile-test-")
  );
  try {
    await prepareSmokeWorkspace(profile);
    const path = join(profile, "config", "general-settings.json");
    const initial = JSON.parse(await readFile(path, "utf8"));
    expect(GeneralSettingsSchema.parse(initial).language).toBe("zh-CN");
    expect(
      JSON.parse(
        await readFile(
          join(profile, "config", "workspace-directory.json"),
          "utf8"
        )
      )
    ).toEqual({ version: 1, path: join(profile, "workspace") });
    await writeFile(path, JSON.stringify({ ...initial, language: "en-US" }));
    await prepareSmokeWorkspace(profile);
    expect(JSON.parse(await readFile(path, "utf8")).language).toBe("en-US");
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
