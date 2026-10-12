import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";
import type { ModelConfigStoreOptions } from "./model-config-store";

/** Faux smoke must not fetch provider credentials or depend on an OS keyring. */
export function modelSmokeOptions(
  environment: NodeJS.ProcessEnv = process.env
): Pick<ModelConfigStoreOptions, "freeModelCatalog"> {
  if (
    environment.DEEPWRITE_SMOKE !== "1" ||
    environment.DEEPWRITE_SMOKE_SUITE === "decomposition-real-model"
  )
    return {};

  const catalog: DeepWriteFreeModelCatalog = {
    revision: "smoke",
    enabled: false,
    message: "",
    manifestAvailable: true,
    canDeprecateMissingModels: false,
    defaultModelId: "",
    models: [],
    apiKeys: {}
  };
  return {
    freeModelCatalog: {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog)
    }
  };
}
