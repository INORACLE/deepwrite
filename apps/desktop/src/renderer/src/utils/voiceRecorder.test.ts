import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeVoiceWav } from "./voiceAudio";
import { createVoiceRecorder } from "./voiceRecorder";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null
  };
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  const close = vi.fn(async () => undefined);
  const resume = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 48_000;
      destination = {};
      close = close;
      resume = resume;
      createMediaStreamSource = () => source;
      createScriptProcessor = () => processor;
      createGain = () => gain;
    }
  );
  const controller = new AbortController();
  const onProgress = vi.fn();
  const options = {
    signal: controller.signal,
    microphoneId: "test-mic",
    onProgress,
    onLimit: vi.fn(),
    onEnded: vi.fn()
  };
  const process = (samples: Float32Array): void =>
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples }
    } as unknown as AudioProcessingEvent);
  return {
    track,
    stream,
    getUserMedia,
    source,
    processor,
    gain,
    close,
    resume,
    controller,
    options,
    onProgress,
    process
  };
}

describe("voice audio capture", () => {
  it("captures the chosen microphone, reports real levels, and releases every audio resource on stop", async () => {
    const context = setup();
    const recorder = await createVoiceRecorder(context.options);
    expect(context.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        deviceId: { exact: "test-mic" }
      },
      video: false
    });
    context.process(new Float32Array(4_800).fill(0.2));
    expect(context.onProgress).toHaveBeenCalledWith(100, expect.closeTo(1));
    const audio = recorder.stop();
    expect(audio.durationMs).toBe(100);
    expect(context.track.stop).toHaveBeenCalledOnce();
    expect(context.source.disconnect).toHaveBeenCalledOnce();
    expect(context.processor.disconnect).toHaveBeenCalledOnce();
    expect(context.gain.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    recorder.cancel();
    expect(context.track.stop).toHaveBeenCalledOnce();
  });

  it("stops tracks when acquisition resolves after an abort", async () => {
    const context = setup();
    context.controller.abort();
    await expect(createVoiceRecorder(context.options)).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(context.track.stop).toHaveBeenCalledOnce();
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("releases the stream on a context failure and stops processing on abort", async () => {
    const failure = setup();
    failure.resume.mockRejectedValueOnce(new Error("audio unavailable"));
    await expect(createVoiceRecorder(failure.options)).rejects.toThrow(
      "audio unavailable"
    );
    expect(failure.track.stop).toHaveBeenCalledOnce();
    expect(failure.close).toHaveBeenCalledOnce();
    const context = setup();
    await createVoiceRecorder(context.options);
    context.controller.abort();
    expect(context.processor.onaudioprocess).toBeNull();
    expect(context.track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("forwards device disconnection so the owner can cancel the session", async () => {
    const context = setup();
    const recorder = await createVoiceRecorder(context.options);
    context.track.dispatchEvent(new Event("ended"));
    expect(context.options.onEnded).toHaveBeenCalledOnce();
    recorder.cancel();
  });
});

describe("voice WAV encoding", () => {
  it("downsamples chunks to 16 kHz mono PCM16 and reports duration from samples", () => {
    const audio = encodeVoiceWav(
      [new Float32Array(24_000).fill(0.5), new Float32Array(24_000).fill(-0.5)],
      48_000
    );
    const bytes = Uint8Array.from(atob(audio.audioBase64), (char) =>
      char.charCodeAt(0)
    );
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(bytes.length).toBe(44 + 16_000 * 2);
    expect(view.getInt16(44, true)).toBe(16_383);
    expect(view.getInt16(44 + 8_000 * 2, true)).toBe(-16_384);
    expect(audio.durationMs).toBe(1_000);
  });

  it("bounds even oversized input to ten minutes and the IPC payload limit", () => {
    const audio = encodeVoiceWav([new Float32Array(16_000 * 601)], 16_000);
    expect(audio.durationMs).toBe(600_000);
    expect(audio.audioBase64.length).toBeLessThan(26_000_000);
  }, 30_000); // Encode the full production duration limit, including its 25 MB IPC payload.

  it("rejects an empty capture before starting a recognition request", () => {
    expect(() => encodeVoiceWav([], 48_000)).toThrow("没有录到声音");
  });
});
