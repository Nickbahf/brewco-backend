import { createHash, randomBytes } from "crypto";

// Transport OBFUSCATION — not security. The key ships inside the APK by
// necessity, so anyone decompiling the app can read it. This only fogs
// traffic against casual packet-watchers. Real controls remain: TLS in
// transit, JWT + RBAC + zod server-side, manual attendance verification.
function keystream(secret: string, nonceHex: string): Buffer {
  return createHash("sha256").update(`${secret}:${nonceHex}`).digest();
}

export function obfuscateEnvelope(secret: string, json: string): { nonce: string; data: string } {
  const nonce = randomBytes(8);
  const ks = keystream(secret, nonce.toString("hex"));
  const bytes = Buffer.from(json, "utf8");
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i % ks.length];
  return { nonce: nonce.toString("hex"), data: out.toString("base64") };
}

export function deobfuscateEnvelope(secret: string, nonceHex: string, dataB64: string): string {
  const ks = keystream(secret, nonceHex);
  const bytes = Buffer.from(dataB64, "base64");
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i % ks.length];
  return out.toString("utf8");
}

export function getObfuscateKey(): string | null {
  const k = process.env.OBFUSCATE_KEY;
  return k && k.length >= 16 ? k : null;
}
