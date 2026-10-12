import {
  type CatalogIndexSnapshot,
  type CatalogLibrary,
  type DeepWriteApi,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type SkillLibraryGroup,
  type SkillLibrary
} from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { vi } from "vitest";
import type {
  CatalogResourceNodeActionPayload,
  EditorDraftState,
  ResourceTreeNode,
  WorkspaceDocument
} from "../types/workspace";
import { useCatalogLibraryTransactionsCoordinator } from "./useCatalogLibraryTransactionsCoordinator";

const NOW = "2026-08-14T00:00:00.000Z";

function materialLibrary(
  id: string,
  materialKind: MaterialLibrary["materialKind"],
  entries: MaterialLibrary["entries"] = [],
  projectRevision = 1
): MaterialLibrary {
  return {
    id,
    title: `素材库 ${id}`,
    materialType: "short",
    materialKind,
    parentGenre: "",
    subGenre: "",
    overview: "",
    entries,
    projectRevision,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function skillLibrary(
  id: string,
  entries: SkillLibrary["entries"] = [],
  projectRevision = 1
): SkillLibrary {
  return {
    id,
    title: `技能库 ${id}`,
    skillType: "short",
    skillKind: "plot",
    overview: "",
    isBuiltin: false,
    entries,
    projectRevision,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function workspaceDocument(
  id: string,
  domain: "material" | "skill",
  libraryId: string,
  entryId: string,
  content = "persisted"
): WorkspaceDocument {
  return {
    id,
    domain,
    title: `文档 ${id}`,
    eyebrow: "资料库",
    path: ["资料库", id],
    content,
    libraryId,
    catalogEntryId: entryId,
    catalogContentLoaded: true
  };
}

function libraryNode(
  libraryId: string,
  domain: "material" | "skill",
  patch: Partial<ResourceTreeNode> = {}
): ResourceTreeNode {
  return {
    id: `node:${libraryId}`,
    label: `资料库 ${libraryId}`,
    catalogNodeType: "library",
    libraryId,
    workspaceType: "short",
    ...(domain === "material"
      ? { materialKind: "other" as const }
      : { skillKind: "plot" as const }),
    ...patch
  };
}

interface HarnessOptions {
  materials?: MaterialLibrary[];
  skills?: SkillLibrary[];
  materialGroups?: MaterialLibraryGroup[];
  skillGroups?: SkillLibraryGroup[];
  documents?: WorkspaceDocument[];
  drafts?: Record<string, EditorDraftState>;
}

function createHarness(options: HarnessOptions = {}) {
  const materials = options.materials ?? [];
  const skills = options.skills ?? [];
  const snapshot = ref({
    materials,
    materialGroups: options.materialGroups ?? [],
    skills,
    skillGroups: options.skillGroups ?? []
  } as unknown as CatalogIndexSnapshot);
  const documents = shallowRef(options.documents ?? []);
  const drafts = shallowRef(options.drafts ?? {});
  const mutationPending = ref(false);
  const conflictError = new Error("catalog conflict");
  const apiMocks = {
    createLibrary: vi.fn(),
    createLibraryGroup: vi.fn(),
    updateLibraryGroup: vi.fn(),
    createLibraryEntry: vi.fn(),
    updateLibrary: vi.fn(),
    saveLibraryEntry: vi.fn(),
    moveLibraryEntry: vi.fn(),
    removeLibraryEntry: vi.fn(),
    chooseExternalLibraryEntries: vi.fn(),
    importLibraryEntries: vi.fn(),
    unregisterProject: vi.fn(),
    deleteProject: vi.fn(),
    duplicateProject: vi.fn()
  };
  const refreshCatalog = vi.fn(async () => true);
  const refreshWorkspaceDirectory = vi.fn(async () => undefined);
  const advanceDraftProjectRevision = vi.fn();
  const prepareProjectsForDuplicate = vi.fn(async () => true);
  const selectDocument = vi.fn();
  const navigateToDocumentResource = vi.fn(async () => undefined);
  function nodeIds(node: ResourceTreeNode): string[] {
    return [node.id, ...(node.children ?? []).flatMap(nodeIds)];
  }
  const collectResourceNodeIds = vi.fn(nodeIds);
  const disposeLibraryConversation = vi.fn();
  const notifications = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const findLibrary = vi.fn(
    (
      domain: "material" | "skill",
      libraryId: string
    ): CatalogLibrary | undefined =>
      domain === "material"
        ? snapshot.value.materials.find(({ id }) => id === libraryId)
        : snapshot.value.skills.find(({ id }) => id === libraryId)
  );

  const coordinator = useCatalogLibraryTransactionsCoordinator({
    api: () => apiMocks as unknown as DeepWriteApi["catalog"],
    libraryPackageApi: () => undefined,
    snapshot,
    documents,
    drafts,
    mutationPending,
    findLibrary,
    ensureDocumentLoaded: vi.fn(async (document) => document),
    refreshCatalog,
    refreshWorkspaceDirectory,
    advanceDraftProjectRevision,
    isConflict: (error) => error === conflictError,
    prepareProjectsForDuplicate,
    selectDocument,
    navigateToDocumentResource,
    collectResourceNodeIds,
    disposeLibraryConversation,
    notifications
  });

  return {
    coordinator,
    snapshot,
    documents,
    drafts,
    mutationPending,
    conflictError,
    apiMocks,
    refreshCatalog,
    refreshWorkspaceDirectory,
    advanceDraftProjectRevision,
    prepareProjectsForDuplicate,
    selectDocument,
    navigateToDocumentResource,
    disposeLibraryConversation,
    notifications
  };
}

function action(
  domain: "material" | "skill",
  actionName: CatalogResourceNodeActionPayload["action"],
  node: ResourceTreeNode
): CatalogResourceNodeActionPayload {
  return { domain, action: actionName, node };
}

export {
  NOW,
  materialLibrary,
  skillLibrary,
  workspaceDocument,
  libraryNode,
  createHarness,
  action
};
