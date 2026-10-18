import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { SafeWebSearchError } from "./web-search-errors";

export const WEB_SEARCH_CONFIG_FILE = "config/web-search.json";

export async function readWebSearchJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new SafeWebSearchError("联网搜索配置文件无法读取，请检查本地文件。");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // The file holds encrypted keys; never echo any of it.
    throw new SafeWebSearchError(
      `联网搜索配置文件（${WEB_SEARCH_CONFIG_FILE}）损坏，无法读取。`
    );
  }
}

export async function writeWebSearchJson(
  path: string,
  value: unknown
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch {
    throw new SafeWebSearchError("联网搜索配置保存失败，请检查本地存储空间。");
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
