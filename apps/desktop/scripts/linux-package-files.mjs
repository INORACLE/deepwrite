import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const digest = (value) => createHash("sha256").update(value).digest("hex");
function command(name, args, binary = false) {
  return execFileSync(name, args, {
    encoding: binary ? undefined : "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000
  });
}

export async function verifyLinuxPackageFiles(directory, version) {
  const prefix = `DeepWrite-${version}-linux-`;
  const names = [
    `${prefix}x86_64-test.AppImage`,
    `${prefix}amd64-test.deb`,
    `${prefix}x86_64-test.rpm`,
    `${prefix}x64-test.pkg.tar.zst`
  ];
  for (const name of names) {
    const info = await stat(join(directory, name));
    if (!info.isFile() || !info.size)
      throw new Error(`Test package is missing or empty: ${name}`);
  }
  const expected = digest(
    await readFile(join(directory, "linux-unpacked/resources/app.asar"))
  );
  const temporary = await mkdtemp(join(tmpdir(), "deepwrite-rpm-payload-"));
  try {
    for (const name of names.slice(2)) {
      const path = join(directory, name);
      const archive = name.endsWith(".rpm")
        ? join(temporary, "payload.cpio")
        : path;
      if (name.endsWith(".rpm")) {
        const output = await open(archive, "w");
        try {
          execFileSync("rpm2cpio", [path], {
            stdio: ["ignore", output.fd, "pipe"],
            timeout: 60_000
          });
        } finally {
          await output.close();
        }
      }
      const entries = command("bsdtar", ["-tf", archive])
        .trim()
        .split("\n")
        .map((entry) => ({
          raw: entry,
          name: entry.replace(/^(\.\/|\/)+/, "")
        }));
      for (const required of [
        "opt/DeepWrite/deepwrite",
        "opt/DeepWrite/resources/app.asar",
        "usr/share/applications/DeepWrite.desktop"
      ]) {
        if (!entries.some((entry) => entry.name === required))
          throw new Error(
            `Linux package file is missing: ${required} (${name})`
          );
      }
      const asar = entries.find(
        (entry) => entry.name === "opt/DeepWrite/resources/app.asar"
      );
      if (
        digest(command("bsdtar", ["-xOf", archive, asar.raw], true)) !==
        expected
      )
        throw new Error(
          `Linux package runtime differs from verified app: ${name}`
        );
      if (name.endsWith(".rpm")) {
        const metadata = command("rpm", [
          "--dbpath",
          temporary,
          "-qp",
          "--queryformat",
          "%{NAME}\n%{VERSION}\n%{ARCH}\n",
          path
        ]).trim();
        if (metadata !== `deepwrite\n${version}\nx86_64`)
          throw new Error(`Invalid RPM package metadata: ${name}`);
      } else {
        const metadata = command("bsdtar", ["-xOf", path, ".PKGINFO"]);
        for (const field of [
          "pkgname = deepwrite",
          `pkgver = ${version.replaceAll("-", "_")}-1`,
          "arch = x86_64",
          "depend = libsecret"
        ]) {
          if (!metadata.split("\n").includes(field))
            throw new Error(`Invalid Arch package metadata: missing ${field}`);
        }
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return names;
}
