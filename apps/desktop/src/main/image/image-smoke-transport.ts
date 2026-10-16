import { nativeImage } from "electron";
import type { ImageServiceOptions } from "./image-service";

/** The desktop smoke fixture is isolated from all external image services. */
export function imageSmokeOptions(): ImageServiceOptions {
  return {
    secureStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`smoke-only:${value}`),
      decryptString: (value) => value.toString().replace(/^smoke-only:/u, "")
    },
    async fetcher(url, init) {
      const endpoint = new URL(url);
      if (endpoint.hostname !== "image.example.test")
        throw new Error("Image smoke requires an isolated endpoint.");
      const minimax = endpoint.pathname === "/v1/image_generation";
      if (minimax) {
        const body = JSON.parse(String(init?.body));
        if (
          init?.method !== "POST" ||
          body.model !== "image-01" ||
          body.aspect_ratio !== "3:4" ||
          body.response_format !== "base64" ||
          body.n !== 1 ||
          body.aigc_watermark !== false ||
          body.prompt.length > 1500 ||
          ["size", "quality", "negative_prompt"].some((key) => key in body)
        )
          throw new Error("Image smoke received an invalid MiniMax request.");
      }
      const bitmap = Buffer.alloc(600 * 800 * 4);
      for (let y = 0; y < 800; y++)
        for (let x = 0; x < 600; x++) {
          const offset = (y * 600 + x) * 4;
          bitmap[offset] = 70 + Math.floor(y / 24);
          bitmap[offset + 1] = 48 + Math.floor(y / 32);
          bitmap[offset + 2] = 32 + Math.floor(y / 32);
          bitmap[offset + 3] = 255;
        }
      const image = nativeImage.createFromBitmap(bitmap, {
        width: 600,
        height: 800
      });
      const base64 = image.toPNG().toString("base64");
      return new Response(
        JSON.stringify(
          minimax
            ? {
                data: { image_base64: [base64] },
                base_resp: { status_code: 0, status_msg: "success" }
              }
            : { data: [{ b64_json: base64 }] }
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  };
}
