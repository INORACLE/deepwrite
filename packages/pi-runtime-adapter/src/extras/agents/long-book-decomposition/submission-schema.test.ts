import { describe, expect, it } from "vitest";
import {
  DecompositionAssetSchema,
  DecompositionSubmissionDataSchema
} from "@deepwrite/contracts";
import { describeSubmissionIssues } from "./submission-schema";

const point = {
  title: "夜访",
  summary: "主角夜访旧宅。",
  startOrder: 1,
  endOrder: 2
};

describe("decomposition submission errors", () => {
  it("reports a missing final summary without echoing the submitted text", () => {
    const data = {
      kind: "asset",
      asset: { kind: "chronicle", points: [point] }
    };
    const result = DecompositionSubmissionDataSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation failure");
    const message = describeSubmissionIssues(result.error.issues, data);
    expect(message).toBe("asset.summary：缺少必填字段，应填写字符串");
    expect(message).not.toContain(point.summary);
  });

  it("explains field types and limits without including field values", () => {
    const data = {
      kind: "asset-part",
      asset: {
        kind: "chronicle",
        points: [{ ...point, title: "私密".repeat(61), startOrder: "1" }]
      }
    };
    const result = DecompositionSubmissionDataSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation failure");
    const message = describeSubmissionIssues(result.error.issues, data);
    expect(message).toContain("asset.points.0.title：当前 122 字，上限 120");
    expect(message).toContain(
      "asset.points.0.startOrder：类型错误，应填写数字"
    );
    expect(message).not.toContain("私密");
  });

  it("unwraps nested Zod union errors and selects the submitted asset kind", () => {
    const [chronicle, , , opening, , , world] =
      DecompositionAssetSchema.options;
    // Keep actual nested Zod union diagnostics, including relative branch paths.
    const schema = DecompositionSubmissionDataSchema.options[4].extend({
      asset: opening.or(world.or(chronicle))
    });
    const data = {
      kind: "asset",
      asset: { kind: "chronicle", points: [point] }
    };
    const result = schema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation failure");
    expect(result.error.issues[0]?.code).toBe("invalid_union");
    const message = describeSubmissionIssues(result.error.issues, data);
    expect(message).toBe("asset.summary：缺少必填字段，应填写字符串");
    expect(message).not.toContain("Invalid input");
    expect(message).not.toContain("opening");
  });

  it("does not prefer a shorter error list belonging to another asset kind", () => {
    const [chronicle, , , opening] = DecompositionAssetSchema.options;
    const schema = DecompositionSubmissionDataSchema.options[4].extend({
      asset: opening.pick({ kind: true }).or(chronicle)
    });
    const data = {
      kind: "asset",
      asset: {
        kind: "chronicle",
        points: [{ ...point, title: "测".repeat(121) }]
      }
    };
    const result = schema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation failure");
    const message = describeSubmissionIssues(result.error.issues, data);
    expect(message).toContain("asset.summary：缺少必填字段");
    expect(message).toContain("asset.points.0.title：当前 121 字，上限 120");
    expect(message).not.toContain("asset.kind");
  });

  it("limits expanded errors, not union wrappers, to six fields", () => {
    const errors = Array.from({ length: 8 }, (_, index) => ({
      code: "invalid_type",
      path: ["points", index, "summary"],
      expected: "string",
      message: "Invalid input"
    }));
    const message = describeSubmissionIssues(
      [
        {
          code: "invalid_union",
          path: ["asset"],
          message: "Invalid input",
          errors: [errors]
        }
      ],
      {}
    );
    expect(message).toContain("asset.points.5.summary");
    expect(message).not.toContain("asset.points.6.summary");
    expect(message).toContain("另有 2 处");
  });

  it("gives structural advice when no union branch can be selected", () => {
    const message = describeSubmissionIssues(
      [
        {
          code: "invalid_union",
          path: ["asset", "kind"],
          message: "Invalid input",
          errors: []
        }
      ],
      { asset: { kind: "unknown" } }
    );
    expect(message).toContain("asset.kind：结构不符合要求");
    expect(message).not.toContain("Invalid input");
  });
});
