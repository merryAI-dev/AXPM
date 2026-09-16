import Anthropic from "@anthropic-ai/sdk";
export function agentRuntime() {
  const engine = process.env.AGENT_ENGINE || "hermes";
  const provider = process.env.AGENT_PROVIDER || "gemini";
  const model = process.env.AGENT_MODEL || "";
  if (engine === "hermes")
    return {
      engine,
      provider,
      model,
      configured:
        provider === "gemini" &&
        !!model &&
        !!process.env.GEMINI_API_KEY &&
        !!process.env.HERMES_BIN,
    };
  return {
    engine,
    provider,
    model,
    configured:
      engine === "builtin" &&
      !!model &&
      (provider === "vertex"
        ? !!(process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID)
        : provider === "anthropic" && !!process.env.ANTHROPIC_API_KEY),
  };
}
export function agentClient() {
  if (!agentRuntime().configured)
    throw new Error("에이전트 모델과 제공자 연결 설정이 필요합니다.");
  return new Anthropic({ timeout: 60000, maxRetries: 1 });
}
