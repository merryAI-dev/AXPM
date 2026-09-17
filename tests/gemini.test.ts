import test from "node:test";
import assert from "node:assert/strict";
import { geminiContents, parseGeminiResponse } from "../src/lib/gemini";

test("Gemini preserves original thought signatures and pairs parallel function results", () => {
  const parts = [
    {
      text: "private reasoning",
      thought: true,
      thoughtSignature: "opaque-one",
    },
    {
      functionCall: { id: "a", name: "read", args: { cell: "C3" } },
      thoughtSignature: "opaque-two",
    },
    { functionCall: { id: "b", name: "read", args: { cell: "B11" } } },
  ];
  const response = parseGeminiResponse({
    candidates: [{ finishReason: "STOP", content: { parts } }],
  });
  assert.equal(response.content.length, 2);
  const contents = geminiContents([
    {
      role: "assistant",
      content: response.content,
      geminiParts: response.geminiParts,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "a",
          content: '{"value":"합성기업"}',
        },
        {
          type: "tool_result",
          tool_use_id: "b",
          content: "조회 실패",
          is_error: true,
        },
      ],
    },
  ]);
  assert.deepEqual(contents[0].parts, parts);
  assert.deepEqual(contents[1].parts, [
    {
      functionResponse: {
        id: "a",
        name: "read",
        response: { result: { value: "합성기업" } },
      },
    },
    {
      functionResponse: {
        id: "b",
        name: "read",
        response: { error: "조회 실패" },
      },
    },
  ]);
});
test("Gemini rejects empty, blocked and truncated responses before any tool executes", () => {
  for (const finishReason of [
    "MAX_TOKENS",
    "SAFETY",
    "MALFORMED_FUNCTION_CALL",
  ])
    assert.throws(
      () =>
        parseGeminiResponse({
          candidates: [
            {
              finishReason,
              content: { parts: [{ functionCall: { name: "write" } }] },
            },
          ],
        }),
      /완전한/,
    );
  assert.throws(
    () =>
      parseGeminiResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "hidden", thought: true }] },
          },
        ],
      }),
    /비어/,
  );
  assert.throws(
    () =>
      geminiContents([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "missing", content: "x" },
          ],
        },
      ]),
    /원본 호출/,
  );
});
