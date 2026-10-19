import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";
import { spawn } from "node:child_process";
import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";

export function validateSmokeSummary(
  summary,
  reopened,
  requireReleaseConfig = process.env.DEEPWRITE_REQUIRE_RELEASE_CONFIG === "1"
) {
  if (
    requireReleaseConfig &&
    (summary.releaseConfig?.status !== "ok" ||
      summary.releaseConfig?.publicData !== true ||
      summary.releaseConfig?.cloudBackup !== true)
  )
    throw new Error(
      "Packaged app did not verify its bundled release configuration."
    );
  if (
    summary.health?.status !== "ok" ||
    summary.health?.workers?.length !== 3 ||
    summary.bookTemplates?.status !== "ok" ||
    summary.bookTemplates?.created !== 4 ||
    summary.agent?.status !== "ok" ||
    summary.agent?.runtime?.mode !== "local-faux" ||
    summary.agent?.completed !== true ||
    summary.conversation?.status !== "ok" ||
    summary.conversation?.staged !== true ||
    summary.conversation?.reopened !== reopened ||
    !(summary.conversation?.chunkPages >= 2) ||
    !(summary.conversation?.metadataChunkPages >= 2) ||
    summary.conversation?.unknownRetained !== true ||
    summary.conversation?.proposalRetained !== true
  )
    throw new Error(
      `Packaged app returned an invalid smoke summary: ${JSON.stringify(summary)}`
    );
}

export function packagedSmokeEnvironment(source = process.env) {
  const environment = {
    ...source,
    DEEPWRITE_SMOKE: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  };
  // Prove the package works without credentials supplied by the runner.
  if (environment.DEEPWRITE_REQUIRE_RELEASE_CONFIG === "1") {
    for (const key of Object.keys(environment)) {
      if (key.startsWith("MAIN_VITE_")) delete environment[key];
    }
  }
  return environment;
}

export async function runPackagedSmoke(
  executable,
  appDir,
  profile,
  targetPlatform
) {
  assertElectronLaunchAllowed();
  await prepareSmokeWorkspace(profile);
  let output = "";
  const environment = packagedSmokeEnvironment();
  const result = await new Promise((resolveResult) => {
    let timedOut = false;
    const child = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        ...(targetPlatform === "mac" ? ["--use-mock-keychain"] : []),
        "--use-fake-device-for-media-stream",
        // Fake microphone sampling must not depend on the host output device.
        "--disable-audio-output",
        "--password-store=basic"
      ],
      {
        cwd: appDir,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolveResult({ error });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveResult({ code, signal, timedOut });
    });
  });
  if (result.error) throw result.error;
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("DEEPWRITE_SMOKE_OK "));
  if (result.code !== 0 || !marker)
    throw new Error(
      `Packaged app smoke failed with exit code ${String(result.code)}, signal ${String(result.signal)}, timedOut ${String(result.timedOut)}:\n${output}`
    );
  return JSON.parse(marker.slice("DEEPWRITE_SMOKE_OK ".length));
}
