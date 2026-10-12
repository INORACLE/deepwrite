import type {
  Book,
  CatalogSnapshot,
  CreateScriptBookInput,
  CreateShortBookInput
} from "@deepwrite/contracts";
import {
  CATALOG_PROJECT_DOMAINS,
  FolderCatalogConflictError,
  type CreateScriptBookAtDirectoryInput,
  type CreateShortBookAtDirectoryInput,
  type FolderCatalogLibraryDomain,
  type FolderCatalogProjectDomain,
  type FolderCatalogProjectManifest,
  type FolderCatalogUnregisterDomain
} from "./types";

export function assertBookLibraryReferences(
  book: Pick<
    Book,
    "title" | "bookType" | "linkedMaterialIdsByKind" | "linkedSkillIdsByKind"
  >,
  snapshot: Pick<CatalogSnapshot, "materials" | "skills">
): void {
  const materials = new Map(
    snapshot.materials.map((material) => [material.id, material])
  );
  const skills = new Map(snapshot.skills.map((skill) => [skill.id, skill]));
  for (const [kind, materialIds] of Object.entries(
    book.linkedMaterialIdsByKind
  )) {
    for (const materialId of materialIds) {
      const material = materials.get(materialId);
      if (!material) {
        throw new Error(
          `书籍「${book.title}」关联了不存在的素材库：${materialId}`
        );
      }
      if (material.materialKind !== "mixed" && material.materialKind !== kind) {
        throw new Error(`素材库「${material.title}」不能关联到 ${kind} 分类。`);
      }
    }
  }
  for (const [kind, skillIds] of Object.entries(book.linkedSkillIdsByKind)) {
    for (const skillId of skillIds) {
      const skill = skills.get(skillId);
      if (!skill) {
        throw new Error(
          `书籍「${book.title}」绑定了不存在的技能库：${skillId}`
        );
      }
      if (skill.skillKind !== kind) {
        throw new Error(`技能库「${skill.title}」不能绑定到 ${kind} 分类。`);
      }
    }
  }
}

export function assertBaseRevision(
  expected: number | undefined,
  actual: number
): void {
  if (expected !== undefined && expected !== actual) {
    throw new FolderCatalogConflictError(expected, actual);
  }
}

export function assertUniqueGroupMembers(
  libraryIds: Array<string | undefined>
): void {
  const selected = libraryIds.filter((libraryId): libraryId is string =>
    Boolean(libraryId)
  );
  if (new Set(selected).size !== selected.length) {
    throw new Error("同一个资料库不能在一个分组中绑定到多个分类。");
  }
}

export function assertLibraryNotInAnotherGroup(
  groups: ReadonlyArray<{
    id: string;
    title: string;
    members: Record<string, string | undefined>;
  }>,
  libraryId: string,
  domainLabel: "素材" | "技能",
  currentGroupId?: string
): void {
  const existing = groups.find(
    (group) =>
      group.id !== currentGroupId &&
      Object.values(group.members).includes(libraryId)
  );
  if (existing) {
    throw new Error(
      `${domainLabel}库已经属于分组“${existing.title}”，请先在原分组中切换绑定。`
    );
  }
}

export function assertProjectRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Project revision must be a non-negative safe integer.");
  }
}

export function domainForKind(
  kind: FolderCatalogProjectManifest["kind"]
): FolderCatalogProjectDomain {
  switch (kind) {
    case "deepwrite.book":
      return "book";
    case "deepwrite.material-library":
      return "material-library";
    case "deepwrite.material-group":
      return "material-group";
    case "deepwrite.skill-library":
      return "skill-library";
    case "deepwrite.skill-group":
      return "skill-group";
  }
}

export function kindForDomain(
  domain: FolderCatalogProjectDomain
): FolderCatalogProjectManifest["kind"] {
  switch (domain) {
    case "book":
      return "deepwrite.book";
    case "material-library":
      return "deepwrite.material-library";
    case "material-group":
      return "deepwrite.material-group";
    case "skill-library":
      return "deepwrite.skill-library";
    case "skill-group":
      return "deepwrite.skill-group";
  }
}

export function parseId(value: unknown): string {
  return parseNonBlankString(value, "project id");
}

export function parseLibraryDomain(value: unknown): FolderCatalogLibraryDomain {
  if (value !== "material" && value !== "skill") {
    throw new Error("library domain must be material or skill.");
  }
  return value;
}

export function libraryProjectDomain(
  domain: FolderCatalogLibraryDomain
): "material-library" | "skill-library" {
  return domain === "material" ? "material-library" : "skill-library";
}

export function parseUnregisterDomain(
  value: unknown
): FolderCatalogUnregisterDomain {
  if (
    value !== "book" &&
    value !== "material" &&
    value !== "skill" &&
    value !== "material-library" &&
    value !== "material-group" &&
    value !== "skill-library" &&
    value !== "skill-group"
  ) {
    throw new Error("project domain is invalid.");
  }
  return value;
}

export function registryDomainForUnregister(
  domain: FolderCatalogUnregisterDomain
): FolderCatalogProjectDomain {
  if (domain === "material") {
    return "material-library";
  }
  if (domain === "skill") {
    return "skill-library";
  }
  return domain;
}

export function parseNonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function parseTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFolderDomain(
  value: unknown
): value is FolderCatalogProjectDomain {
  return (
    typeof value === "string" &&
    (CATALOG_PROJECT_DOMAINS as readonly string[]).includes(value)
  );
}

export function isCreateAtDirectoryInput(
  value: CreateShortBookInput | CreateShortBookAtDirectoryInput
): value is CreateShortBookAtDirectoryInput {
  return "input" in value;
}

export function isCreateScriptAtDirectoryInput(
  value: CreateScriptBookInput | CreateScriptBookAtDirectoryInput
): value is CreateScriptBookAtDirectoryInput {
  return "input" in value;
}
