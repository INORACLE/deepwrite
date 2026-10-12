const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// DeepWrite orders every version by characters, so 1.6.4 follows 1.6.303.
export function compareVersions(left: string, right: string): number {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (
    !versionPattern.test(normalizedLeft) ||
    !versionPattern.test(normalizedRight)
  ) {
    throw new Error(`无法比较版本号：${left} / ${right}`);
  }
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? 1 : -1;
}
