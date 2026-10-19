import { DEEPWRITE_PUBLIC_DATA_API_CONFIGURED } from "./deepwrite-public-data-config";
import { loadCloudBackupOssConfig } from "../extras/cloud-backup/config";

export function smokeReleaseConfig(
  environment: NodeJS.ProcessEnv = process.env
) {
  if (environment.DEEPWRITE_REQUIRE_RELEASE_CONFIG !== "1") return undefined;
  if (environment.DEEPWRITE_APP_MODE !== "runtime") {
    throw new Error("Release config smoke requires runtime application mode.");
  }
  if (!DEEPWRITE_PUBLIC_DATA_API_CONFIGURED) {
    throw new Error(
      "Release config smoke: bundled public service configuration is missing."
    );
  }
  if (!loadCloudBackupOssConfig()) {
    throw new Error(
      "Release config smoke: bundled OSS configuration is missing."
    );
  }
  return { status: "ok", publicData: true, cloudBackup: true } as const;
}
