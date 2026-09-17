import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { isAuthorizedEmail, workspaceUidFor } from "./access-policy";
export function db() {
  if (!getApps().length)
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      ...(process.env.FIRESTORE_EMULATOR_HOST
        ? {}
        : { credential: applicationDefault() }),
    });
  return getFirestore();
}
export const userDoc = (uid: string) => db().collection("users").doc(uid);
export const storage = () => {
  db();
  return getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
};
export function isEmulator() {
  return (
    process.env.FIREBASE_PROJECT_ID === "demo-axpm" &&
    process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8080" &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099"
  );
}
export async function authenticate(request: Request) {
  db();
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new ApiError(401, "Google 로그인이 필요합니다.");
  let user;
  try {
    user = await getAuth().verifyIdToken(token);
  } catch {
    throw new ApiError(401, "로그인이 만료되었습니다. 다시 로그인해주세요.");
  }
  if (!isEmulator() && (!user.email_verified || !isAuthorizedEmail(user.email)))
    throw new ApiError(403, "허용된 운영 계정이 아닙니다.");
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== process.env.APP_ORIGIN)
      throw new ApiError(403, "허용되지 않은 요청 출처입니다.");
  }
  return { ...user, uid: workspaceUidFor(user.uid) };
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function audit(
  uid: string,
  action: string,
  detail: Record<string, unknown>,
) {
  await userDoc(uid)
    .collection("audit")
    .add({ action, ...detail, createdAt: new Date().toISOString() });
}
