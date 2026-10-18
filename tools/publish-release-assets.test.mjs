import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getReleaseForUpload,
  publishTagRelease,
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
  const releases = [];
  const github = {
    rest: {
      repos: {
        getReleaseByTag: vi.fn(async () => ({ data: release })),
        getRelease: vi.fn(async () => ({ data: release })),
        listReleases: vi.fn(),
        createRelease: vi.fn(async (options) => {
          Object.assign(release, options);
          releases.push(release);
          return { data: release };
        }),
        updateRelease: vi.fn(async (options) => {
          Object.assign(release, options);
          return { data: release };
        }),
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
    paginate: vi.fn(async (method) =>
      method === github.rest.repos.listReleases
        ? releases.map((item) => ({ ...item }))
        : assets.map((asset) => ({ ...asset }))
    )
  };
  const args = { github, repo, tag, releaseId: 42, directory };
  return { args, github, release, releases, assets, uploads };
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
    await expect(getReleaseForUpload(args)).rejects.toThrow("Release 已改变");
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

const commit = "a".repeat(40);
const runId = 123;
const owner = `<!-- deepwrite-tag-build:${runId}:${commit} -->`;

async function tagFixture() {
  const result = await fixture();
  return { ...result, args: { ...result.args, commit, runId } };
}

describe("tag-triggered release publication", () => {
  it("creates a draft and publishes only after all assets are verified", async () => {
    const { args, github, release, uploads } = await tagFixture();
    const update = github.rest.repos.updateRelease.getMockImplementation();
    github.rest.repos.updateRelease.mockImplementation(async (options) => {
      expect(release.draft).toBe(true);
      expect(uploads).toHaveLength(3);
      return update(options);
    });
    await expect(publishTagRelease(args)).resolves.toBe(release.html_url);
    expect(github.rest.repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tag_name: tag,
        target_commitish: commit,
        draft: true,
        prerelease: false,
        generate_release_notes: true,
        body: owner
      })
    );
    expect(github.rest.repos.updateRelease).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: 42, draft: false })
    );
    expect(release.draft).toBe(false);
  });

  it("keeps interrupted uploads private and resumes the same run's draft", async () => {
    const { args, github, release, uploads } = await tagFixture();
    const upload = github.rest.repos.uploadReleaseAsset.getMockImplementation();
    github.rest.repos.uploadReleaseAsset
      .mockImplementationOnce(upload)
      .mockRejectedValueOnce(new Error("temporary upload failure"));
    await expect(publishTagRelease(args)).rejects.toThrow(
      "temporary upload failure"
    );
    expect(release.draft).toBe(true);
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
    await expect(publishTagRelease(args)).resolves.toBe(release.html_url);
    expect(github.rest.repos.createRelease).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(3);
  });

  it.each(["public release", "another draft", "changed source"])(
    "preserves an existing %s",
    async (kind) => {
      const { args, github, release, releases, uploads } = await tagFixture();
      release.draft = kind !== "public release";
      release.body =
        kind === "changed source"
          ? owner.replace(commit, "b".repeat(40))
          : "user release notes";
      releases.push(release);
      await expect(publishTagRelease(args)).rejects.toThrow("拒绝覆盖");
      expect(uploads).toEqual([]);
      expect(github.rest.repos.createRelease).not.toHaveBeenCalled();
      expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
    }
  );

  it("does not publish a draft with unexpected attachments", async () => {
    const { args, github, release, releases, assets } = await tagFixture();
    Object.assign(release, { draft: true, body: owner });
    releases.push(release);
    assets.push({ name: "unrelated-file.txt" });
    await expect(publishTagRelease(args)).rejects.toThrow("产物以外");
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });

  it("does not publish when the uploaded digest fails verification", async () => {
    const { args, github, release, assets } = await tagFixture();
    const paginate = github.paginate.getMockImplementation();
    let assetReads = 0;
    github.paginate.mockImplementation(async (method, params) => {
      if (method === github.rest.repos.listReleaseAssets && ++assetReads === 2)
        assets[0].digest = "sha256:invalid";
      return paginate(method, params);
    });
    await expect(publishTagRelease(args)).rejects.toThrow("SHA-256 校验失败");
    expect(release.draft).toBe(true);
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });

  it.each([{ tag: "v9.8.7-beta" }, { commit: "main" }, { runId: undefined }])(
    "rejects invalid publication identity %j",
    async (invalid) => {
      const { args, github } = await tagFixture();
      await expect(publishTagRelease({ ...args, ...invalid })).rejects.toThrow(
        "无效"
      );
      expect(github.paginate).not.toHaveBeenCalled();
    }
  );

  it("propagates listing failures instead of creating an unrelated release", async () => {
    const { args, github } = await tagFixture();
    github.paginate.mockRejectedValueOnce(new Error("permission denied"));
    await expect(publishTagRelease(args)).rejects.toThrow("permission denied");
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled();
  });
});
