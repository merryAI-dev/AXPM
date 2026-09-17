import type Anthropic from "@anthropic-ai/sdk";
import { agentRuntime } from "./agent-runtime";
import { geminiResponse, type GeminiPart, type ModelMessage } from "./gemini";

export async function modelResponse(input: {
  system: string;
  messages: ModelMessage[];
  tools: Anthropic.Tool[];
  signal: AbortSignal;
}): Promise<{ content: Anthropic.ContentBlock[]; geminiParts?: GeminiPart[] }> {
  const runtime = agentRuntime();
  if (!runtime.configured) throw new Error("Gemini 연결 설정이 필요합니다.");
  return geminiResponse(input, runtime.model);
}
