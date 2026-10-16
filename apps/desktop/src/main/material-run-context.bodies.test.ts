import { describe, expect, it } from "vitest";
import {
  createLongWorkspaceNavigationSnapshot,
  DEFAULT_LONG_AGENT_PROFILES,
  type CommandEnvelope,
  type CommandResult,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { longMaterialFixture } from "../utilities/long-material-pack/test-support";
import { MaterialQueryService } from "../utilities/material-query-service";
import { prepareMaterialRunContext } from "./material-run-context";

describe(
  "workspace context for transferred bodies",
  { timeout: 60_000 },
  () => {
    it("never pushes body entries in either catalog or snapshot mode", async () => {
      const fixture = await longMaterialFixture(3);
      const converted = await fixture.service().convert({
        bookId: fixture.bookId,
        options: { ...fixture.options, transferAllBodies: true },
        target: { action: "create", title: "按需正文" },
        operationId: "workspace-body-context"
      });
      const libraryId = converted.libraries.find(
        ({ kind }) => kind === "draft"
      )!.libraryId;
      await fixture.longs.updateBindings({
        bookId: fixture.bookId,
        linkedMaterialIdsByKind: { draft: [libraryId] },
        linkedSkillIdsByKind: {}
      });
      const { workspaceIndex } = await fixture.longs.getWorkspaceIndex({
        bookId: fixture.bookId
      });
      const workspaceContext: WorkspaceRuntimeContext = {
        longWorkspace: {
          bookId: fixture.bookId,
          title: "铜铃记",
          activeRoot: "draft",
          activeAgentId: "long",
          navigation: createLongWorkspaceNavigationSnapshot(workspaceIndex)
        }
      };
      const queries = new MaterialQueryService(fixture.catalog, fixture.longs);
      const request = async (
        command: CommandEnvelope
      ): Promise<CommandResult> => {
        if (command.type !== "catalog.queryMaterials")
          throw new Error("Unexpected test command");
        return {
          status: "accepted",
          requestId: command.id,
          payload: await queries.query(command.payload)
        };
      };
      const bodies = converted.entries.filter(({ key }) =>
        key.startsWith("body:")
      );
      const catalog = await prepareMaterialRunContext(
        { workspaceContext, longAgentProfile: DEFAULT_LONG_AGENT_PROFILES[0]! },
        request
      );
      expect(catalog?.attachedMaterials).toEqual([]);
      expect(
        catalog?.materialCatalog?.entries.map(({ title }) => title)
      ).toEqual(["《铜铃记》正文 · 库说明"]);
      for (const { title } of bodies)
        expect(JSON.stringify(catalog?.materialCatalog)).not.toContain(title);
      const snapshot = await prepareMaterialRunContext(
        {
          workspaceContext,
          longAgentProfile: DEFAULT_LONG_AGENT_PROFILES[0]!,
          snapshotMode: true
        },
        request
      );
      expect(snapshot?.materialCatalog).toBeUndefined();
      expect(snapshot?.attachedMaterials?.map(({ title }) => title)).toEqual([
        "《铜铃记》正文 · 库说明"
      ]);
      expect(snapshot?.attachedMaterials?.[0]?.content).toContain(
        bodies[0]!.title
      );
      expect(JSON.stringify(snapshot?.attachedMaterials)).not.toContain(
        "主角沈砚听见铜铃"
      );
    });
  }
);
