import { geminiApiKey } from "./gemini-key";

export function agentRuntime() {
  const engine = process.env.AGENT_ENGINE || "builtin";
  const provider = process.env.AGENT_PROVIDER || "gemini";
  const model = process.env.AGENT_MODEL || "";
  const validEngine = engine === "builtin" || engine === "hermes";
  return {
    engine,
    provider,
    model,
    configured:
      validEngine &&
      provider === "gemini" &&
      !!model &&
      !!geminiApiKey() &&
      (engine !== "hermes" || !!process.env.HERMES_BIN),
  };
}
