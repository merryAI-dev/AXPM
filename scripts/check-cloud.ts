import nextEnv from "@next/env";
import { google } from "googleapis";
import { db } from "../src/lib/firebase";
import type { MasterGrid } from "../src/lib/automation/master";

// Read-only connectivity check. Never print credentials or report contents.
nextEnv.loadEnvConfig(process.cwd());
const { productConfig } = await import("../src/lib/product-config");
const { MASTER, masterOverview } = await import(
  "../src/lib/automation/master"
);
const project = process.env.FIREBASE_PROJECT_ID;
const account = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
if (!project || !account || process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error("실제 Firebase 프로젝트와 서비스 계정 설정이 필요합니다.");
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const client = await auth.getClient();
await db().collection("users").limit(1).get();
console.log("Firestore: connected", project);
for (const path of ["config", "defaultSupportedIdpConfigs/google.com"]) {
  try {
    const { data } = await client.request<{ enabled?: boolean }>({
      url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/${path}`,
    });
    console.log(
      "Firebase Auth:",
      path,
      data.enabled === undefined ? "configured" : { enabled: data.enabled },
    );
  } catch {
    console.log("Firebase Auth:", path, "not accessible/configured");
    process.exitCode = 1;
  }
}
const { data: token } = await client.request<{ accessToken: string }>({
  url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
  method: "POST",
  data: {
    scope: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    lifetime: "3600s",
  },
});
const serviceAuth = new google.auth.OAuth2();
serviceAuth.setCredentials({ access_token: token.accessToken });
const drive = google.drive({ version: "v3", auth: serviceAuth });
for (const id of [
  MASTER.rootId,
  productConfig().reportFolderId,
  MASTER.spreadsheetId,
]) {
  const { data } = await drive.files.get({
    fileId: id,
    supportsAllDrives: true,
    fields: "id,capabilities(canEdit)",
  });
  console.log("Drive:", data.id, { canEdit: data.capabilities?.canEdit });
  if (!data.capabilities?.canEdit) process.exitCode = 1;
}
const sheets = google.sheets({ version: "v4", auth: serviceAuth });
const { data } = await sheets.spreadsheets.get({
  spreadsheetId: MASTER.spreadsheetId,
  ranges: [`'${MASTER.title}'!A1:AB1000`],
  fields: "sheets(properties,data(startRow,rowData(values(effectiveValue))))",
});
const sheet = data.sheets?.find(
  (s) => s.properties?.sheetId === MASTER.sheetId,
);
if (!sheet) throw new Error("마스터 탭을 찾지 못했습니다.");
const rows: MasterGrid["rows"] = [];
for (const block of sheet.data || [])
  for (const [offset, row] of (block.rowData || []).entries())
    rows[(block.startRow || 0) + offset] = (row.values || []).map((c) => ({
      value:
        c.effectiveValue?.boolValue ??
        c.effectiveValue?.numberValue ??
        c.effectiveValue?.stringValue ??
        null,
    }));
console.log(
  "Master schema and dashboard totals:",
  masterOverview({ rows, version: "read-only-check" }).totals,
);
