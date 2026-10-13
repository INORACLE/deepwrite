import type {
  LongBookDecompositionJob,
  DecompositionRegistry
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
const t = createScopedTranslator("extras.longBookDecomposition");

export function decompositionUnitLabel(
  job: LongBookDecompositionJob,
  id: string,
  registry: DecompositionRegistry | null
): string {
  const unit = job.units[id];
  // Until the registry is loaded for this task, show a number, not a raw id.
  const name = (registryId: string) =>
    registry?.characters.find(({ id }) => id === registryId)?.name ??
    registryId.replace(/^c(?=\d)/, "#");
  if (unit?.topic) return unit.topic.title;
  if (unit?.biography)
    return t("unitBiography", {
      name: name(unit.biography.registryId),
      volume: unit.biography.volume
    });
  if (id.startsWith("character:"))
    return t("unitCharacter", { name: name(id.slice(10)) });
  if (id.startsWith("world:"))
    return t("unitWorld", {
      name:
        job.profile.worldCategories.find(({ id: key }) => key === id.slice(6))
          ?.title ?? id.slice(6)
    });
  const chunk = job.chunks.find(
    (chunk) => chunk.id === id || job.units[chunk.id]?.dependencies.includes(id)
  );
  if (chunk) {
    if (id === chunk.id)
      return t("unitChunk", { start: chunk.startOrder, end: chunk.endOrder });
    return t("unitReading", {
      order:
        chunk.startOrder + (job.units[chunk.id]?.dependencies.indexOf(id) ?? 0),
      part: chunk.segment
        ? ` · ${chunk.segment.index}/${chunk.segment.count}`
        : ""
    });
  }
  const segment = job.chronicleSegments?.find((segment) => segment.id === id);
  if (segment)
    return t("unitChronicle", {
      start:
        job.chunks.find(({ id }) => id === segment.chunkIds[0])?.startOrder ??
        job.source.range.start,
      end:
        job.chunks.find(({ id }) => id === segment.chunkIds.at(-1))?.endOrder ??
        job.source.range.end
    });
  if (id.startsWith("registry:part:"))
    return t("unitRegistryPart", { number: id.slice(14) });
  if (id === "registry:merge") return t("registry");
  if (id.startsWith("review:"))
    return t("unitReview", {
      domain: t(
        id.slice(7) === "character"
          ? "characters"
          : id.slice(7) === "world"
            ? "worldCategories"
            : id.slice(7) === "plot"
              ? "plotLabel"
              : id.slice(7) === "style"
                ? "styleLabel"
                : "continuityLabel"
      )
    });
  if (id === "plot:book-line") return t("bookLineLabel");
  if (id === "plot:foreshadowing") return t("foreshadowingLabel");
  if (id === "plot:opening") return t("openingLabel");
  if (id === "style:profile") return t("styleLabel");
  if (id === "continuity:latest") return t("continuityLabel");
  if (id === "summary:characters") return t("characterOverviewLabel");
  return id;
}
