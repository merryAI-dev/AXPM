import { google } from "googleapis";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isEmulator, userDoc } from "./firebase";
const exec = promisify(execFile);
let cached:
  { account: string; accessToken: string; expires: number } | undefined;
export async function cloudAccessToken() {
  if (process.env.AXPM_LOCAL_GCLOUD_AUTH === "true") {
    if (!isEmulator())
      throw new Error(
        "로컬 gcloud 인증은 에뮬레이터에서만 사용할 수 있습니다.",
      );
    const { stdout } = await exec("gcloud", ["auth", "print-access-token"], {
      timeout: 30000,
      maxBuffer: 20000,
    });
    return stdout.trim();
  }
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("GCP 실행 계정 인증이 필요합니다.");
  return token;
}
export function serviceAccountMode() {
  return (
    !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    !!process.env.GOOGLE_SERVICE_ACCOUNT_ROOT_ID
  );
}
export async function driveServiceAccountClient(uid: string) {
  const root = (
    await userDoc(uid).collection("config").doc("drive").get()
  ).data()?.rootId;
  if (!root || root !== process.env.GOOGLE_SERVICE_ACCOUNT_ROOT_ID)
    throw new Error("서비스 계정에 허용된 관리 폴더 설정이 필요합니다.");
  const account = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  if (
    !/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(
      account,
    )
  )
    throw new Error("서비스 계정 이메일이 올바르지 않습니다.");
  if (
    !cached ||
    cached.account !== account ||
    cached.expires < Date.now() + 120000
  ) {
    const source = await cloudAccessToken();
    const result = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${source}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: [
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets",
          ],
          lifetime: "3600s",
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!result.ok)
      throw new Error(
        `서비스 계정 토큰 발급 실패 (${result.status}). IAM Token Creator 권한을 확인해주세요.`,
      );
    const token = await result.json();
    cached = {
      account,
      accessToken: token.accessToken,
      expires: Date.parse(token.expireTime),
    };
  }
  const client = new google.auth.OAuth2();
  client.setCredentials({
    access_token: cached.accessToken,
    expiry_date: cached.expires,
  });
  return client;
}
