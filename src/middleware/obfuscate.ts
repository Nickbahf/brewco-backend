import type { NextFunction, Request, Response } from "express";
import { deobfuscateEnvelope, getObfuscateKey, obfuscateEnvelope } from "../lib/obfuscate";

// Decodes { enc: { nonce, data } } bodies, then re-encodes JSON responses the
// same way. Plain (non-enveloped) clients pass straight through, so old
// builds keep working. See lib/obfuscate.ts for the honesty label.
export function deobfuscate(req: Request, res: Response, next: NextFunction) {
  const key = getObfuscateKey();
  const body = req.body as { enc?: { nonce?: unknown; data?: unknown } } | undefined;
  if (!key || !body || typeof body !== "object" || !body.enc) return next();
  try {
    const { nonce, data } = body.enc;
    if (typeof nonce !== "string" || typeof data !== "string") {
      return res.status(400).json({ error: "bad envelope" });
    }
    req.body = JSON.parse(deobfuscateEnvelope(key, nonce, data));
    const json = res.json.bind(res);
    res.json = ((payload: unknown) => {
      return json({ enc: obfuscateEnvelope(key, JSON.stringify(payload)) });
    }) as typeof res.json;
    return next();
  } catch {
    return res.status(400).json({ error: "bad envelope" });
  }
}
