import { editableAgentProfileBaseline } from "../../utils/agentSettingsBaseline";
import { identityApi } from "./book-identity-utils";
import { computed, ref, watch, type Ref } from "vue";
import {
  type BookIdentityField,
  type BookTitleDesignProfile,
  type BookSynopsisDesignProfile,
  type BookCoverDesignProfile,
  ExtrasAgentSettingsInputSchema
} from "@deepwrite/contracts/renderer";
import { agentIds } from "./book-identity-utils";
export type IdentityProfile =
  BookTitleDesignProfile | BookSynopsisDesignProfile | BookCoverDesignProfile;
export type IdentityProfileCatalogs = Record<
  BookIdentityField,
  IdentityProfile[]
>;
export function useIdentityProfiles(field: Readonly<Ref<BookIdentityField>>) {
  const catalogs = ref<IdentityProfileCatalogs>({
    title: [],
    synopsis: [],
    cover: []
  });
  const selectedIds = ref({
    title: "default",
    synopsis: "default",
    cover: "default"
  });
  const loading = ref(false),
    saving = ref(false);
  const profiles = computed(() => catalogs.value[field.value]);
  const selectedId = computed({
    get: () => selectedIds.value[field.value],
    set: (id: string) => {
      selectedIds.value[field.value] = id;
    }
  });
  const selected = computed(
    () =>
      profiles.value.find((p) => p.id === selectedId.value) ?? profiles.value[0]
  );
  async function load() {
    loading.value = true;
    try {
      await Promise.all(
        (["title", "synopsis", "cover"] as const).map(async (value) => {
          const result = await identityApi().extrasAgents.profiles.list(
            agentIds[value]
          );
          catalogs.value[value] = result.profiles;
        })
      );
    } finally {
      loading.value = false;
    }
  }
  async function save(value: IdentityProfile[], target = field.value) {
    saving.value = true;
    try {
      const input = ExtrasAgentSettingsInputSchema.parse({
        agentId: agentIds[target],
        profiles: value.map(({ builtin: _builtin, ...profile }) => profile),
        baseProfiles: editableAgentProfileBaseline(catalogs.value[target])
      });
      const result = await identityApi().extrasAgents.profiles.save(input);
      catalogs.value[target] = result.profiles as IdentityProfile[];
    } finally {
      saving.value = false;
    }
  }
  async function reset(target = field.value) {
    saving.value = true;
    try {
      const result = await identityApi().extrasAgents.profiles.reset(
        agentIds[target]
      );
      catalogs.value[target] = result.profiles;
    } finally {
      saving.value = false;
    }
  }
  watch(profiles, () => {
    if (!profiles.value.some((p) => p.id === selectedId.value))
      selectedId.value = profiles.value[0]?.id ?? "default";
  });
  return {
    profiles,
    selectedId,
    selected,
    catalogs,
    loading,
    saving,
    load,
    save,
    reset
  };
}
