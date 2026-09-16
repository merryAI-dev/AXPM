import { mkdir, writeFile } from "node:fs/promises";
import { getAuth } from "firebase-admin/auth";
import { db, isEmulator } from "../src/lib/firebase";
import { issueBridgeKey } from "../src/lib/bridge";
process.loadEnvFile(".env.local");
if (!isEmulator()) throw new Error("이 스크립트는 로컬 에뮬레이터 전용입니다.");
db();
let user;
try {
  user = await getAuth().getUserByEmail("operator@axpm.test");
} catch {
  user = await getAuth().createUser({
    email: "operator@axpm.test",
    password: "local-demo-only-2026",
    emailVerified: true,
  });
}
const token = await issueBridgeKey(user.uid, user.email!, true);
await mkdir("private", { recursive: true });
await writeFile(
  "private/agent-runtime.json",
  JSON.stringify(
    {
      baseURL: process.env.APP_ORIGIN || "http://localhost:3000",
      uid: user.uid,
      key: token.key,
      expires: token.expires,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "로컬 에이전트 API/MCP 키를 private/agent-runtime.json에 저장했습니다. 키 값은 출력하지 않습니다.",
);
