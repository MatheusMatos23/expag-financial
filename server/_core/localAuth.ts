/**
 * Local Authentication Module
 *
 * Provides username/password authentication for internal deployment.
 * Uses PBKDF2 with SHA-512 — no external dependencies required.
 *
 * Design decisions:
 * - No bcrypt dependency (avoids native addon compilation on deploy)
 * - PBKDF2 with 210,000 iterations (NIST SP 800-132 recommendation for SHA-512)
 * - Timing-safe comparison to prevent timing attacks
 * - Salt stored alongside hash (format: `pbkdf2$salt$hash`)
 */

import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const pbkdf2Async = promisify(pbkdf2);

const ALGORITHM  = "sha512";
const ITERATIONS = 210_000;
const KEY_LEN    = 64;    // bytes → 128 hex chars
const SALT_LEN   = 32;    // bytes

// ─── HASH PASSWORD ────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN).toString("hex");
  const key  = await pbkdf2Async(plain, salt, ITERATIONS, KEY_LEN, ALGORITHM);
  return `pbkdf2$${salt}$${key.toString("hex")}`;
}

// ─── VERIFY PASSWORD ──────────────────────────────────────────────────────────

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;

  const [, salt, expectedHex] = parts;
  const key = await pbkdf2Async(plain, salt, ITERATIONS, KEY_LEN, ALGORITHM);

  const actualBuf   = Buffer.from(key.toString("hex"));
  const expectedBuf = Buffer.from(expectedHex);

  // Buffers must be same length for timingSafeEqual
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

// ─── GENERATE DETERMINISTIC OPEN ID ──────────────────────────────────────────

export function emailToOpenId(email: string): string {
  return "local:" + createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 24);
}
