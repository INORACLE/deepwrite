import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPublishedRelease,
  uploadReleaseAssets
} from "./publish-release-assets.mjs";

const temporaryDirectories = [];
const tag = "v9.8.7";
const repo = { owner: "example-owner", repo: "example-repository" };
const installer = "DeepWrite-9.8.7-win-x64-test.exe";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-release-upload-"));
  temporaryDirectories.push(directory);
  for (const name of [installer, "latest.yml", "SHA256SUMS.txt"]) {
    await writeFile(join(directory, name), `test data for ${name}`);
  }
  const release = {
    id: 42,
    tag_name: tag,
    draft: false,
    immutable: false,
    html_url: "https://example.test/releases/v9.8.7"
  };
  const assets = [];
  const uploads = [];
  const github = {
    rest: {
      repos: {
        getReleaseByTag: vi.fn(async () => ({ data: release })),
        listReleaseAssets: vi.fn(),
        uploadReleaseAsset: vi.fn(async ({ name, data }) => {
          uploads.push(name);
          const asset = {
            name,
            size: data.length,
            state: "uploaded",
            digest: `sha256:${createHash("sha256").update(data).digest("hex")}`
          };
          assets.push(asset);
          return { data: asset };
        })
      }
    },
    paginate: vi.fn(async () => assets.map((asset) => ({ ...asset })))
  };
  const args = { github, repo, tag, releaseId: 42, directory };
  return { args, github, release, assets, uploads };
}

describe("published release asset uploads", () => {
  it("uploads update metadata after downloads and verifies the remote digests", async () => {
    const { args, github, uploads } = await fixture();
    expect(await uploadReleaseAssets(args)).toBe(
      "https://example.test/releases/v9.8.7"
    );
    expect(uploads).toEqual([installer, "SHA256SUMS.txt", "latest.yml"]);
    expect(github.paginate).toHaveBeenCalledTimes(2);
    expect(github.rest.repos.uploadReleaseAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        ...repo,
        release_id: 42,
        name: installer,
        data: await readFile(join(args.directory, installer))
      })
    );
  });

  it("resumes an interrupted upload without replacing completed downloads", async () => {
    const { args, github, uploads } = await fixture();
    const upload = github.rest.repos.uploadReleaseAsset.getMockImplementation();
    github.rest.repos.uploadReleaseAsset
      .mockImplementationOnce(upload)
      .mockRejectedValueOnce(new Error("temporary upload failure"));
    await expect(uploadReleaseAssets(args)).rejects.toThrow(
      "temporary upload failure"
    );
    expect(uploads).toEqual([installer]);
    await expect(uploadReleaseAssets(args)).resolves.toBe(
      "https://example.test/releases/v9.8.7"
    );
    expect(uploads).toEqual([installer, "SHA256SUMS.txt", "latest.yml"]);
  });

  it("does not upload twice when a completed job runs again", async () => {
    const { args, uploads } = await fixture();
    await uploadReleaseAssets(args);
    await uploadReleaseAssets(args);
    expect(uploads).toHaveLength(3);
  });

  it.each([
    "different digest",
    "missing digest",
    "wrong size",
    "incomplete upload"
  ])("preserves an existing asset with %s", async (reason) => {
    const { args, assets, uploads } = await fixture();
    const data = await readFile(join(args.directory, "latest.yml"));
    const asset = {
      name: "latest.yml",
      size: data.length,
      state: "uploaded",
      digest: `sha256:${createHash("sha256").update(data).digest("hex")}`
    };
    if (reason === "different digest") asset.digest = "sha256:invalid";
    if (reason === "missing digest") delete asset.digest;
    if (reason === "wrong size") asset.size += 1;
    if (reason === "incomplete upload") asset.state = "starter";
    assets.push(asset);
    await expect(uploadReleaseAssets(args)).rejects.toThrow("拒绝覆盖");
    expect(uploads).toEqual([]);
  });

  it.each(["draft", "immutable"])(
    "rejects a %s release before any upload",
    async (field) => {
      const { args, release, uploads } = await fixture();
      release[field] = true;
      await expect(uploadReleaseAssets(args)).rejects.toThrow();
      expect(uploads).toEqual([]);
    }
  );

  it("rejects a release replaced after the build started", async () => {
    const { args, release, uploads } = await fixture();
    release.id = 43;
    await expect(uploadReleaseAssets(args)).rejects.toThrow("Release 已改变");
    expect(uploads).toEqual([]);
  });

  it("rejects a changed release tag", async () => {
    const { args, release } = await fixture();
    release.tag_name = "v9.8.8";
    await expect(getPublishedRelease(args)).rejects.toThrow("Release 已改变");
  });

  it("does not treat a missing release as permission to create one", async () => {
    const { args, github, uploads } = await fixture();
    github.rest.repos.getReleaseByTag.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 })
    );
    await expect(uploadReleaseAssets(args)).rejects.toThrow("not found");
    expect(uploads).toEqual([]);
  });

  it("reports remote corruption after uploading", async () => {
    const { args, github, assets } = await fixture();
    github.paginate
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        assets[0].digest = "sha256:invalid";
        return assets;
      });
    await expect(uploadReleaseAssets(args)).rejects.toThrow("SHA-256 校验失败");
  });

  it("rejects empty local files before uploading anything", async () => {
    const { args, uploads } = await fixture();
    await writeFile(join(args.directory, "latest.yml"), "");
    await expect(uploadReleaseAssets(args)).rejects.toThrow("非空");
    expect(uploads).toEqual([]);
  });
});
