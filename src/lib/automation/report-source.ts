import ExcelJS from "exceljs";
import { google } from "googleapis";
import { googleClient } from "../google";
import { type DriveWorkspace } from "../workspace/drive";
import { SHEET, XLSX } from "../workspace/schema";
import type { ReportSource, ReportTab } from "./report-submission";

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value)
      return value.richText.map((entry) => entry.text).join("");
    if ("error" in value) return "";
    if ("result" in value) {
      if (value.result instanceof Date)
        return value.result.toISOString().slice(0, 10);
      if (
        typeof value.result === "object" &&
        value.result &&
        "error" in value.result
      )
        return "";
      return String(value.result ?? "");
    }
    if ("text" in value) return String(value.text ?? "");
  }
  return String(value).trim();
}

export async function readReportSource(
  uid: string,
  ws: DriveWorkspace,
  id: string,
): Promise<ReportSource> {
  const file = await ws.scoped(id);
  const tabs: ReportTab[] = [];
  if (file.mimeType === XLSX) {
    const buffer = await ws.port.download(id);
    if (buffer.length > 10_000_000)
      throw new Error("보고서는 10MB 이하로 나누어주세요.");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as never);
    if (book.worksheets.length > 50)
      throw new Error("파일당 50개 이하의 탭을 지원합니다.");
    for (const sheet of book.worksheets) {
      if (!/^\s*[1-4]회차(?:\s|\(|\[|$)/.test(sheet.name)) continue;
      const formulaCells: string[] = [];
      const cells = Array.from({ length: 80 }, (_, r) =>
        Array.from({ length: 8 }, (_, c) => {
          const entry = sheet.getCell(r + 1, c + 1);
          if (entry.isMerged && entry.master.address !== entry.address)
            return "";
          if (entry.type === ExcelJS.ValueType.Formula)
            formulaCells.push(entry.address);
          return cellText(entry);
        }),
      );
      tabs.push({
        name: sheet.name,
        cells,
        formulaCells,
        hidden: sheet.state !== "visible",
      });
    }
  } else if (file.mimeType === SHEET) {
    const api = google.sheets({
      version: "v4",
      auth: await googleClient(uid, "drive"),
      timeout: 30000,
    });
    const { data: meta } = await api.spreadsheets.get({
      spreadsheetId: id,
      fields: "sheets(properties)",
    });
    if ((meta.sheets?.length || 0) > 50)
      throw new Error("파일당 50개 이하의 탭을 지원합니다.");
    const selected = (meta.sheets || []).filter(
      (s) =>
        /^\s*[1-4]회차(?:\s|\(|\[|$)/.test(s.properties?.title || "") &&
        !s.properties?.hidden,
    );
    if (selected.length) {
      const ranges = selected.map(
        (s) =>
          `'${s.properties!.title!.replace(/'/g, "''")}'!A1:${String.fromCharCode(64 + Math.min(8, s.properties!.gridProperties?.columnCount || 8))}${Math.min(80, s.properties!.gridProperties?.rowCount || 80)}`,
      );
      const { data } = await api.spreadsheets.get({
        spreadsheetId: id,
        ranges,
        fields:
          "sheets(properties(title,hidden),data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue))))",
      });
      for (const sheet of data.sheets || []) {
        const cells = Array.from({ length: 80 }, () =>
          Array<string>(8).fill(""),
        );
        const formulaCells: string[] = [];
        for (const block of sheet.data || [])
          for (const [r, row] of (block.rowData || []).entries())
            for (const [c, entry] of (row.values || []).entries()) {
              const ri = (block.startRow || 0) + r,
                ci = (block.startColumn || 0) + c;
              if (ri >= 80 || ci >= 8) continue;
              cells[ri][ci] = entry.formattedValue || "";
              if (entry.userEnteredValue?.formulaValue)
                formulaCells.push(`${String.fromCharCode(65 + ci)}${ri + 1}`);
            }
        tabs.push({
          name: sheet.properties!.title!,
          cells,
          formulaCells,
          hidden: !!sheet.properties?.hidden,
        });
      }
    }
  } else throw new Error("Google Sheets와 XLSX 보고서를 지원합니다.");
  await ws.expect(id, file.version);
  return { id, name: file.name, version: file.version, tabs };
}
