import { type LongBookDecompositionJob } from "@deepwrite/contracts";
import type { LongWorkspaceService } from "../long-workspace-service";
import type { FolderCatalogStore } from "../folder-catalog-store";
import { DecompositionJobStateStore } from "./job-state-store";
import { DecompositionRecordsReader } from "./records-reader";
import { completeDecompositionCharacterOverview } from "./completion-assets";
import { commitDecompositionLedger } from "./completion-ledger";
import { currentDecompositionRefs } from "./content-guard";

export async function finalizeDecomposition(
  job: LongBookDecompositionJob,
  state: DecompositionJobStateStore,
  longs: LongWorkspaceService,
  catalog: FolderCatalogStore,
  reader: DecompositionRecordsReader
) {
  if (!job.target) throw new Error("目标尚未绑定。");
  await completeDecompositionCharacterOverview(job, state, longs, reader);
  const completion = await state.completion(job.id);
  if (
    job.target.kind === "long" &&
    completion.commitId &&
    completion.postCommitRefs
  ) {
    const committed = (
      await longs.catalog.open(job.target.bookId)
    ).book.workspaceIndex.ledger.commits.some(
      ({ id }) => id === completion.commitId
    );
    if (committed)
      for (const [id, refs] of Object.entries(completion.postCommitRefs))
        if (job.units[id]) job.units[id]!.outputRefs = refs;
  }
  const unfinished = Object.entries(job.units).filter(
    ([, unit]) => !["done", "skipped"].includes(unit.status)
  );
  if (unfinished.length)
    throw new Error(`仍有 ${unfinished.length} 个单元未写入。`);
  await reader.snapshot(async () => {
    const receipts = new Map(
      (await reader.receipts(job, completion.postCommitRefs)).map((receipt) => [
        receipt.unitId,
        receipt
      ])
    );
    const current = new Set(
      currentDecompositionRefs(
        [...receipts.values()].flatMap(({ refs }) => refs)
      )
    );
    for (const [id, unit] of Object.entries(job.units)) {
      if (unit.status !== "done") continue;
      // The task record is the unit's content; an asset may legitimately write nothing.
      const receipt = receipts.get(id);
      if (!receipt) throw new Error(`完成单元的内容或回执缺失：${id}`);
      await reader.record(job, id);
      for (const ref of receipt.refs)
        if (current.has(ref)) await reader.validateRef(job, ref);
      unit.outputRefs = receipt.refs;
    }
  });
  if (job.target.kind === "long") {
    if (
      Object.entries(job.units).some(
        ([id, unit]) => id.startsWith("reading:") && unit.status === "skipped"
      )
    )
      throw new Error("续写模式必须补齐所有章节梗概后才能完成账本。");
    await commitDecompositionLedger(job, state, longs);
  } else {
    const snapshot = await catalog.indexSnapshot();
    for (const libraryId of Object.values(job.target.libraryIds)) {
      if (!snapshot.materials.some(({ id }) => id === libraryId))
        throw new Error("真实素材库已移除。");
    }
  }
  await state.saveCompletion(job.id, {
    ...(await state.completion(job.id)),
    finalized: true
  });
  job.status = "completed";
  job.phase = "done";
  job.target.state = "completed";
  delete job.lastError;
  await state.save(job);
}
