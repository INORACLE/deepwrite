import { expect, it, vi } from "vitest";
import type {
  DeepWriteApi,
  DecompositionRegistry,
  LongBookDecompositionJob
} from "@deepwrite/contracts/renderer";
import { useLongBookDecomposition } from "./useLongBookDecomposition";
import { decompositionUnitLabel } from "./unit-label";

// Every book numbers its characters c1, c2, … so the ids always collide.
const registryOf = (name: string) =>
  ({
    version: 1,
    characters: [{ id: "c1", name }],
    terms: []
  }) as unknown as DecompositionRegistry;
const jobOf = (
  id: string,
  phase: string,
  merge: "done" | "pending",
  withCharacter: boolean
) =>
  ({
    id,
    phase,
    status: "idle",
    chunks: [],
    profile: { worldCategories: [] },
    source: { range: { start: 1, end: 1 } },
    units: {
      "registry:merge": { status: merge, dependencies: [] },
      ...(withCharacter
        ? { "character:c1": { status: "pending", dependencies: [] } }
        : {})
    }
  }) as unknown as LongBookDecompositionJob;
const nameOf = (controller: ReturnType<typeof useLongBookDecomposition>) =>
  controller.registry.value?.characters[0]?.name;

function fixture(options: { slow?: string } = {}) {
  const jobs: Record<string, LongBookDecompositionJob> = {
    A: jobOf("A", "done", "done", true),
    B: jobOf("B", "read", "pending", false)
  };
  const registries: Record<string, DecompositionRegistry> = {
    A: registryOf("甲书主角"),
    B: registryOf("乙书主角")
  };
  let release: () => void = () => undefined;
  const slow = new Promise<void>((resolve) => (release = resolve));
  const getRegistry = vi.fn(async (id: string) => {
    if (id === options.slow) await slow;
    return registries[id]!;
  });
  const controller = useLongBookDecomposition({
    api: () =>
      ({
        longBookDecomposition: {
          getJob: async (id: string) => structuredClone(jobs[id]),
          getRegistry,
          listJobs: async () => Object.values(jobs)
        }
      }) as unknown as DeepWriteApi
  });
  return { controller, jobs, getRegistry, release };
}

it("切换到名册尚未生成的任务时，不沿用上一本书的名册", async () => {
  const { controller, jobs } = fixture();
  await controller.selectJob("A");
  expect(nameOf(controller)).toBe("甲书主角");
  await controller.selectJob("B");
  expect(controller.registry.value).toBeNull();
  // 乙书进入整合阶段，人物档案单元的 c1 不能被解析成甲书主角。
  const label = decompositionUnitLabel(
    jobOf("B", "integrate", "done", true),
    "character:c1",
    controller.registry.value
  );
  expect(label).not.toContain("甲书主角");
  expect(label).toContain("#1");
  expect(jobs.B!.phase).toBe("read");
  controller.dispose();
});

it("新建任务清空当前任务后，旧名册不会留给下一个任务", async () => {
  const { controller } = fixture();
  await controller.selectJob("A");
  controller.job.value = null;
  expect(controller.registry.value).toBeNull();
  controller.job.value = jobOf("B", "read", "pending", false);
  expect(controller.registry.value).toBeNull();
  controller.dispose();
});

it("旧任务名册的慢回复不会覆盖已切换到的新任务", async () => {
  const { controller, jobs, release } = fixture({ slow: "A" });
  jobs.B = jobOf("B", "integrate", "done", true);
  const first = controller.selectJob("A");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await controller.selectJob("B");
  expect(nameOf(controller)).toBe("乙书主角");
  release();
  await first;
  expect(controller.job.value?.id).toBe("B");
  expect(nameOf(controller)).toBe("乙书主角");
  controller.dispose();
});

it("自动继续在一次运行内进入整合阶段时，名册随任务立即载入", async () => {
  const { controller, getRegistry } = fixture();
  await controller.selectJob("A");
  await controller.selectJob("B");
  getRegistry.mockClear();
  // 引擎只替换任务快照，不会调用 inspect。
  controller.job.value = jobOf("B", "integrate", "done", true);
  await vi.waitFor(() => expect(nameOf(controller)).toBe("乙书主角"));
  expect(getRegistry).toHaveBeenCalledWith("B");
  controller.dispose();
});
