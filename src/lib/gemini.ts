import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { geminiApiKey } from "./gemini-key";

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
};
export type ModelMessage = Anthropic.MessageParam & {
  geminiParts?: GeminiPart[];
};
export function geminiContents(messages: ModelMessage[]) {
  const calls = new Map<string, { name: string; id?: string }>();
  return messages.map((message) => {
    const blocks =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    for (const block of blocks)
      if (block.type === "tool_use") {
        const native = message.geminiParts?.find(
          (p) => p.functionCall?.id === block.id,
        )?.functionCall;
        calls.set(block.id, { name: block.name, id: native?.id });
      }
    if (message.role === "assistant" && message.geminiParts)
      return { role: "model", parts: message.geminiParts };
    return {
      role: message.role === "assistant" ? "model" : "user",
      parts: blocks.map((block) => {
        if (block.type === "text") return { text: block.text };
        if (block.type === "tool_use")
          return { functionCall: { name: block.name, args: block.input } };
        if (block.type === "tool_result") {
          const call = calls.get(block.tool_use_id);
          if (!call)
            throw new Error("Gemini 도구 응답의 원본 호출을 찾지 못했습니다.");
          let value: unknown = block.content || "";
          if (typeof value === "string") {
            try {
              value = JSON.parse(value);
            } catch {}
          }
          return {
            functionResponse: {
              name: call.name,
              ...(call.id ? { id: call.id } : {}),
              response: { [block.is_error ? "error" : "result"]: value },
            },
          };
        }
        throw new Error("지원하지 않는 Gemini 메시지 형식입니다.");
      }),
    };
  });
}

export function parseGeminiResponse(data: {
  candidates?: { finishReason?: string; content?: { parts?: GeminiPart[] } }[];
}) {
  const candidate = data.candidates?.[0];
  if (!candidate || candidate.finishReason !== "STOP")
    throw new Error(
      `Gemini가 완전한 응답을 반환하지 않았습니다 (${candidate?.finishReason || "응답 없음"}).`,
    );
  const geminiParts = candidate.content?.parts || [];
  const content: Anthropic.ContentBlock[] = [];
  for (const part of geminiParts) {
    if (part.text && !part.thought)
      content.push({ type: "text", text: part.text, citations: null });
    if (part.functionCall)
      content.push({
        type: "tool_use",
        id: part.functionCall.id || randomUUID(),
        name: part.functionCall.name,
        input: part.functionCall.args || {},
      } as Anthropic.ToolUseBlock);
  }
  if (!content.length) throw new Error("Gemini 응답이 비어 있습니다.");
  return { content, geminiParts };
}

export async function geminiResponse(
  input: {
    system: string;
    messages: ModelMessage[];
    tools: Anthropic.Tool[];
    signal: AbortSignal;
  },
  model: string,
) {
  if (!/^gemini-[a-zA-Z0-9._-]+$/.test(model))
    throw new Error("Gemini 모델 ID가 올바르지 않습니다.");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: geminiContents(input.messages),
        ...(input.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: input.tools.map((tool) => {
                    const { $schema: _schema, ...parametersJsonSchema } =
                      tool.input_schema;
                    return {
                      name: tool.name,
                      description: tool.description,
                      parametersJsonSchema,
                    };
                  }),
                },
              ],
            }
          : {}),
        generationConfig: { maxOutputTokens: 8192 },
      }),
      signal: input.signal,
    },
  );
  if (!response.ok)
    throw new Error(
      `Gemini API 호출 실패 (${response.status}). API 키·모델·사용 한도를 확인해주세요.`,
    );
  return parseGeminiResponse(await response.json());
}
