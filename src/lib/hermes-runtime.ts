import { hermesPermissions } from "./bridge-policy";
import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { db } from "./firebase";
import { runHermesSession } from "./hermes-session";
export { parseHermesOutput, type HermesTrace } from "./hermes-session";

export async function runHermes(input: {
  uid: string;
  goal: string;
  model: string;
  scheduled: boolean;
  history: unknown;
  signal: AbortSignal;
}) {
  const { issueBridgeKey } = await import("./bridge");
  const user = await getAuth().getUser(input.uid);
  if (!user.email) throw new Error("운영자 이메일이 필요합니다.");
  const permissions = hermesPermissions(input.scheduled);
  const connection = await issueBridgeKey(
    input.uid,
    user.email,
    permissions.allowAgent,
    permissions.readOnly,
    permissions.allowMasterWrite,
    permissions.allowOperationsWrite,
  );
  try {
    return await runHermesSession({
      ...input,
      origin: process.env.APP_ORIGIN || "",
      bridgeKey: connection.key,
    });
  } finally {
    await db()
      .collection("bridgeKeys")
      .doc(createHash("sha256").update(connection.key).digest("hex"))
      .delete();
  }
}
