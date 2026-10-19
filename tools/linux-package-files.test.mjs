import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyLinuxPackageFiles } from "../apps/desktop/scripts/linux-package-files.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const version = "9.8.7";
const prefix = `DeepWrite-${version}-linux-`;
const names = [
  "x86_64-test.AppImage",
  "amd64-test.deb",
  "x86_64-test.rpm",
  "x64-test.pkg.tar.zst"
];
let root;
let payload;
let entries;
let metadata;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "deepwrite-linux-packages-"));
  await mkdir(join(root, "linux-unpacked/resources"), { recursive: true });
  await writeFile(
    join(root, "linux-unpacked/resources/app.asar"),
    "synthetic runtime"
  );
  for (const name of names)
    await writeFile(join(root, prefix + name), "synthetic package");
  payload = Buffer.from("synthetic runtime");
  entries =
    "./opt/DeepWrite/deepwrite\n./opt/DeepWrite/resources/app.asar\n./usr/share/applications/DeepWrite.desktop\n";
  metadata = `pkgname = deepwrite\npkgver = ${version}-1\narch = x86_64\ndepend = libsecret\n`;
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === "rpm") return `deepwrite\n${version}\nx86_64\n`;
    if (args[0] === "-tf") return entries;
    return args[2] === ".PKGINFO" ? metadata : payload;
  });
});
afterEach(async () => {
  vi.resetAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("validates all Linux formats and matches RPM/Arch runtime bytes to the smoke-tested app", async () => {
  await expect(verifyLinuxPackageFiles(root, version)).resolves.toHaveLength(4);
});
it.each([names[2], names[3]])("requires %s", async (name) => {
  await rm(join(root, prefix + name));
  await expect(verifyLinuxPackageFiles(root, version)).rejects.toThrow();
});
it("rejects a package missing the launcher", async () => {
  entries = entries.replace("./usr/share/applications/DeepWrite.desktop\n", "");
  await expect(verifyLinuxPackageFiles(root, version)).rejects.toThrow(
    "Linux package file is missing"
  );
});
it("rejects a different packaged runtime", async () => {
  payload = Buffer.from("different runtime");
  await expect(verifyLinuxPackageFiles(root, version)).rejects.toThrow(
    "runtime differs"
  );
});
it("rejects the wrong RPM architecture", async () => {
  vi.mocked(execFileSync).mockImplementation((command, args) =>
    command === "rpm"
      ? `deepwrite\n${version}\naarch64\n`
      : args[0] === "-tf"
        ? entries
        : payload
  );
  await expect(verifyLinuxPackageFiles(root, version)).rejects.toThrow(
    "Invalid RPM"
  );
});
it.each([
  "pkgname = deepwrite",
  `pkgver = ${version}-1`,
  "arch = x86_64",
  "depend = libsecret"
])("requires Arch metadata %s", async (field) => {
  metadata = metadata.replace(field, "invalid = placeholder");
  await expect(verifyLinuxPackageFiles(root, version)).rejects.toThrow(
    "Invalid Arch"
  );
});

it("rejects an RPM payload conversion failure", async () => {
  vi.mocked(execFileSync).mockImplementation((command) => {
    if (command === "rpm2cpio") throw new Error("Invalid RPM payload");
    throw new Error("Unexpected command");
  });
  await expect(verifyLinuxPackageFiles(root, version)).rejects.toThrow(
    "Invalid RPM payload"
  );
});
