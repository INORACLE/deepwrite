import { describe, expect, it } from "vitest";
import { WebSearchRateLimiter } from "./rate-limiter";

function limiter() {
  const clock = { now: 1_000_000, slept: [] as number[] };
  return {
    clock,
    limiter: new WebSearchRateLimiter({
      now: () => clock.now,
      sleep: async (ms) => {
        clock.slept.push(ms);
        clock.now += ms;
      }
    })
  };
}

describe("WebSearchRateLimiter", () => {
  it("spaces one key's requests so a second never holds more than its rate", async () => {
    const { limiter: subject, clock } = limiter();
    for (let index = 0; index < 4; index += 1) await subject.acquire("key", 5);
    expect(clock.slept).toEqual([200, 200, 200]);
  });

  it("keeps keys apart and lets idle time pay the debt", async () => {
    const { limiter: subject, clock } = limiter();
    await subject.acquire("one", 5);
    await subject.acquire("two", 5);
    expect(clock.slept).toEqual([]);
    await subject.acquire("one", 5);
    clock.now += 5_000;
    clock.slept.length = 0;
    await subject.acquire("one", 5);
    expect(clock.slept).toEqual([]);
  });

  it("stops waiting when the caller aborts", async () => {
    const subject = new WebSearchRateLimiter();
    await subject.acquire("key", 1);
    const controller = new AbortController();
    const waiting = subject.acquire("key", 1, controller.signal);
    controller.abort(new Error("stopped"));
    await expect(waiting).rejects.toThrow("stopped");
    await expect(subject.acquire("key", 1, controller.signal)).rejects.toThrow(
      "stopped"
    );
  });

  it("forgets keys that have been idle for a long time", async () => {
    const { limiter: subject, clock } = limiter();
    for (let index = 0; index < 70; index += 1)
      await subject.acquire(`key-${index}`, 5);
    clock.now += 120_000;
    await subject.acquire("late", 5);
    expect(
      (subject as unknown as { nextSlot: Map<string, number> }).nextSlot.size
    ).toBeLessThan(10);
  });
});
