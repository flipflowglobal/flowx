import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || process.env.SESSION_SECRET || "jdl-default-dev-key-32-bytes!!!";
const KEY = Buffer.from(ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32));

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptPrivateKey(plaintext: string): EncryptedData {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptPrivateKey(data: EncryptedData): string {
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(data.iv, "hex"));
  decipher.setAuthTag(Buffer.from(data.authTag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
