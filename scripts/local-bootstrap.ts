import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultMapping } from "../src/lib/report-fields";
const dir = process.argv[2];
if (!dir)
  throw new Error("사용법: npx tsx scripts/local-bootstrap.ts /path/to/xlsx");
const authBase =
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:";
const credentials = {
  email: "operator@axpm.test",
  password: "local-demo-only-2026",
  returnSecureToken: true,
};
let response = await fetch(authBase + "signInWithPassword?key=demo-key", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(credentials),
});
if (!response.ok)
  response = await fetch(authBase + "signUp?key=demo-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
const login = await response.json();
if (!response.ok) throw new Error("로컬 Auth 에뮬레이터 계정 생성 실패");
async function call(path: string, body?: unknown) {
  const form = body instanceof FormData;
  const r = await fetch(`http://127.0.0.1:3000/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${login.idToken}`,
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r;
}
const form = new FormData();
let templateFile: string | undefined;
for (const file of await readdir(dir)) {
  const n = file.normalize("NFC");
  if (!n.endsWith(".xlsx")) continue;
  let role: string | undefined;
  if (n.includes("(멘토님용)")) role = "mentor";
  else if (n.includes("(내부)") && n.includes("중장년")) role = "internal";
  else if (n.includes("특화 멘토링 신청시트")) role = "applications";
  else if (n.includes("전담 멘토링 신청시트")) role = "dedicated";
  else if (n.includes("멘토링 보고서")) templateFile = file;
  if (role) form.set(role, new File([await readFile(join(dir, file))], n));
}
const imported = await (await call("import", form)).json();
console.log("Local Firebase import:", imported);
if (templateFile) {
  const t = new FormData();
  t.set(
    "file",
    new File(
      [await readFile(join(dir, templateFile))],
      templateFile.normalize("NFC"),
    ),
  );
  console.log("Template mapping:", await (await call("template", t)).json());
}
const state = await (await call("state")).json();
const company = state.snapshot.companies[0];
const fields = Object.fromEntries(
  Object.keys(defaultMapping).map((k) => [
    k,
    `[다운로드 검증용] ${k}\n실제 보고서로 사용하지 마세요.`,
  ]),
);
fields.company = company.name;
const saved = await (
  await call("report", { companyId: company.id, fields })
).json();
const output = await call("report/download", { id: saved.id });
await mkdir("private/validation", { recursive: true });
await writeFile(
  "private/validation/report-cell-mapping-check.xlsx",
  Buffer.from(await output.arrayBuffer()),
);
await writeFile(
  "private/validation/summary.json",
  JSON.stringify(
    {
      companies: state.snapshot.companies.length,
      regular: state.snapshot.companies.reduce(
        (sum: number, c: { regular: number }) => sum + c.regular,
        0,
      ),
      specialty: state.snapshot.companies.reduce(
        (sum: number, c: { specialtyCount: number }) => sum + c.specialtyCount,
        0,
      ),
      appointments: state.snapshot.appointments.length,
      findings: state.findings.length,
      templateImageCount: state.template.imageCount,
    },
    null,
    2,
  ),
);
console.log(
  "Report download verified through authenticated API. Artifact: private/validation/report-cell-mapping-check.xlsx",
);
