import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inspectReleaseFile } from "./release-files.mjs";

export async function getPublishedRelease({ github, repo, tag, releaseId }) {
  const { data } = await github.rest.repos.getReleaseByTag({ ...repo, tag });
  if (
    data.tag_name !== tag ||
    (releaseId !== undefined && String(data.id) !== String(releaseId))
  ) {
    throw new Error("Release 已改变，无法向本轮发布追加安装包。");
  }
  if (data.draft) throw new Error("请先发布 Release，再运行自动打包。");
  if (data.immutable) {
    throw new Error(
      "Release 已锁定，无法追加安装包；此流程需要关闭 Release immutability。"
    );
  }
  return data;
}

function matchesAsset(remote, local) {
  return (
    remote?.state === "uploaded" &&
    remote.size === local.size &&
    remote.digest === `sha256:${local.sha256}`
  );
}

export async function uploadReleaseAssets({
  github,
  repo,
  tag,
  releaseId,
  directory
}) {
  const release = await getPublishedRelease({ github, repo, tag, releaseId });
  const names = (await readdir(directory)).sort((left, right) => {
    // Update manifests are visible only after all download files are present.
    const priority = (name) => (name.endsWith(".yml") ? 1 : 0);
    return priority(left) - priority(right) || left.localeCompare(right);
  });
  if (!names.length) throw new Error("没有可上传的 Release 文件。");
  const localFiles = [];
  for (const name of names) {
    const path = join(directory, name);
    localFiles.push({ name, path, ...(await inspectReleaseFile(path)) });
  }
  const listAssets = () =>
    github.paginate(github.rest.repos.listReleaseAssets, {
      ...repo,
      release_id: release.id,
      per_page: 100
    });
  const existing = new Map(
    (await listAssets()).map((file) => [file.name, file])
  );
  // Check all collisions before uploading anything; public downloads are preserved.
  for (const local of localFiles) {
    const remote = existing.get(local.name);
    if (remote && !matchesAsset(remote, local)) {
      throw new Error(
        `Release 已有不同内容的同名文件，拒绝覆盖：${local.name}`
      );
    }
  }
  for (const local of localFiles) {
    if (existing.has(local.name)) continue;
    const data = await readFile(local.path);
    if (createHash("sha256").update(data).digest("hex") !== local.sha256) {
      throw new Error(`Release 文件在上传前发生改变：${local.name}`);
    }
    await github.rest.repos.uploadReleaseAsset({
      ...repo,
      release_id: release.id,
      name: local.name,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": data.length
      },
      data
    });
  }
  const uploaded = new Map(
    (await listAssets()).map((file) => [file.name, file])
  );
  for (const local of localFiles) {
    if (!matchesAsset(uploaded.get(local.name), local)) {
      throw new Error(
        `Release 文件上传后的大小或 SHA-256 校验失败：${local.name}`
      );
    }
  }
  return release.html_url;
}
