/** Run the JS CLI directly because Windows cannot spawn a .cmd without a shell. */
export function pnpmInvocation(
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    npmExecPath = process.env.npm_execpath
  } = {}
) {
  if (npmExecPath && /\.[cm]?js$/iu.test(npmExecPath)) {
    return { command: execPath, args: [npmExecPath, ...args] };
  }
  if (platform === "win32") {
    throw new Error("请通过 pnpm pack:test:* 运行打包，以取得 pnpm CLI 路径。");
  }
  return { command: "pnpm", args };
}
