import { describe, expect, it } from "vitest";
import {
  StringEnum,
  Type,
  normalizeContext,
  type Context
} from "@earendil-works/pi-ai";
import {
  assertProviderToolParameterSchema,
  enforceProviderToolSchemaCompatibility
} from "./provider-tool-schema-compat";

describe("provider tool schema compatibility", () => {
  it("keeps object-root schemas unchanged", () => {
    const schema = Type.Object({ query: Type.String() });
    expect(assertProviderToolParameterSchema("search", schema)).toBe(schema);
  });

  it("accepts provider-friendly string enums without rewriting them", () => {
    const schema = Type.Object({
      kind: Type.Optional(
        StringEnum(["book_line", "chapter", "placement"] as const, {
          description: "章卡使用 chapter。"
        })
      )
    });
    expect(assertProviderToolParameterSchema("list_plot_design", schema)).toBe(
      schema
    );
    expect(schema.properties.kind).toEqual({
      type: "string",
      enum: ["book_line", "chapter", "placement"],
      description: "章卡使用 chapter。"
    });
  });

  it("leaves non-literal semantic unions unchanged", () => {
    const schema = Type.Object({
      id: Type.Union([
        Type.String({ pattern: "^chapter_" }),
        Type.String({ pattern: "^ref:" })
      ])
    });

    expect(assertProviderToolParameterSchema("read", schema)).toBe(schema);
  });

  it.each(["anyOf", "oneOf", "allOf"] as const)(
    "rejects root-level %s instead of rewriting it",
    (keyword) => {
      const schema = {
        [keyword]: [
          { type: "object", properties: { left: { type: "string" } } },
          { type: "object", properties: { right: { type: "string" } } }
        ]
      };
      expect(() =>
        assertProviderToolParameterSchema("object_union", {
          ...schema,
          type: "object"
        })
      ).toThrow(new RegExp(`object_union.*${keyword}`, "u"));
    }
  );

  it("rejects non-object and mixed-root schemas locally", () => {
    expect(() =>
      assertProviderToolParameterSchema("text_tool", Type.String())
    ).toThrow(/text_tool.*type: "object"/u);
    expect(() =>
      assertProviderToolParameterSchema("mixed_tool", {
        anyOf: [{ type: "object" }, { type: "string" }]
      })
    ).toThrow(/mixed_tool.*type: "object"/u);
    expect(() => assertProviderToolParameterSchema("null_tool", null)).toThrow(
      /null_tool.*JSON Schema/u
    );
  });

  it("asserts every tool at the provider boundary without cloning it", () => {
    const parameters = Type.Object({
      domain: StringEnum(["left", "right"] as const)
    });
    const context = {
      systemPrompt: "test",
      messages: [],
      tools: [
        {
          name: "portable_tool",
          description: "test",
          parameters
        }
      ]
    } satisfies Context;

    const compatible = enforceProviderToolSchemaCompatibility(context);
    expect(compatible).toBe(context);
    expect(compatible.tools?.[0]?.parameters).toBe(parameters);
  });

  it("rejects const keywords anywhere in a PI-facing schema", () => {
    expect(() =>
      assertProviderToolParameterSchema("legacy_literal", {
        type: "object",
        properties: {
          mode: { type: "string", const: "read" }
        }
      })
    ).toThrow(/legacy_literal.*StringEnum/u);
  });

  it("validates tools added later in a normalized transcript", () => {
    const context = normalizeContext({
      systemPrompt: "test",
      messages: [
        {
          role: "system",
          content: "",
          timestamp: 1,
          toolsAdded: [
            {
              name: "invalid_tool",
              description: "test",
              parameters: Type.String()
            }
          ]
        }
      ]
    });
    expect(() => enforceProviderToolSchemaCompatibility(context)).toThrow(
      /invalid_tool.*type: "object"/u
    );
  });
});
