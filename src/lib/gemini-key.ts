import { readFileSync } from "node:fs";

export function geminiApiKey() {
  if (process.env.GEMINI_API_KEY?.trim())
    return process.env.GEMINI_API_KEY.trim();
  if (!process.env.GEMINI_API_KEY_FILE) return "";
  try {
    const key = readFileSync(process.env.GEMINI_API_KEY_FILE, "utf8").trim();
    return key.length <= 2000 && !/\s/.test(key) ? key : "";
  } catch {
    return "";
  }
}
