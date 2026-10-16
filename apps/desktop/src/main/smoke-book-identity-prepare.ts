import type { DeepWriteApi } from "@deepwrite/contracts";

/** Persist isolated fixtures before a fresh Renderer reads its model settings. */
export async function prepareIdentitySmokeInRenderer() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Book identity smoke: ${reason}`);
  };
  const created = await api.catalog.createShortBook({
    title: "身份设计冒烟样书",
    genre: "其他"
  });
  if (!created) throw new Error("Smoke book creation canceled.");
  const book = { projectType: "short" as const, projectId: created.id };
  await api.models.save({
    defaultModelId: "book_identity_smoke_model",
    models: [
      {
        id: "book_identity_smoke_model",
        label: "身份设计 Faux",
        provider: "openai",
        modelId: "invalid-smoke-model",
        api: "openai-completions",
        baseUrl: "https://model.example.test/v1",
        apiKey: "invalid-smoke-placeholder",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["medium"],
        temperatureOptions: [0.1, 0.7, 1],
        contextWindow: 128000,
        maxTokens: 8192
      }
    ]
  });
  localStorage.setItem(
    "deepwrite:book-identity:selection:v1",
    JSON.stringify(book)
  );
  const imageSettings = await api.imageModels.saveSettings({
    activeProfileId: "identity_smoke_image",
    profiles: [
      {
        id: "identity_smoke_image",
        name: "冒烟固定图片",
        presetId: "minimax-image",
        baseUrl: "https://image.example.test/v1",
        model: "image-01",
        defaultAspectRatio: "3:4",
        watermark: false,
        apiKey: "invalid-smoke-placeholder"
      }
    ]
  });
  ensure(imageSettings.profiles[0]?.hasApiKey, "image model key not stored");
  ensure(
    !JSON.stringify(imageSettings).includes("invalid-smoke-placeholder"),
    "image key leaked"
  );
  ensure(
    (await api.bookIdentity.get({ book })).bookId === book.projectId,
    "initial identity read failed"
  );
  ensure(
    (await api.catalog.index()).books.some(
      (entry) => entry.id === book.projectId
    ),
    "created book missing from catalog"
  );
  await api.long.list();
  return book;
}
