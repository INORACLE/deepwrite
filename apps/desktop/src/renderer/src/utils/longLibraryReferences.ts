import { createScopedTranslator } from "../i18n";
import {
  ATTACHED_CONTEXT_MAX_ITEMS,
  MATERIAL_KINDS,
  SKILL_KINDS,
  type CatalogIndexSnapshot,
  type LongBookSummary,
  type LongAgentProfile
} from "@deepwrite/contracts/renderer";
import {
  MATERIAL_KIND_LABELS,
  MATERIAL_STAGE_KINDS,
  SKILL_KIND_LABELS
} from "../data/catalogWorkspace";
import type { ComposerReferenceOption } from "../types/conversation";

const t = createScopedTranslator("workspace.longLibraryReferences");

function catalogAttachmentId(
  domain: "material" | "skill",
  libraryId: string,
  entryId: string
): string {
  return `${domain}:${libraryId}:${entryId}`;
}

export function longSkillReferences(
  snapshot: CatalogIndexSnapshot | null,
  summary: LongBookSummary | null,
  profile: LongAgentProfile | null
): ComposerReferenceOption[] {
  if (!snapshot || !summary || !profile) return [];
  const readableKinds = new Set(profile.readAccess.skillKinds);
  const libraries = new Map(
    snapshot.skills.map((library) => [library.id, library])
  );
  const seenLibraries = new Set<string>();
  const references: ComposerReferenceOption[] = [];
  for (const selectedKind of SKILL_KINDS) {
    if (!readableKinds.has(selectedKind)) continue;
    for (const libraryId of summary.linkedSkillIdsByKind[selectedKind]) {
      if (seenLibraries.has(libraryId)) continue;
      seenLibraries.add(libraryId);
      const library = libraries.get(libraryId);
      if (!library || !readableKinds.has(library.skillKind)) continue;
      for (const entry of library.entries) {
        if (entry.contentBytes <= 0) continue;
        references.push({
          id: catalogAttachmentId("skill", library.id, entry.id),
          label: `${library.title} · ${entry.title}`,
          detail: t("linkedToThisNovel", {
            value: SKILL_KIND_LABELS[library.skillKind]
          })
        });
        if (references.length >= ATTACHED_CONTEXT_MAX_ITEMS) {
          return references;
        }
      }
    }
  }
  return references;
}

export function longMaterialReferences(
  snapshot: CatalogIndexSnapshot | null,
  summary: LongBookSummary | null,
  profile: LongAgentProfile | null
): ComposerReferenceOption[] {
  if (!snapshot || !summary || !profile) return [];
  const readableKinds = new Set(profile.readAccess.materialKinds);
  const libraries = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  const seenEntries = new Set<string>();
  const references: ComposerReferenceOption[] = [];
  for (const selectedKind of MATERIAL_KINDS) {
    if (!readableKinds.has(selectedKind)) continue;
    for (const libraryId of summary.linkedMaterialIdsByKind[selectedKind]) {
      const library = libraries.get(libraryId);
      if (!library) continue;
      for (const entry of library.entries) {
        const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
        const entryId = catalogAttachmentId("material", library.id, entry.id);
        if (
          entryKind !== selectedKind ||
          entry.contentBytes <= 0 ||
          seenEntries.has(entryId)
        ) {
          continue;
        }
        seenEntries.add(entryId);
        references.push({
          id: entryId,
          label: `${library.title} · ${entry.title}`,
          detail: t("linkedToThisNovel", {
            value: MATERIAL_KIND_LABELS[entryKind]
          })
        });
      }
    }
  }
  return references;
}
