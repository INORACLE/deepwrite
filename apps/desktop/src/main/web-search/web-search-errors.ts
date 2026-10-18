/** Messages written for the user; they never carry keys, URLs or response bodies. */
export class SafeWebSearchError extends Error {}

export function safeWebSearchError(error: unknown): string {
  // Provider bodies, request headers and native network errors never cross IPC.
  return error instanceof SafeWebSearchError
    ? error.message
    : "联网搜索操作失败，请检查配置或稍后重试。";
}
