import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { google } from "googleapis";
import { ApiError, userDoc } from "./firebase";

const GmailScope = "https://www.googleapis.com/auth/gmail.readonly";

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  const origin = process.env.APP_ORIGIN || "";
  if (!clientId || !clientSecret || !/^https?:\/\//.test(origin))
    throw new ApiError(503, "개인 Google 연동 설정이 완료되지 않았습니다.");
  return {
    clientId,
    clientSecret,
    redirectUri: `${origin.replace(/\/$/, "")}/api/mail/oauth/callback`,
  };
}

function key() {
  const value = Buffer.from(process.env.OAUTH_TOKEN_ENCRYPTION_KEY || "", "base64");
  if (value.length !== 32)
    throw new ApiError(503, "Google 연결 토큰 암호화 설정이 필요합니다.");
  return value;
}

function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

function open(value: string) {
  const [iv, tag, body] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body) throw new Error("저장된 Google 연결을 읽지 못했습니다.");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

function client() {
  const config = oauthConfig();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export async function beginGoogleUserOAuth(uid: string) {
  const state = randomBytes(32).toString("base64url");
  await userDoc(uid).collection("oauthStates").doc(state).set({
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 10 * 60_000,
  });
  return {
    url: client().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: ["openid", "email", GmailScope],
      state: `${uid}.${state}`,
    }),
  };
}

export async function finishGoogleUserOAuth(url: URL) {
  const code = url.searchParams.get("code") || "";
  const [uid, state, extra] = (url.searchParams.get("state") || "").split(".");
  if (!code || !uid || !state || extra) throw new ApiError(400, "Google 연결 요청이 올바르지 않습니다.");
  const ref = userDoc(uid).collection("oauthStates").doc(state);
  const valid = await ref.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.expiresAt < Date.now()) return false;
    tx.delete(ref);
    return true;
  });
  if (!valid) throw new ApiError(400, "Google 연결 요청이 만료되었습니다.");
  const auth = client();
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token)
    throw new ApiError(400, "Google 갱신 권한을 받지 못했습니다. 다시 연결해주세요.");
  auth.setCredentials(tokens);
  const profile = await google.oauth2({ version: "v2", auth }).userinfo.get();
  const email = profile.data.email || "";
  if (!email) throw new ApiError(400, "연결한 Google 계정을 확인하지 못했습니다.");
  const expected = (process.env.AXPM_GMAIL_ACCOUNT || "").toLowerCase();
  if (expected && email.toLowerCase() !== expected)
    throw new ApiError(403, `${expected} 계정으로 연결해주세요.`);
  await userDoc(uid).collection("connections").doc("gmail").set({
    email,
    refreshToken: seal(tokens.refresh_token),
    accessToken: tokens.access_token ? seal(tokens.access_token) : "",
    expiryDate: tokens.expiry_date || 0,
    scope: tokens.scope || GmailScope,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { uid, email };
}

export async function googleUserClient(uid: string) {
  const ref = userDoc(uid).collection("connections").doc("gmail");
  const data = (await ref.get()).data();
  if (!data?.refreshToken)
    throw new ApiError(409, "Google 계정을 먼저 연결해주세요.");
  const auth = client();
  auth.setCredentials({
    refresh_token: open(String(data.refreshToken)),
    access_token: data.accessToken ? open(String(data.accessToken)) : undefined,
    expiry_date: Number(data.expiryDate) || undefined,
    scope: data.scope,
  });
  auth.on("tokens", (tokens) => {
    ref.set(
      {
        ...(tokens.refresh_token ? { refreshToken: seal(tokens.refresh_token) } : {}),
        ...(tokens.access_token ? { accessToken: seal(tokens.access_token) } : {}),
        ...(tokens.expiry_date ? { expiryDate: tokens.expiry_date } : {}),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    ).catch(() => undefined);
  });
  return { auth, email: String(data.email || "") };
}

export async function disconnectGoogleUser(uid: string) {
  const ref = userDoc(uid).collection("connections").doc("gmail");
  const data = (await ref.get()).data();
  if (data?.refreshToken) {
    const token = open(String(data.refreshToken));
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(30000),
    }).catch(() => undefined);
  }
  await ref.delete();
  return { disconnected: true };
}
