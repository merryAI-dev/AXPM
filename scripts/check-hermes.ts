// Opt-in live Gemini inference using synthetic uploaded cells only.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { db, isEmulator, storage, userDoc } from "../src/lib/firebase";
import { issueBridgeKey } from "../src/lib/bridge";
import { fixture } from "../tests/fixtures/workspace";
import { uploadWorkbook } from "../src/lib/workspace/local-files";
process.loadEnvFile(".env.local");
if (!isEmulator() || !process.argv.includes("--live"))
  throw new Error(
    "Run with --live in local Firebase emulators; this calls Gemini with synthetic data.",
  );
db();
const user = await getAuth().createUser({
  email: `hermes-check-${randomUUID()}@axpm.test`,
  emailVerified: true,
});
const key = await issueBridgeKey(user.uid, user.email!, true);
try {
  const bytes = await fixture();
  await uploadWorkbook(
    user.uid,
    new File([new Uint8Array(bytes)], "AXPM 합성 검증.xlsx"),
  );
  const response = await fetch(
    new URL("/api/bridge", process.env.APP_ORIGIN!),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "agent",
        input: {
          goal: "합성 데이터 연결 테스트입니다. axpm_list_uploaded_workbooks로 업로드 파일을 찾고 axpm_read_uploaded_cells로 실제 시트 이름을 읽으세요. 그 시트의 C3(기업명)와 B11(논의)를 매핑해 조회한 뒤, 두 실제 셀 값과 셀 주소만 한국어로 보고하세요. 변경하거나 제안하지 마세요.",
        },
      }),
      signal: AbortSignal.timeout(550000),
    },
  );
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.engine, "hermes");
  assert.equal(result.provider, "gemini");
  assert.ok(result.trace.length >= 2, "Actual MCP tool responses required");
  assert.match(result.summary, /합성기업/);
  assert.match(result.summary, /기존 논의/);
  assert.equal((await userDoc(user.uid).collection("jobs").get()).size, 0);
  console.log(
    "PASS: API → Hermes → Gemini → HTTP MCP → Firebase XLSX cells → final response.",
  );
  console.log(
    JSON.stringify({
      model: result.model,
      summary: result.summary,
      trace: result.trace,
    }),
  );
} finally {
  await db()
    .collection("bridgeKeys")
    .doc(createHash("sha256").update(key.key).digest("hex"))
    .delete();
  await storage().deleteFiles({ prefix: `users/${user.uid}/` });
  await db().recursiveDelete(userDoc(user.uid));
  await getAuth().deleteUser(user.uid);
}
