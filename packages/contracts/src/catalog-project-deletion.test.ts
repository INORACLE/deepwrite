import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  DeleteCatalogProjectInputSchema,
  DeleteCatalogProjectResultSchema,
  createEnvelope
} from "./index";

describe("catalog project deletion contracts", () => {
  it.each(["material-group", "skill-group"] as const)(
    "validates %s deletion through the existing command and preserves member cleanup ids",
    (domain) => {
      const payload = { domain, projectId: "group-a", baseProjectRevision: 3 };
      expect(
        CommandEnvelopeSchema.parse(
          createEnvelope("catalog.deleteProject", payload, {
            id: "delete-group"
          })
        ).payload
      ).toEqual(payload);
      const result = {
        domain,
        projectId: "group-a",
        deleted: true,
        deletedMemberLibraryIds: ["library-a", "library-b"]
      };
      expect(DeleteCatalogProjectResultSchema.parse(result)).toEqual(result);
    }
  );

  it("rejects invalid domains, revisions, and member ids", () => {
    expect(
      DeleteCatalogProjectInputSchema.safeParse({
        domain: "material-library",
        projectId: "library-a"
      }).success
    ).toBe(false);
    expect(
      DeleteCatalogProjectInputSchema.safeParse({
        domain: "material-group",
        projectId: "group-a",
        baseProjectRevision: -1
      }).success
    ).toBe(false);
    expect(
      DeleteCatalogProjectResultSchema.safeParse({
        domain: "skill-group",
        projectId: "group-a",
        deleted: true,
        deletedMemberLibraryIds: [""]
      }).success
    ).toBe(false);
  });
});
