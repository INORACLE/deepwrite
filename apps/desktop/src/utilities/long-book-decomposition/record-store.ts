import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DecompositionDraftFileSchema,
  DecompositionRecordFileSchema,
  DECOMPOSITION_RECORD_MAX_BYTES,
  type DecompositionAssetPart,
  type DecompositionDraftFile,
  type DecompositionRecord,
  type DecompositionRecordFile,
  type DecompositionSubmissionData,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import { commitProjectTransaction } from "../project-transaction";
import { readNoFollowFile } from "../long-project-store/io";
import { decompositionReceiptId } from "./identity";

// Keep writes and reads aligned with recovery of the shared task directory.
// The submission schemas still cap ordinary model assets at 200,000 characters.
const MAX_RECORD_BYTES = DECOMPOSITION_RECORD_MAX_BYTES;

/** Identity of the record a unit's current revision was submitted with. */
export function decompositionRecordId(
  job: LongBookDecompositionJob,
  unitId: string,
  inputRevision = job.units[unitId]!.inputRevision
): string {
  return decompositionReceiptId(
    job.id,
    job.outputVersion,
    unitId,
    // Keeping a user edit renames the receipt, not the submitted record.
    inputRevision.split(":resolved:")[0]!
  );
}

/** Units whose only output is the task-local record. */
export function decompositionUnitIsRecordOnly(
  job: LongBookDecompositionJob,
  unitId: string
): boolean {
  const unit = job.units[unitId];
  if (/^(?:chunk|registry|review):/u.test(unitId) || unit?.biography)
    return true;
  if (unitId.startsWith("reading:")) return job.mode === "materials";
  if (job.mode === "materials") return false;
  // Long books have no slot for style or non-world topics; they stay viewable in the task.
  if (unitId === "style:profile") return true;
  return !!unit?.topic && unit.topic.domain !== "world";
}

/**
 * Immutable per-revision machine records under the task directory. Nothing in
 * here is shown in the creative workspace; deleting the task removes it.
 */
export class DecompositionRecordStore {
  /** `directory` resolves a job's task directory. */
  constructor(readonly directory: (jobId: string) => string) {}
  /** Transaction paths are portable: always `/`, never the platform separator. */
  private path(id: string) {
    return `records/${id}.json`;
  }
  async save(
    job: LongBookDecompositionJob,
    unitId: string,
    data: DecompositionSubmissionData
  ): Promise<string> {
    const id = decompositionRecordId(job, unitId);
    const file: DecompositionRecordFile = {
      schemaVersion: 1,
      jobId: job.id,
      outputVersion: job.outputVersion,
      inputRevision: job.units[unitId]!.inputRevision.split(":resolved:")[0]!,
      savedAt: new Date().toISOString(),
      record: { unitId, data }
    };
    await commitProjectTransaction({
      projectRoot: this.directory(job.id),
      maxFileBytes: MAX_RECORD_BYTES,
      operations: [
        {
          path: this.path(id),
          content: JSON.stringify(DecompositionRecordFileSchema.parse(file))
        }
      ]
    });
    return id;
  }
  async read(jobId: string, id: string): Promise<DecompositionRecordFile> {
    const root = this.directory(jobId);
    const { bytes } = await readNoFollowFile(
      join(root, "records", `${id}.json`),
      MAX_RECORD_BYTES,
      "拆解单元记录",
      root
    );
    return DecompositionRecordFileSchema.parse(
      JSON.parse(bytes.toString("utf8"))
    );
  }
  async record(
    job: LongBookDecompositionJob,
    unitId: string
  ): Promise<DecompositionRecord> {
    let file: DecompositionRecordFile;
    try {
      file = await this.read(job.id, decompositionRecordId(job, unitId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(`拆解单元记录缺失：${unitId}`);
      throw error;
    }
    if (file.jobId !== job.id || file.record.unitId !== unitId)
      throw new Error(`拆解单元记录不属于本任务：${unitId}`);
    return file.record;
  }
  /** Staged batches live beside the records until the unit is saved. */
  private draftPath(job: LongBookDecompositionJob, unitId: string) {
    return `drafts/${decompositionRecordId(job, unitId)}.json`;
  }
  async saveDraft(
    job: LongBookDecompositionJob,
    unitId: string,
    asset: DecompositionAssetPart
  ): Promise<void> {
    const file: DecompositionDraftFile = {
      schemaVersion: 1,
      jobId: job.id,
      outputVersion: job.outputVersion,
      inputRevision: job.units[unitId]!.inputRevision.split(":resolved:")[0]!,
      unitId,
      savedAt: new Date().toISOString(),
      asset
    };
    await commitProjectTransaction({
      projectRoot: this.directory(job.id),
      maxFileBytes: MAX_RECORD_BYTES,
      operations: [
        {
          path: this.draftPath(job, unitId),
          content: JSON.stringify(DecompositionDraftFileSchema.parse(file))
        }
      ]
    });
  }
  /** The batches staged for the unit's current revision, if any. */
  async draft(
    job: LongBookDecompositionJob,
    unitId: string
  ): Promise<DecompositionAssetPart | undefined> {
    const root = this.directory(job.id);
    try {
      const { bytes } = await readNoFollowFile(
        join(root, this.draftPath(job, unitId)),
        MAX_RECORD_BYTES,
        "拆解暂存批次",
        root
      );
      const file = DecompositionDraftFileSchema.parse(
        JSON.parse(bytes.toString("utf8"))
      );
      return file.jobId === job.id && file.unitId === unitId
        ? file.asset
        : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async removeDraft(job: LongBookDecompositionJob, unitId: string) {
    if (!(await this.draft(job, unitId))) return;
    await commitProjectTransaction({
      projectRoot: this.directory(job.id),
      operations: [{ path: this.draftPath(job, unitId), action: "delete" }]
    });
  }
  /** Saved record identities, listed once per recovery pass. */
  async ids(jobId: string): Promise<Set<string>> {
    try {
      return new Set(
        (
          await readdir(join(this.directory(jobId), "records"), {
            withFileTypes: true
          })
        )
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(({ name }) => name.slice(0, -5))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw error;
    }
  }
}
