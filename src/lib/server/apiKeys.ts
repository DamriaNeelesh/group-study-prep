import "server-only";

import crypto from "node:crypto";

function base64Url(bytes: Buffer) {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function hashApiKey(key: string) {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(opts?: { env?: "live" | "test" }) {
  const env = opts?.env || "live";
  const rand = base64Url(crypto.randomBytes(32));
  const key = `srk_${env}_${rand}`;
  const keyPrefix = key.slice(0, 12);
  const keyHash = hashApiKey(key);
  return { key, keyPrefix, keyHash };
}
