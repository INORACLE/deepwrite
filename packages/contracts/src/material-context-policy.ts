/** A persistent, non-rendering marker; not a name/description header. */
export const MATERIAL_ON_DEMAND_MARKER =
  "<!-- deepwrite:material-on-demand -->";

export function isOnDemandMaterial(content: string): boolean {
  const text = content.replace(/^\uFEFF/, "");
  return (
    text.startsWith(MATERIAL_ON_DEMAND_MARKER) &&
    /^(?:\r?\n|$)/u.test(text.slice(MATERIAL_ON_DEMAND_MARKER.length))
  );
}
