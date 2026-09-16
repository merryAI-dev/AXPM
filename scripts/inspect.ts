import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { importWorkbooks, monitor, type Input } from "../src/lib/importer";
const dir = process.argv[2];
if (!dir) throw new Error("사용법: npm run import:inspect -- /path/to/files");
const files = await readdir(dir);
const inputs: Input[] = [];
for (const file of files) {
  const name = file.normalize("NFC");
  if (!name.endsWith(".xlsx")) continue;
  let role: Input["role"] | undefined;
  if (name.includes("(멘토님용)")) role = "mentor";
  else if (name.includes("(내부)") && name.includes("중장년"))
    role = "internal";
  else if (name.includes("특화 멘토링 신청시트")) role = "applications";
  else if (name.includes("전담 멘토링 신청시트")) role = "dedicated";
  if (role)
    inputs.push({ role, name, buffer: await readFile(join(dir, file)) });
}
const snapshot = await importWorkbooks(inputs);
console.log(
  JSON.stringify(
    {
      sources: snapshot.sources.map((x) => ({
        role: x.role,
        sheets: x.sheets,
      })),
      companies: snapshot.companies.length,
      regular: snapshot.companies.reduce((n, c) => n + c.regular, 0),
      specialtyCompletedMarks: snapshot.companies.reduce(
        (sum, c) => sum + c.specialtyCount,
        0,
      ),
      appointments: snapshot.appointments.length,
      findings: monitor(snapshot, 3, "2026-09-16").length,
    },
    null,
    2,
  ),
);
