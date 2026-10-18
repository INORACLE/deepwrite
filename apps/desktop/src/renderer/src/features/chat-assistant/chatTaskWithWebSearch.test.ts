import { describe, expect, it } from "vitest";
import type { ExtrasChatTask } from "@deepwrite/contracts";
import { chatTaskWithWebSearch } from "./chatAssistantProfiles";

const project = { projectType: "long" as const, projectId: "longbook_a" };
const normal: ExtrasChatTask = {
  agentId: "chat-normal",
  profileId: "default",
  input: {}
};
const projectChat: ExtrasChatTask = {
  agentId: "chat-project",
  profileId: "long:longbook_a",
  input: { project }
};
const roleplay: ExtrasChatTask = {
  agentId: "chat-roleplay",
  profileId: "role",
  input: {}
};

describe("chatTaskWithWebSearch", () => {
  it("adds the user's switch to the two chats that may search", () => {
    expect(chatTaskWithWebSearch(normal, true).input).toEqual({
      webSearchEnabled: true
    });
    expect(chatTaskWithWebSearch(projectChat, true).input).toEqual({
      project,
      webSearchEnabled: true
    });
  });

  it("leaves the task as it is while the switch is off", () => {
    expect(chatTaskWithWebSearch(normal, false)).toBe(normal);
    expect(chatTaskWithWebSearch(projectChat, false)).toBe(projectChat);
  });

  it("never gives roleplay a switch", () => {
    expect(chatTaskWithWebSearch(roleplay, true)).toBe(roleplay);
  });

  it("does not change the task it was given", () => {
    chatTaskWithWebSearch(normal, true);
    expect(normal.input).toEqual({});
  });
});
