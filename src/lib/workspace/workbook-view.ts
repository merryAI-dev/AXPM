import ExcelJS from "exceljs";
import { columnName, type SheetView, type ViewStyle } from "./sheet-view";
import type { Mapping } from "./schema";
const MAX_ROWS = 500,
  MAX_COLS = 60;
function colour(
  c?: Partial<ExcelJS.Color> & { indexed?: number },
): string | undefined {
  if (c?.argb && /^[\da-f]{8}$/i.test(c.argb)) return `#${c.argb.slice(2)}`;
  const theme = [
    "FFFFFF",
    "000000",
    "E7E6E6",
    "44546A",
    "4472C4",
    "ED7D31",
    "A5A5A5",
    "FFC000",
    "5B9BD5",
    "70AD47",
  ];
  if (c?.theme !== undefined && theme[c.theme]) return `#${theme[c.theme]}`;
  if (c?.indexed === 64 || c?.indexed === 8) return "#000000";
  if (c?.indexed === 9) return "#FFFFFF";
}
function font(f: Partial<ExcelJS.Font> = {}): ViewStyle {
  return {
    fontFamily: f.name,
    fontSize: ((f.size || 11) * 96) / 72,
    fontWeight: f.bold ? 700 : 400,
    ...(f.italic ? { fontStyle: "italic" as const } : {}),
    color: colour(f.color),
    textDecoration:
      [f.underline ? "underline" : "", f.strike ? "line-through" : ""]
        .filter(Boolean)
        .join(" ") || undefined,
  };
}
function border(b?: Partial<ExcelJS.Border>) {
  if (!b?.style) return undefined;
  const width =
    b.style === "double"
      ? 3
      : b.style === "thick"
        ? 3
        : b.style.startsWith("medium")
          ? 2
          : 1;
  const line =
    b.style === "double"
      ? "double"
      : b.style.toLowerCase().includes("dash")
        ? "dashed"
        : b.style === "dotted"
          ? "dotted"
          : "solid";
  return `${width}px ${line} ${colour(b.color) || "#000000"}`;
}
export function workbookView(
  w: ExcelJS.Workbook,
  sheet: string,
  mapping: Mapping,
): SheetView {
  const s = w.getWorksheet(sheet);
  if (!s) throw new Error("시트를 찾을 수 없습니다.");
  let lastRow = 1,
    lastCol = 1;
  s.eachRow((row) =>
    row.eachCell((c) => {
      if (c.value !== null) {
        lastRow = Math.max(lastRow, Number(c.row));
        lastCol = Math.max(lastCol, Number(c.col));
      }
    }),
  );
  for (const f of mapping) {
    const c = s.getCell(f.cell);
    lastRow = Math.max(lastRow, Number(c.row));
    lastCol = Math.max(lastCol, Number(c.col));
  }
  const merges = (s.model.merges || []).map((ref) => {
    const [a, b = a] = ref.split(":");
    const start = s.getCell(a),
      end = s.getCell(b);
    return {
      top: Number(start.row),
      left: Number(start.col),
      bottom: Number(end.row),
      right: Number(end.col),
    };
  });
  for (const m of merges) {
    if (m.top <= lastRow && m.left <= lastCol) {
      lastRow = Math.max(lastRow, m.bottom);
      lastCol = Math.max(lastCol, m.right);
    }
  }
  const warnings: string[] = [];
  if (lastRow > MAX_ROWS || lastCol > MAX_COLS)
    warnings.push(
      `미리보기는 첫 ${MAX_ROWS}행·${MAX_COLS}열까지 표시합니다. 원본 다운로드에는 전체가 포함됩니다.`,
    );
  lastRow = Math.min(lastRow, MAX_ROWS);
  lastCol = Math.min(lastCol, MAX_COLS);
  const colWidths = Array.from({ length: MAX_COLS }, (_, i) =>
    s.getColumn(i + 1).hidden
      ? 0
      : Math.round(
          (s.getColumn(i + 1).width ?? s.properties.defaultColWidth ?? 8.43) *
            7 +
            5,
        ),
  );
  const rowHeights = Array.from({ length: MAX_ROWS }, (_, i) =>
    s.getRow(i + 1).hidden
      ? 0
      : ((s.getRow(i + 1).height ?? s.properties.defaultRowHeight ?? 15) * 96) /
        72,
  );
  const offsets = (values: number[]) => {
    const out = [0];
    for (const v of values) out.push(out.at(-1)! + v);
    return out;
  };
  const xs = offsets(colWidths),
    ys = offsets(rowHeights);
  const view: SheetView = {
    sheet,
    width: xs[lastCol],
    height: ys[lastRow],
    columns: [],
    rows: [],
    cells: [],
    images: [],
    focus: { x: 0, y: 0, width: xs[lastCol], height: ys[lastRow] },
    warnings,
  };
  for (let r = 1; r <= lastRow; r++)
    for (let c = 1; c <= lastCol; c++) {
      const cell = s.getCell(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const m = merges.find((m) => m.top === r && m.left === c);
      const bottom = Math.min(m?.bottom || r, MAX_ROWS),
        right = Math.min(m?.right || c, MAX_COLS);
      const b = cell.border || {},
        a = cell.alignment || {};
      const fill = cell.fill;
      const numeric = typeof cell.value === "number";
      const style: ViewStyle = {
        ...font(cell.font),
        backgroundColor:
          fill?.type === "pattern" && fill.pattern !== "none"
            ? colour(fill.fgColor)
            : undefined,
        textAlign:
          a.horizontal === "center" || a.horizontal === "centerContinuous"
            ? "center"
            : a.horizontal === "right"
              ? "right"
              : a.horizontal === "justify"
                ? "justify"
                : numeric
                  ? "right"
                  : "left",
        verticalAlign:
          a.vertical === "middle"
            ? "middle"
            : a.vertical === "top"
              ? "top"
              : "bottom",
        whiteSpace: a.wrapText ? "pre-wrap" : "pre",
        borderTop: border(b.top),
        borderLeft: border(b.left),
        borderBottom: border(s.getCell(bottom, c).border?.bottom || b.bottom),
        borderRight: border(s.getCell(r, right).border?.right || b.right),
      };
      view.cells.push({
        address: cell.address,
        row: r,
        column: c,
        rowSpan: bottom - r + 1,
        colSpan: right - c + 1,
        x: xs[c - 1],
        y: ys[r - 1],
        width: xs[right] - xs[c - 1],
        height: ys[bottom] - ys[r - 1],
        text: cell.text,
        style,
        formula: cell.type === ExcelJS.ValueType.Formula,
        ...(cell.type === ExcelJS.ValueType.RichText
          ? {
              runs: (cell.value as ExcelJS.CellRichTextValue).richText.map(
                (run) => ({
                  text: run.text,
                  style: font({ ...cell.font, ...run.font }),
                }),
              ),
            }
          : {}),
      });
    }
  let imageBytes = 0;
  for (const image of s.getImages()) {
    const media = w.getImage(Number(image.imageId));
    if (!media?.buffer || !["png", "jpeg", "gif"].includes(media.extension)) {
      warnings.push("일부 그림 형식은 미리보기에서 지원하지 않습니다.");
      continue;
    }
    imageBytes += media.buffer.byteLength;
    if (imageBytes > 8_000_000) {
      warnings.push("그림 미리보기 용량을 초과했습니다.");
      break;
    }
    type Anchor = {
      nativeCol: number;
      nativeRow: number;
      nativeColOff: number;
      nativeRowOff: number;
    };
    const range = image.range as unknown as {
      tl: Anchor;
      br?: Anchor;
      ext?: { width: number; height: number };
    };
    const point = (a: Anchor) => ({
      x: (xs[Math.min(a.nativeCol, MAX_COLS)] || 0) + a.nativeColOff / 9525,
      y: (ys[Math.min(a.nativeRow, MAX_ROWS)] || 0) + a.nativeRowOff / 9525,
    });
    const tl = point(range.tl),
      br = range.br ? point(range.br) : null;
    const width = range.ext?.width ?? (br ? br.x - tl.x : 0),
      height = range.ext?.height ?? (br ? br.y - tl.y : 0);
    if (width <= 0 || height <= 0) continue;
    view.images.push({
      src: `data:image/${media.extension};base64,${Buffer.from(media.buffer).toString("base64")}`,
      ...tl,
      width,
      height,
    });
    view.width = Math.min(xs[MAX_COLS], Math.max(view.width, tl.x + width));
    view.height = Math.min(ys[MAX_ROWS], Math.max(view.height, tl.y + height));
  }
  view.columns = colWidths
    .map((width, i) => ({ label: columnName(i + 1), x: xs[i], width }))
    .filter((c) => c.x < view.width);
  view.rows = rowHeights
    .map((height, i) => ({ number: i + 1, y: ys[i], height }))
    .filter((r) => r.y < view.height);
  const mapped = mapping.map((f) => s.getCell(f.cell));
  if (mapped.length) {
    let left = Math.min(...mapped.map((c) => Number(c.col))),
      right = Math.max(...mapped.map((c) => Number(c.col)));
    for (const m of merges)
      if (
        mapped.some(
          (c) =>
            Number(c.row) >= m.top &&
            Number(c.row) <= m.bottom &&
            Number(c.col) >= m.left &&
            Number(c.col) <= m.right,
        )
      ) {
        left = Math.min(left, m.left);
        right = Math.max(right, m.right);
      }
    if (left <= MAX_COLS && right <= MAX_COLS) {
      let bottom = Math.min(
        MAX_ROWS,
        Math.max(...mapped.map((c) => Number(c.row))),
      );
      for (const c of view.cells)
        if (
          c.column >= left &&
          c.column <= right &&
          (c.text || c.style.borderBottom)
        )
          bottom = Math.max(bottom, Math.min(MAX_ROWS, c.row + c.rowSpan - 1));
      let height = ys[bottom];
      for (const i of view.images)
        if (i.x >= xs[left - 1] && i.x < xs[right])
          height = Math.max(height, i.y + i.height);
      view.focus = {
        x: xs[left - 1],
        y: 0,
        width: xs[right] - xs[left - 1],
        height,
      };
    }
  }
  return view;
}
