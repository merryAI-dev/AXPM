import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
const app =
  getApps()[0] ||
  initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "unconfigured",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
export const auth = getAuth(app);
export const emulator =
  process.env.NEXT_PUBLIC_USE_EMULATORS === "true" &&
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "demo-axpm";
if (emulator && !auth.emulatorConfig)
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
export async function api(path: string, body?: unknown, blob = false) {
  const token = await auth.currentUser?.getIdToken();
  const form = body instanceof FormData;
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token || ""}`,
      ...(body !== undefined && !form
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "요청 실패");
  }
  return blob ? response.blob() : response.json();
}
