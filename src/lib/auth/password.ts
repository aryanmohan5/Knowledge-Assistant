import bcrypt from "bcryptjs";
import { z } from "zod";

export const BCRYPT_COST = 12;

// A real hash of a random string; compared against when the user doesn't
// exist so login takes the same time whether or not the account is real.
const DUMMY_HASH = "$2b$12$olIZVpwIjBj8PMJenPqWOOoWauVQjairiHa9nsSrkr4XfwfVVFQsK";

/** bcrypt only uses the first 72 bytes, so longer passwords are rejected outright. */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password must be at most 72 bytes");

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return ok && !!hash;
}
