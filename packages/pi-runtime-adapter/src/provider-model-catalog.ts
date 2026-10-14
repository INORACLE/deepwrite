import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  getBuiltinModels,
  getBuiltinProviders
} from "@earendil-works/pi-ai/providers/all";
import { findLongestModelIdBoundaryMatch } from "./model-id-matching";
import { findDeepWriteRuntimeModel } from "./runtime-model-catalog";
import { findVolcengineRuntimeModel } from "./volcengine-runtime";
import { isGeminiOpenAIConfig } from "./gemini-openai";
import { findSiteOfficialRuntimeModel } from "./site-official-model-catalog";

export function findProviderModel(
  config: AgentProviderRuntimeConfig
): Model<Api> | undefined {
  const official = findSiteOfficialRuntimeModel(config);
  if (official) return official;
  const provider = getBuiltinProviders().find(
    (candidate) => candidate.toLowerCase() === config.provider.toLowerCase()
  );
  if (provider) {
    const model = findLongestModelIdBoundaryMatch(
      getBuiltinModels(provider),
      config.modelId
    ) as Model<Api> | undefined;
    if (model) return model;
  }
  const local =
    findVolcengineRuntimeModel(config) ??
    findDeepWriteRuntimeModel(config.modelId);
  if (local) return local;

  if (config.api === "google-generative-ai" || isGeminiOpenAIConfig(config)) {
    return findLongestModelIdBoundaryMatch(
      getBuiltinModels("google"),
      config.modelId.replace(/^(?:google|models)\//iu, "")
    ) as Model<Api> | undefined;
  }

  // Gateway provider names identify routes rather than model families. Claude's
  // native API still needs its catalog's thinking and sampling compatibility.
  return config.api === "anthropic-messages"
    ? (findLongestModelIdBoundaryMatch(
        getBuiltinModels("anthropic"),
        config.modelId
      ) as Model<Api> | undefined)
    : undefined;
}
