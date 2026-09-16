import ExcelJS from "exceljs";
import { workbookView } from "./workbook-view";
import { createHash } from "node:crypto";
import { patchWorkbook } from "../template";
import {
  mappingSchema,
  validateValues,
  valuesSchema,
  type Mapping,
} from "./schema";
export const fingerprint = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");
export async function readWorkbook(
  buffer: Buffer,
  selected?: { sheet: string; mapping: Mapping },
  preview = false,
) {
  if (buffer.length > 10_000_000)
    throw new Error("파일은 10MB 이하여야 합니다.");
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(buffer as never);
  const sheets = w.worksheets.map((s) => ({
    name: s.name,
    rows: s.rowCount,
    columns: s.columnCount,
  }));
  const values: Record<string, string> = {};
  const anchors: Record<string, string> = {};
  const formulas: string[] = [];
  if (selected) {
    mappingSchema.parse(selected.mapping);
    const s = w.getWorksheet(selected.sheet);
    if (!s) throw new Error("시트를 찾을 수 없습니다.");
    for (const field of selected.mapping) {
      const c = s.getCell(field.cell);
      values[field.key] = c.text;
      anchors[field.key] = c.master.address;
      if (c.type === ExcelJS.ValueType.Formula) formulas.push(field.key);
    }
  }
  return {
    sheets,
    values,
    anchors,
    formulas,
    version: fingerprint(buffer),
    ...(preview
      ? {
          view: workbookView(
            w,
            selected?.sheet || sheets[0]?.name,
            selected?.mapping || [],
          ),
        }
      : {}),
  };
}
export async function editWorkbook(
  buffer: Buffer,
  sheet: string,
  mapping: Mapping,
  before: Record<string, string>,
  after: Record<string, string>,
) {
  valuesSchema.parse(after);
  validateValues(mapping, before);
  validateValues(mapping, after);
  const current = await readWorkbook(buffer, { sheet, mapping });
  for (const f of mapping)
    if (current.values[f.key] !== before[f.key])
      throw new Error(`${f.cell}: 원본이 변경되었습니다. 다시 읽어주세요.`);
  const changed = mapping.filter((f) => before[f.key] !== after[f.key]);
  if (!changed.length) return buffer;
  if (changed.some((f) => current.formulas.includes(f.key)))
    throw new Error("수식 셀은 덮어쓸 수 없습니다.");
  const output = await patchWorkbook(
    buffer,
    sheet,
    Object.fromEntries(changed.map((f) => [f.key, f.cell])),
    after,
  );
  const verified = await readWorkbook(output, { sheet, mapping });
  for (const f of mapping)
    if (verified.values[f.key] !== after[f.key])
      throw new Error("생성 파일 셀 검증에 실패했습니다.");
  return output;
}
