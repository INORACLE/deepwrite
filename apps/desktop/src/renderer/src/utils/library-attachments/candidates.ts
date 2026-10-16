import { createScopedTranslator } from "../../i18n";
import {
  MATERIAL_KINDS,
  SKILL_KINDS,
  resolveMaterialMetadata,
  isOnDemandMaterial,
  type CatalogSnapshot,
  type MaterialKind,
  type SkillKind
} from "@deepwrite/contracts/renderer";
import { MATERIAL_STAGE_KINDS } from "../../data/catalogWorkspace";
import {
  attachmentTitle,
  uniqueAttachmentId,
  type AttachmentCandidate,
  type LibraryAttachmentBindingTarget,
  type LibraryAttachmentDiagnostic
} from "./shared";

const t = createScopedTranslator("workspace.candidates");

export function collectMaterialCandidates(
  snapshot: CatalogSnapshot,
  book: LibraryAttachmentBindingTarget,
  diagnostics: LibraryAttachmentDiagnostic[]
): AttachmentCandidate<MaterialKind>[] {
  const libraries = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  const candidates: AttachmentCandidate<MaterialKind>[] = [];
  const usedAttachmentIds = new Set<string>();
  const seenBindings = new Set<string>();

  for (const selectedKind of MATERIAL_KINDS) {
    for (const libraryId of book.linkedMaterialIdsByKind[selectedKind]) {
      const bindingKey = `${selectedKind}:${libraryId}`;
      if (seenBindings.has(bindingKey)) {
        diagnostics.push({
          code: "duplicate-library-binding",
          domain: "material",
          message: t("materialLibraryIsLinkedMoreThanOnceUnderAnd", {
            libraryId: libraryId,
            selectedKind: selectedKind
          }),
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      seenBindings.add(bindingKey);
      const library = libraries.get(libraryId);
      if (!library) {
        diagnostics.push({
          code: "library-not-found",
          domain: "material",
          message: t("linkedMaterialLibraryDoesNotExist", {
            libraryId: libraryId
          }),
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      if (
        library.materialKind !== "mixed" &&
        library.materialKind !== selectedKind
      ) {
        diagnostics.push({
          code: "library-kind-mismatch",
          domain: "material",
          message: t("materialLibraryIsCategorizedAsButThisBookLinks", {
            title: library.title,
            materialKind: library.materialKind,
            selectedKind: selectedKind
          }),
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: library.materialKind
        });
      }
      for (const entry of library.entries) {
        const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
        if (
          entryKind !== selectedKind ||
          !entry.body.trim() ||
          isOnDemandMaterial(entry.body)
        ) {
          continue;
        }
        const baseId = `material:${library.id}:${entry.id}`;
        candidates.push({
          domain: "material",
          libraryId: library.id,
          entryId: entry.id,
          attachmentId: uniqueAttachmentId(baseId, usedAttachmentIds),
          title: attachmentTitle(library.title, entry.title, entry.id),
          content: entry.body,
          metadata: resolveMaterialMetadata({
            id: entry.id,
            title: entry.title,
            content: entry.body
          }),
          kind: entryKind
        });
      }
    }
  }
  return candidates;
}

export function collectSkillCandidates(
  snapshot: CatalogSnapshot,
  book: LibraryAttachmentBindingTarget,
  diagnostics: LibraryAttachmentDiagnostic[]
): AttachmentCandidate<SkillKind>[] {
  const libraries = new Map(
    snapshot.skills.map((library) => [library.id, library])
  );
  const candidates: AttachmentCandidate<SkillKind>[] = [];
  const usedAttachmentIds = new Set<string>();
  const seenLibraryKinds = new Map<string, SkillKind>();

  for (const selectedKind of SKILL_KINDS) {
    for (const libraryId of book.linkedSkillIdsByKind[selectedKind]) {
      const previousKind = seenLibraryKinds.get(libraryId);
      if (previousKind) {
        diagnostics.push({
          code: "duplicate-library-binding",
          domain: "skill",
          message: t("skillLibraryIsLinkedUnderBothAndItWas", {
            libraryId: libraryId,
            previousKind: previousKind,
            selectedKind: selectedKind,
            previousKind2: previousKind
          }),
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: previousKind
        });
        continue;
      }
      seenLibraryKinds.set(libraryId, selectedKind);
      const library = libraries.get(libraryId);
      if (!library) {
        diagnostics.push({
          code: "library-not-found",
          domain: "skill",
          message: t("linkedSkillLibraryDoesNotExist", {
            libraryId: libraryId
          }),
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      if (library.skillKind !== selectedKind) {
        diagnostics.push({
          code: "library-kind-mismatch",
          domain: "skill",
          message: t("skillLibraryIsCategorizedAsButThisBookLinks", {
            title: library.title,
            skillKind: library.skillKind,
            selectedKind: selectedKind
          }),
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: library.skillKind
        });
      }
      for (const entry of library.entries) {
        if (!entry.body.trim()) {
          continue;
        }
        const baseId = `skill:${library.id}:${entry.id}`;
        candidates.push({
          domain: "skill",
          libraryId: library.id,
          entryId: entry.id,
          attachmentId: uniqueAttachmentId(baseId, usedAttachmentIds),
          title: attachmentTitle(library.title, entry.title, entry.id),
          content: entry.body,
          kind: library.skillKind
        });
      }
    }
  }
  return candidates;
}
