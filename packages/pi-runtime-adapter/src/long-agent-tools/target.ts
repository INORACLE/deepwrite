import type {
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { isLongChapterContinuityReadOnly } from "@deepwrite/contracts";
import {
  LONG_BOOK_LINE_ID,
  LONG_CHAPTER_CHARACTER_DOCUMENTS,
  LONG_CHARACTER_OVERVIEW_ID,
  LONG_DOCUMENT_LABELS,
  LONG_ENTITY_KIND_LABELS,
  longDocumentKeysForKind,
  longEntityKindForId,
  longStageForTarget,
  type LongDocumentKey,
  type LongCharacterDocumentKey,
  type LongEntityKind,
  type LongStage
} from "./entity-registry";
import {
  longEntityContentField,
  longEntityRecord,
  type LongEntityRecord
} from "./entity-records";
import { resolveCharacterDocument } from "./target-character";

export interface LongTargetInput {
  id: string;
  document?: string;
  chapter_id?: string;
}

/** A target backed by a Markdown file on disk. */
export interface LongDocumentTarget {
  addressing: "document";
  kind: LongEntityKind;
  stage: LongStage;
  id: string;
  document?: LongDocumentKey;
  /** Worldbuilding items and categories need their owning category. */
  categoryId?: string;
  itemId?: string;
  /** Character documents and chapter continuity character files. */
  characterId?: string;
  characterName?: string;
  chapterTitle?: string;
  /** Public addressing can differ from the chapter-backed storage target. */
  publicId?: string;
  publicDocument?: LongDocumentKey;
  title: string;
  file: LongWorkspaceFileReference;
  /** Mapped documents are never writable through the character stage. */
  readOnly?: boolean;
  /** Empty mapped content when the character has no committed chapter yet. */
  inlineContent?: string;
}

/** A target whose body lives in a field of the central index. */
export interface LongFieldTarget {
  addressing: "field";
  kind: LongEntityKind;
  stage: LongStage;
  id: string;
  title: string;
  record: LongEntityRecord;
  content: string;
}

export type LongResolvedTarget = LongDocumentTarget | LongFieldTarget;

function fail(message: string): never {
  throw new Error(message);
}

function resolveDocumentKey(
  kind: LongEntityKind,
  raw: string | undefined
): LongDocumentKey | undefined {
  const supported = longDocumentKeysForKind(kind);
  if (supported.length === 0) {
    if (raw !== undefined) {
      fail(`${LONG_ENTITY_KIND_LABELS[kind]}不接受 document 参数。`);
    }
    return undefined;
  }
  if (raw === undefined) {
    fail(
      `${LONG_ENTITY_KIND_LABELS[kind]}必须提供 document，可选：${supported.join("、")}。`
    );
  }
  if (!supported.includes(raw as LongDocumentKey)) {
    fail(
      `${LONG_ENTITY_KIND_LABELS[kind]}不支持 document=${raw}，可选：${supported.join("、")}。`
    );
  }
  return raw as LongDocumentKey;
}

function resolveChapterDocument(
  index: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  document: LongDocumentKey,
  characterId: string | undefined
): LongDocumentTarget {
  const card = index.plot.chapterCards.find(({ id }) => id === chapterCardId);
  const files = index.chapters.find(
    (entry) => entry.chapterCardId === chapterCardId
  );
  if (!card || !files) fail(`章卡 ${chapterCardId} 不存在。`);

  const needsCharacter =
    document === "continuity_character_current_state" ||
    document === "continuity_character_history";
  if (needsCharacter !== (characterId !== undefined)) {
    fail(
      needsCharacter
        ? `document=${document} 必须同时提供 character_id。`
        : `document=${document} 不接受 character_id。`
    );
  }

  let file: LongWorkspaceFileReference | null;
  if (document === "card") file = files.card;
  else if (document === "body") file = files.body;
  else if (document === "character_state") file = files.characterState;
  else if (document === "handoff") file = files.handoff;
  else if (document === "foreshadowing_changes") {
    file = files.foreshadowingChanges;
  } else if (document === "world_reveals") file = files.worldReveals;
  else {
    const entry = files.characterContinuity.find(
      (candidate) => candidate.characterId === characterId
    );
    file =
      document === "continuity_character_current_state"
        ? (entry?.currentState ?? null)
        : (entry?.history ?? null);
  }
  if (!file) {
    fail(
      `章卡《${card.title}》尚未建立${LONG_DOCUMENT_LABELS[document]}，请先用 create 创建。`
    );
  }
  const characterName = characterId
    ? (index.characters.find(({ id }) => id === characterId)?.name ??
      characterId)
    : null;
  return {
    addressing: "document",
    kind: "chapter_card",
    stage: longStageForTarget("chapter_card", document),
    id: chapterCardId,
    document,
    ...(characterId
      ? {
          characterId,
          characterName: characterName!
        }
      : {}),
    chapterTitle: card.title,
    title: `${card.title} / ${
      characterName ? `${characterName} / ` : ""
    }${LONG_DOCUMENT_LABELS[document]}`,
    file,
    ...(document !== "body" && document !== "card"
      ? { readOnly: isLongChapterContinuityReadOnly(index, files) }
      : {})
  };
}

function resolveWorldbuildingTarget(
  index: LongWorkspaceIndexSnapshot,
  kind: LongEntityKind,
  id: string
): LongDocumentTarget {
  if (kind === "worldbuilding_category") {
    const category = index.worldbuilding.find(
      (candidate) => candidate.id === id
    );
    if (!category) fail(`世界观分类 ${id} 不存在。`);
    if (category.format === "text") {
      return {
        addressing: "document",
        kind,
        stage: "worldbuilding",
        id,
        categoryId: id,
        title: category.title,
        file: category.file
      };
    }
    if (!category.overview) {
      fail(`世界观分类《${category.title}》没有概览文件。`);
    }
    return {
      addressing: "document",
      kind,
      stage: "worldbuilding",
      id,
      categoryId: id,
      title: `${category.title} / 概览`,
      file: category.overview
    };
  }
  for (const category of index.worldbuilding) {
    if (category.format !== "list") continue;
    const item = category.items.find((candidate) => candidate.id === id);
    if (item) {
      return {
        addressing: "document",
        kind: "worldbuilding_item",
        stage: "worldbuilding",
        id,
        categoryId: category.id,
        itemId: item.id,
        title: `${category.title} / ${item.title}`,
        file: item.file
      };
    }
  }
  return fail(`世界观条目 ${id} 不存在。`);
}

export function resolveLongTarget(
  index: LongWorkspaceIndexSnapshot,
  target: LongTargetInput
): LongResolvedTarget {
  const kind = longEntityKindForId(target.id);
  if (!kind) fail(`无法识别的 id：${target.id}。`);
  const document = resolveDocumentKey(kind, target.document);

  if (kind === "character") {
    if (target.chapter_id !== undefined) {
      if (document !== "current_state" && document !== "history") {
        fail("chapter_id 仅用于人物 current_state 或 history。");
      }
      const exact = resolveChapterDocument(
        index,
        target.chapter_id,
        document === "current_state"
          ? "continuity_character_current_state"
          : "continuity_character_history",
        target.id
      );
      return {
        ...exact,
        publicId: target.id,
        publicDocument: document
      };
    }
    return resolveCharacterDocument(
      index,
      target.id,
      document! as LongCharacterDocumentKey
    );
  }
  if (target.chapter_id !== undefined) {
    fail("chapter_id 仅用于人物 current_state 或 history。");
  }
  if (kind === "chapter_card") {
    if (
      LONG_CHAPTER_CHARACTER_DOCUMENTS.includes(
        document as (typeof LONG_CHAPTER_CHARACTER_DOCUMENTS)[number]
      )
    ) {
      fail(
        "人物连续性文件请使用人物 id 和 document=current_state|history，并用 chapter_id 精确限定章节。"
      );
    }
    return resolveChapterDocument(index, target.id, document!, undefined);
  }
  if (kind === "character_overview") {
    if (!index.characterOverview) fail("人物概览文件不存在。");
    return {
      addressing: "document",
      kind,
      stage: "character",
      id: LONG_CHARACTER_OVERVIEW_ID,
      title: "人物概览",
      file: index.characterOverview
    };
  }
  if (kind === "book_line") {
    return {
      addressing: "document",
      kind,
      stage: "plot",
      id: LONG_BOOK_LINE_ID,
      title: "全书故事线",
      file: index.bookLine
    };
  }
  if (kind === "worldbuilding_category" || kind === "worldbuilding_item") {
    return resolveWorldbuildingTarget(index, kind, target.id);
  }
  if (kind === "story_plot") {
    const storyPlot = index.plot.storyPlots.find(({ id }) => id === target.id);
    if (!storyPlot) fail(`故事情节 ${target.id} 不存在。`);
    return {
      addressing: "document",
      kind,
      stage: "plot",
      id: target.id,
      title: storyPlot.title,
      file: storyPlot.file
    };
  }

  const record = longEntityRecord(index, kind, target.id);
  return {
    addressing: "field",
    kind,
    stage: "plot",
    id: target.id,
    title: record.title,
    record,
    content: longEntityContentField(record)
  };
}
