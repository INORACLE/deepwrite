import { rm } from "node:fs/promises";

export async function cleanupDecompositionRoots(
  roots: string[]
): Promise<void> {
  const results = await Promise.allSettled(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failures.length) {
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      "拆书测试临时目录清理失败。"
    );
  }
}
