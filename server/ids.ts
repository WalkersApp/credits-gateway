import { randomBytes, randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();

/** Short, unambiguous, human-readable reference shown in the UI (no 0/O/1/I). */
export function newReference(prefix: string): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}-${out}`;
}
