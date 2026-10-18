import type { VoiceSecureStorage } from "../voice/voice-persistence";
import { SafeWebSearchError } from "./web-search-errors";

/** Keys only ever touch disk through the system secure storage. */
export class WebSearchSecrets {
  constructor(private readonly storage: VoiceSecureStorage) {}

  encrypt(apiKey: string): string {
    if (!this.storage.isEncryptionAvailable())
      throw new SafeWebSearchError(
        "系统安全存储不可用，无法安全保存联网搜索 API Key。"
      );
    try {
      return this.storage.encryptString(apiKey).toString("base64");
    } catch {
      throw new SafeWebSearchError("联网搜索 API Key 加密失败，配置未保存。");
    }
  }

  decrypt(encrypted: string): string {
    if (!this.storage.isEncryptionAvailable())
      throw new SafeWebSearchError(
        "系统安全存储不可用，无法读取联网搜索 API Key。"
      );
    let apiKey: string;
    try {
      apiKey = this.storage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      throw new SafeWebSearchError(
        "联网搜索 API Key 无法解密，请重新填写并保存。"
      );
    }
    if (!apiKey)
      throw new SafeWebSearchError("请重新填写并保存联网搜索 API Key。");
    return apiKey;
  }
}
