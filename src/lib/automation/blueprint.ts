import { createHash } from "node:crypto";

export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
