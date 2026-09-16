import ExcelJS from "exceljs";
import type { sheets_v4 } from "googleapis";
import type { Mapping } from "./schema";
import { workbookView } from "./workbook-view";
export function nativeSheetView(
  data: sheets_v4.Schema$Spreadsheet,
  title: string,
  mapping: Mapping,
) {
  const source = data.sheets?.find((s) => s.properties?.title === title);
  if (!source) throw new Error("시트를 찾을 수 없습니다.");
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("preview");
  const rgb = (c?: sheets_v4.Schema$Color | null) =>
    c
      ? {
          argb:
            "FF" +
            [c.red, c.green, c.blue]
              .map((n) =>
                Math.round((n || 0) * 255)
                  .toString(16)
                  .padStart(2, "0"),
              )
              .join(""),
        }
      : undefined;
  const colors = new Map(
    (data.properties?.spreadsheetTheme?.themeColors || []).map((c) => [
      c.colorType,
      c.color,
    ]),
  );
  const color = (
    style?: sheets_v4.Schema$ColorStyle | null,
    fallback?: sheets_v4.Schema$Color | null,
  ) =>
    rgb(style?.rgbColor || colors.get(style?.themeColor)?.rgbColor || fallback);
  for (const grid of source.data || []) {
    const ro = grid.startRow || 0,
      co = grid.startColumn || 0;
    grid.rowMetadata?.forEach((m, i) => {
      const r = s.getRow(ro + i + 1);
      r.height = ((m.pixelSize || 20) * 72) / 96;
      r.hidden = !!(m.hiddenByUser || m.hiddenByFilter);
    });
    grid.columnMetadata?.forEach((m, i) => {
      const c = s.getColumn(co + i + 1);
      c.width = ((m.pixelSize || 100) - 5) / 7;
      c.hidden = !!(m.hiddenByUser || m.hiddenByFilter);
    });
    grid.rowData?.forEach((row, r) =>
      row.values?.forEach((v, c) => {
        const cell = s.getCell(ro + r + 1, co + c + 1),
          f = v.effectiveFormat,
          t = f?.textFormat;
        cell.value =
          v.formattedValue ??
          v.effectiveValue?.stringValue ??
          v.effectiveValue?.numberValue ??
          "";
        // Empty cells with styles must not inflate the used region.
        if (cell.value === "") cell.value = null;
        if (v.userEnteredValue?.formulaValue)
          cell.value = {
            formula: v.userEnteredValue.formulaValue.slice(1),
            result: v.formattedValue || "",
          };
        cell.font = {
          name: t?.fontFamily || "Arial",
          size: t?.fontSize || 10,
          bold: !!t?.bold,
          italic: !!t?.italic,
          underline: !!t?.underline,
          strike: !!t?.strikethrough,
          color: color(t?.foregroundColorStyle, t?.foregroundColor),
        };
        const background = color(f?.backgroundColorStyle, f?.backgroundColor);
        if (background)
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: background,
          };
        cell.alignment = {
          horizontal:
            ({ CENTER: "center", RIGHT: "right", LEFT: "left" } as const)[
              f?.horizontalAlignment as "CENTER"
            ] || "left",
          vertical:
            ({ TOP: "top", MIDDLE: "middle", BOTTOM: "bottom" } as const)[
              f?.verticalAlignment as "TOP"
            ] || "bottom",
          wrapText: f?.wrapStrategy === "WRAP",
        };
        for (const side of ["top", "bottom", "left", "right"] as const) {
          const b = f?.borders?.[side];
          const style = (
            {
              SOLID: "thin",
              SOLID_MEDIUM: "medium",
              SOLID_THICK: "thick",
              DASHED: "dashed",
              DOTTED: "dotted",
              DOUBLE: "double",
            } as const
          )[b?.style as "SOLID"];
          if (style)
            cell.border = {
              ...cell.border,
              [side]: { style, color: color(b?.colorStyle, b?.color) },
            };
        }
      }),
    );
  }
  for (const m of source.merges || [])
    if ((m.endRowIndex || 0) <= 500 && (m.endColumnIndex || 0) <= 60)
      s.mergeCells(
        (m.startRowIndex || 0) + 1,
        (m.startColumnIndex || 0) + 1,
        m.endRowIndex!,
        m.endColumnIndex!,
      );
  const result = workbookView(w, s.name, mapping);
  result.sheet = title;
  if (
    (source.properties?.gridProperties?.rowCount || 0) > 500 ||
    (source.properties?.gridProperties?.columnCount || 0) > 60
  )
    result.warnings.push("Google Sheets 미리보기는 첫 500행·60열을 읽습니다.");
  result.warnings.push(
    "Google Sheets의 차트·떠 있는 그림은 원본에서 확인할 수 있습니다.",
  );
  return result;
}
