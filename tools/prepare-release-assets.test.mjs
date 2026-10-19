import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareReleaseAssets } from "./prepare-release-assets.mjs";

const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const yaml = createRequire(desktopRequire.resolve("electron-builder"))(
  "js-yaml"
);
const temporaryDirectories = [];
const version = "9.8.7";
const prefix = `DeepWrite-${version}-`;
const windowsName = `${prefix}win-x64-test.exe`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-release-assets-"));
  temporaryDirectories.push(root);
  const input = join(root, "input");
  const output = join(root, "output");
  const groups = [
    ["win-x64", "latest.yml", [windowsName]],
    [
      "mac-x64",
      "latest-mac.yml",
      [`${prefix}mac-x64-test.zip`, `${prefix}mac-x64-test.dmg`]
    ],
    [
      "mac-arm64",
      "latest-mac.yml",
      [`${prefix}mac-arm64-test.zip`, `${prefix}mac-arm64-test.dmg`]
    ],
    [
      "linux-x64",
      "latest-linux.yml",
      [
        `${prefix}linux-x86_64-test.AppImage`,
        `${prefix}linux-amd64-test.deb`,
        `${prefix}linux-x86_64-test.rpm`,
        `${prefix}linux-x64-test.pkg.tar.zst`
      ]
    ]
  ];
  for (const [id, manifestName, installers] of groups) {
    const directory = join(input, `installers-${id}`);
    await mkdir(directory, { recursive: true });
    const files = [];
    for (const name of installers) {
      const contents = Buffer.from(`test installer ${name}`);
      await writeFile(join(directory, name), contents);
      files.push({
        url: name,
        size: contents.length,
        sha512: createHash("sha512").update(contents).digest("base64")
      });
      if (/\.(zip|exe)$/u.test(name)) {
        await writeFile(
          join(directory, `${name}.blockmap`),
          `blockmap ${name}`
        );
      }
    }
    await writeFile(
      join(directory, manifestName),
      yaml.dump({
        version,
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        releaseDate: "2026-10-17T00:00:00.000Z"
      })
    );
  }
  const manifestPath = join(input, "installers-win-x64", "latest.yml");
  return { input, output, manifestPath };
}

async function changeManifest(path, change) {
  const manifest = yaml.load(await readFile(path, "utf8"));
  change(manifest);
  await writeFile(path, yaml.dump(manifest));
}

describe("release asset preparation", () => {
  it("merges both Mac architectures and provides hashes for every upload", async () => {
    const { input, output } = await fixture();
    const names = await prepareReleaseAssets(input, output, version);
    expect(names).toHaveLength(16);
    expect(names).toContain(`${prefix}linux-x86_64-test.rpm`);
    expect(names).toContain(`${prefix}linux-x64-test.pkg.tar.zst`);
    const manifest = yaml.load(
      await readFile(join(output, "latest-mac.yml"), "utf8")
    );
    expect(manifest.files.map((entry) => entry.url)).toEqual([
      `${prefix}mac-x64-test.zip`,
      `${prefix}mac-x64-test.dmg`,
      `${prefix}mac-arm64-test.zip`,
      `${prefix}mac-arm64-test.dmg`
    ]);
    expect(manifest.path).toBe(`${prefix}mac-x64-test.zip`);
    const checksums = (await readFile(join(output, "SHA256SUMS.txt"), "utf8"))
      .trim()
      .split("\n");
    expect(checksums).toHaveLength(15);
    for (const line of checksums) {
      const [hash, name] = line.split("  ");
      expect(hash).toBe(
        createHash("sha256")
          .update(await readFile(join(output, name)))
          .digest("hex")
      );
    }
  });

  it.each([
    ["win-x64", windowsName],
    ["linux-x64", `${prefix}linux-x86_64-test.rpm`],
    ["linux-x64", `${prefix}linux-x64-test.pkg.tar.zst`]
  ])(
    "rejects a modified %s installer before copying upload files",
    async (group, name) => {
      const { input, output } = await fixture();
      await writeFile(join(input, `installers-${group}`, name), "corrupt");
      await expect(
        prepareReleaseAssets(input, output, version)
      ).rejects.toThrow("SHA-512");
      expect(await readdir(output)).toEqual([]);
    }
  );

  it.each(["x86_64-test.rpm", "x64-test.pkg.tar.zst"])(
    "requires Linux %s before publishing",
    async (suffix) => {
      const { input, output } = await fixture();
      await rm(join(input, "installers-linux-x64", `${prefix}linux-${suffix}`));
      await expect(
        prepareReleaseAssets(input, output, version)
      ).rejects.toThrow("缺少 linux-x64");
      expect(await readdir(output)).toEqual([]);
    }
  );

  it.each(["x86_64-test.rpm", "x64-test.pkg.tar.zst"])(
    "normalizes Linux primary when %s finishes first",
    async (suffix) => {
      const { input, output } = await fixture();
      await changeManifest(
        join(input, "installers-linux-x64", "latest-linux.yml"),
        (manifest) => {
          const primary = manifest.files.find(
            (file) => file.url === `${prefix}linux-${suffix}`
          );
          manifest.path = primary.url;
          manifest.sha512 = primary.sha512;
        }
      );
      await prepareReleaseAssets(input, output, version);
      const manifest = yaml.load(
        await readFile(join(output, "latest-linux.yml"), "utf8")
      );
      expect(manifest.files).toHaveLength(4);
      expect(manifest.path).toBe(`${prefix}linux-x86_64-test.AppImage`);
      expect(manifest.sha512).toBe(manifest.files[0].sha512);
    }
  );

  it.each([
    [
      "version mismatch",
      (manifest) => {
        manifest.version = "9.8.6";
      }
    ],
    [
      "duplicate files",
      (manifest) => {
        manifest.files.push(manifest.files[0]);
      }
    ],
    [
      "external URL",
      (manifest) => {
        manifest.files[0].url = "https://example.test/installer.exe";
      }
    ],
    [
      "traversal path",
      (manifest) => {
        manifest.files[0].url = `../${windowsName}`;
      }
    ],
    [
      "wrong size",
      (manifest) => {
        manifest.files[0].size += 1;
      }
    ],
    [
      "wrong primary hash",
      (manifest) => {
        manifest.sha512 = "invalid-sha512";
      }
    ],
    [
      "missing installer reference",
      (manifest) => {
        manifest.files = [];
      }
    ]
  ])("rejects a manifest with %s", async (_description, change) => {
    const { input, output, manifestPath } = await fixture();
    await changeManifest(manifestPath, change);
    await expect(
      prepareReleaseAssets(input, output, version)
    ).rejects.toThrow();
    expect(await readdir(output)).toEqual([]);
  });

  it("requires blockmaps and all platform artifacts", async () => {
    const { input, output } = await fixture();
    await rm(
      join(
        input,
        "installers-mac-arm64",
        `${prefix}mac-arm64-test.zip.blockmap`
      )
    );
    await expect(prepareReleaseAssets(input, output, version)).rejects.toThrow(
      "缺少 mac-arm64"
    );
  });

  it("rejects unexpected files", async () => {
    const { input, output } = await fixture();
    await writeFile(
      join(input, "installers-win-x64", "unexpected.txt"),
      "unexpected"
    );
    await expect(prepareReleaseAssets(input, output, version)).rejects.toThrow(
      "意外"
    );
  });

  it("rejects empty files", async () => {
    const { input, output } = await fixture();
    await writeFile(
      join(input, "installers-win-x64", `${windowsName}.blockmap`),
      ""
    );
    await expect(prepareReleaseAssets(input, output, version)).rejects.toThrow(
      "非空"
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks in release artifacts",
    async () => {
      const { input, output } = await fixture();
      const path = join(input, "installers-win-x64", `${windowsName}.blockmap`);
      await rm(path);
      await symlink(join(input, "installers-win-x64", windowsName), path);
      await expect(
        prepareReleaseAssets(input, output, version)
      ).rejects.toThrow("普通文件");
    }
  );

  it("preserves an existing upload directory", async () => {
    const { input, output } = await fixture();
    await mkdir(output);
    await writeFile(join(output, "keep.txt"), "keep");
    await expect(prepareReleaseAssets(input, output, version)).rejects.toThrow(
      "必须为空"
    );
    expect(await readFile(join(output, "keep.txt"), "utf8")).toBe("keep");
  });
});
