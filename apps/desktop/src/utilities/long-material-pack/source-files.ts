import type { LongMarkdownFileReference } from "@deepwrite/contracts";
import { readSecureTextFile } from "../long-project-store/io";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const READ_CONCURRENCY = 16;

/** Reads index-referenced Markdown with bounded parallelism; missing is empty. */
export function createFileReader(projectDirectory: string) {
  return async function read(
    refs: readonly (LongMarkdownFileReference | undefined | null)[]
  ): Promise<string[]> {
    const result: string[] = [];
    for (let start = 0; start < refs.length; start += READ_CONCURRENCY)
      result.push(
        ...(await Promise.all(
          refs.slice(start, start + READ_CONCURRENCY).map(async (ref) => {
            if (!ref) return "";
            try {
              return (
                await readSecureTextFile(
                  projectDirectory,
                  ref.path,
                  MAX_FILE_BYTES
                )
              ).content;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
              throw error;
            }
          })
        ))
      );
    return result;
  };
}
