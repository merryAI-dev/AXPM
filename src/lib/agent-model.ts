import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { agentClient, agentRuntime } from "./agent-runtime";
import { cloudAccessToken } from "./google-service-account";
export function chatMessages(
  system: string,
  messages: Anthropic.MessageParam[],
) {
  const converted: Record<string, unknown>[] = [
    { role: "system", content: system },
  ];
  for (const m of messages) {
    const blocks =
      typeof m.content === "string"
        ? [{ type: "text" as const, text: m.content }]
        : m.content;
    const content = blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlockParam).text)
      .join("\n");
    const calls = blocks.filter(
      (b) => b.type === "tool_use",
    ) as Anthropic.ToolUseBlockParam[];
    if (content || calls.length)
      converted.push({
        role: m.role,
        content: content || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    for (const b of blocks)
      if (b.type === "tool_result")
        converted.push({
          role: "tool",
          tool_call_id: b.tool_use_id,
          content:
            typeof b.content === "string"
              ? b.content
              : JSON.stringify(b.content),
        });
  }
  return converted;
}
export async function modelResponse(input: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  signal: AbortSignal;
}): Promise<{ content: Anthropic.ContentBlock[] }> {
  const runtime = agentRuntime();
  if (!runtime.configured) throw new Error("모델 연결 설정이 필요합니다.");
  if (runtime.provider !== "vertex")
    return agentClient().messages.create(
      {
        model: runtime.model,
        max_tokens: 2400,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
      },
      { signal: input.signal },
    );
  const project =
    process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || "global";
  if (
    !/^[a-z][a-z0-9-]{4,62}$/.test(project || "") ||
    !/^[a-z][a-z0-9-]+$/.test(location)
  )
    throw new Error("Vertex 프로젝트/리전 설정이 잘못되었습니다.");
  const host =
    location === "global"
      ? "aiplatform.googleapis.com"
      : `${location}-aiplatform.googleapis.com`;
  const token = await cloudAccessToken();
  const response = await fetch(
    `https://${host}/v1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: runtime.model,
        messages: chatMessages(input.system, input.messages),
        tools: input.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        })),
        max_tokens: 2400,
        temperature: 0.2,
      }),
      signal: input.signal,
    },
  );
  if (!response.ok)
    throw new Error(
      `Vertex 모델 호출 실패 (${response.status}). 모델 사용 가능 여부와 결제/IAM 설정을 확인해주세요.`,
    );
  const data = await response.json(),
    choice = data.choices?.[0];
  if (!choice?.message || choice.finish_reason === "length")
    throw new Error("모델이 완전한 응답을 반환하지 않았습니다.");
  const content: Anthropic.ContentBlock[] = [];
  if (choice.message.content)
    content.push({
      type: "text",
      text: choice.message.content,
      citations: null,
    });
  for (const call of choice.message.tool_calls || [])
    content.push({
      type: "tool_use",
      id: call.id || randomUUID(),
      name: call.function.name,
      input: JSON.parse(call.function.arguments || "{}"),
    } as Anthropic.ToolUseBlock);
  if (!content.length) throw new Error("모델 응답이 비어 있습니다.");
  return { content };
}
