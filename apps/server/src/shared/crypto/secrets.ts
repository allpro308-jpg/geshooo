import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { config } from "@/config";

function encryptionKey(): Buffer {
  return createHash("sha256").update(config.sessionSecret).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes-256-gcm:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [scheme, iv, tag, encrypted] = payload.split(":");
  if (scheme !== "aes-256-gcm" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported secret payload");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
