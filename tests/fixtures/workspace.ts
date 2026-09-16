import ExcelJS from "exceljs";
import type { DrivePort } from "../../src/lib/workspace/drive";
import {
  FOLDER,
  SHEET,
  XLSX,
  type DriveFile,
} from "../../src/lib/workspace/schema";
export async function fixture() {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("보고서 ' 1회");
  s.getCell("C3").value = "합성기업";
  s.mergeCells("C3:D3");
  s.getCell("B11").value = "기존 논의";
  s.getCell("B11").font = { bold: true };
  s.getCell("A1").value = { formula: "1+1", result: 2 };
  s.pageSetup.paperSize = 9;
  w.addWorksheet("다른 시트").getCell("A1").value = "보존";
  return Buffer.from(await w.xlsx.writeBuffer());
}
export const file = (
  id: string,
  mimeType = FOLDER,
  parents = ["root"],
): DriveFile => ({
  id,
  name: id,
  mimeType,
  parents,
  version: "1",
  modifiedTime: "",
  size: "0",
  trashed: false,
  webViewLink: "",
  capabilities: {},
});
export function fakePort(bytes: Buffer) {
  const files = new Map<string, DriveFile>([
    ["root", file("root", FOLDER, [])],
    ["nested", file("nested")],
    ["report", file("report", XLSX, ["nested"])],
    ["sheet", file("sheet", SHEET)],
    ["foreign", file("foreign", XLSX, ["elsewhere"])],
    ["elsewhere", file("elsewhere", FOLDER, [])],
  ]);
  const state = {
    bytes,
    writes: 0,
    native: { company: "합성기업", notes: "기존 논의" },
    changed: [] as string[],
  };
  const port: DrivePort = {
    async metadata(id) {
      if (!files.has(id)) throw new Error("not found");
      return structuredClone(files.get(id)!);
    },
    async list(parent, token, trashed = false) {
      void token;
      return {
        files: [...files.values()].filter(
          (f) => f.parents.includes(parent) && f.trashed === trashed,
        ),
        nextPageToken: "",
      };
    },
    async download() {
      return state.bytes;
    },
    async update(id, fields, b) {
      state.writes++;
      const f = files.get(id)!;
      Object.assign(f, fields, { version: String(Number(f.version) + 1) });
      if (b) state.bytes = b;
      return structuredClone(f);
    },
    async create(parent, name, bytes) {
      state.writes++;
      const f = { ...file("created", bytes ? XLSX : FOLDER, [parent]), name };
      files.set(f.id, f);
      return f;
    },
    async copy(id, parent, name) {
      state.writes++;
      const f = { ...files.get(id)!, id: "copy", parents: [parent], name };
      files.set(f.id, f);
      return f;
    },
    async sheets() {
      return [{ name: "원본", rows: 30, columns: 5 }];
    },
    async readCells(_id, _sheet, m) {
      return {
        values: Object.fromEntries(
          m.map((f) => [
            f.key,
            state.native[f.key as keyof typeof state.native],
          ]),
        ),
        anchors: Object.fromEntries(m.map((f) => [f.key, f.cell])),
        formulas: [],
      };
    },
    async writeCells(_id, _sheet, m, values) {
      state.writes++;
      state.changed = m.map((f) => f.key);
      for (const f of m)
        state.native[f.key as keyof typeof state.native] = values[f.key];
      files.get("sheet")!.version = "2";
    },
  };
  return { port, files, state };
}
