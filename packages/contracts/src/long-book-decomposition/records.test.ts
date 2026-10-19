import { expect, it } from "vitest";
import { DecompositionSubmissionDataSchema } from "./assets";
import {
  DECOMPOSITION_RECORD_MAX_BYTES,
  DecompositionRecordFileSchema,
  DecompositionRecordSchema
} from "./records";

const overview = (content: string) => ({
  kind: "asset" as const,
  asset: {
    kind: "topic" as const,
    domain: "character" as const,
    title: "人物概览",
    content
  }
});

it("Core 汇总的人物概览可超过单次模型成品上限，记录往返保留全文", () => {
  const data = overview('人物摘要😀\n"'.repeat(30_000));
  expect(data.asset.content.length).toBeGreaterThan(200_000);
  const file = {
    schemaVersion: 1,
    jobId: "ldjob_overview",
    outputVersion: 1,
    inputRevision: "rev_1",
    savedAt: new Date().toISOString(),
    record: { unitId: "summary:characters", data }
  };
  expect(
    DecompositionRecordFileSchema.parse(JSON.parse(JSON.stringify(file)))
  ).toEqual(file);
  expect(DecompositionSubmissionDataSchema.safeParse(data).success).toBe(false);
});

it("汇总例外只用于人物概览，不放宽其他单元或模型成品的限制", () => {
  const data = overview("文".repeat(200_001));
  expect(
    DecompositionRecordSchema.safeParse({ unitId: "topic:characters", data })
      .success
  ).toBe(false);
  for (const asset of [
    { ...data.asset, domain: "world" },
    { ...data.asset, title: "其他主题" }
  ])
    expect(
      DecompositionRecordSchema.safeParse({
        unitId: "summary:characters",
        data: { kind: "asset", asset }
      }).success
    ).toBe(false);
});

it("兼容已有的小型人物概览记录", () => {
  const record = { unitId: "summary:characters", data: overview("# 人物概览") };
  expect(DecompositionRecordSchema.parse(record)).toEqual(record);
  expect(DecompositionSubmissionDataSchema.parse(record.data)).toEqual(
    record.data
  );
});

it("按 JSON 转义后的 UTF-8 字节拒绝超限概览", () => {
  const content = `开${"\n".repeat(DECOMPOSITION_RECORD_MAX_BYTES / 2)}尾`;
  expect(new TextEncoder().encode(content).byteLength).toBeLessThan(
    DECOMPOSITION_RECORD_MAX_BYTES
  );
  expect(
    DecompositionRecordSchema.safeParse({
      unitId: "summary:characters",
      data: overview(content)
    }).success
  ).toBe(false);
});

it("把元数据封装计入文件上限，边界内的多字节记录仍可往返", () => {
  const file = (content: string) => ({
    schemaVersion: 1,
    jobId: "ldjob_overview",
    outputVersion: 1,
    inputRevision: "rev_1",
    savedAt: "2026-10-18T00:00:00.000Z",
    record: { unitId: "summary:characters", data: overview(content) }
  });
  const overhead = new TextEncoder().encode(
    JSON.stringify(file(""))
  ).byteLength;
  const available = DECOMPOSITION_RECORD_MAX_BYTES - overhead;
  const content =
    "文".repeat(Math.floor(available / 3)) + "x".repeat(available % 3);
  const exact = file(content);
  expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(
    DECOMPOSITION_RECORD_MAX_BYTES
  );
  expect(DecompositionRecordFileSchema.safeParse(exact).success).toBe(true);
  const tooLarge = file(`${content}x`);
  expect(DecompositionRecordSchema.safeParse(tooLarge.record).success).toBe(
    true
  );
  expect(DecompositionRecordFileSchema.safeParse(tooLarge).success).toBe(false);
});
