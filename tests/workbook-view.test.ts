import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { readWorkbook, editWorkbook } from "../src/lib/workspace/workbook";
import { nativeSheetView } from "../src/lib/workspace/native-sheet-view";
const mapping = [{ key: "company", label: "기업명", cell: "B2" }];
async function document() {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("보고서");
  s.getColumn(1).width = 4;
  s.getColumn(2).width = 24;
  s.getColumn(3).width = 12;
  s.getRow(2).height = 60;
  s.mergeCells("B2:C3");
  s.getCell("B2").value = "합성기업";
  s.getCell("B2").font = { bold: true, size: 14, color: { argb: "FF123456" } };
  s.getCell("B2").alignment = { wrapText: true, vertical: "middle" };
  s.getCell("B2").border = {
    top: { style: "thin" },
    bottom: { style: "double" },
  };
  s.getRow(1000).height = 20; // A styled blank tail must not create 1,000 viewport rows.
  const image = w.addImage({
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7VIAAAAASUVORK5CYII=",
    extension: "png",
  });
  s.addImage(image, { tl: { col: 1, row: 3 }, ext: { width: 80, height: 40 } });
  return Buffer.from(await w.xlsx.writeBuffer());
}
test("viewer reads source geometry, merged anchors, styles and embedded images without blank tails", async () => {
  const result = await readWorkbook(
    await document(),
    { sheet: "보고서", mapping },
    true,
  );
  const v = result.view!,
    cell = v.cells.find((c) => c.address === "B2")!;
  assert.equal(cell.colSpan, 2);
  assert.equal(cell.rowSpan, 2);
  assert.equal(cell.height, 100);
  assert.equal(cell.width, 24 * 7 + 5 + (12 * 7 + 5));
  assert.equal(cell.style.fontWeight, 700);
  assert.equal(cell.style.color, "#123456");
  assert.match(cell.style.borderBottom!, /double/);
  assert.equal(
    v.cells.some((c) => c.address === "C2"),
    false,
  );
  assert.equal(v.images.length, 1);
  assert.match(v.images[0].src, /^data:image\/png;base64,/);
  assert.equal(v.images[0].width, 80);
  assert.ok(v.rows.length < 10);
  assert.equal(v.focus.x, 33);
  assert.ok(v.focus.height >= v.images[0].y + 40);
});
test("saving a rendered mapped value keeps geometry and images; agent reads omit heavy preview", async () => {
  const b = await document(),
    before = { company: "합성기업" },
    after = { company: "수정 기업\n둘째 줄" };
  const output = await editWorkbook(b, "보고서", mapping, before, after);
  const [old, next, agent] = await Promise.all([
    readWorkbook(b, { sheet: "보고서", mapping }, true),
    readWorkbook(output, { sheet: "보고서", mapping }, true),
    readWorkbook(output, { sheet: "보고서", mapping }),
  ]);
  assert.equal(
    next.view!.cells.find((c) => c.address === "B2")!.text,
    after.company,
  );
  assert.deepEqual(next.view!.images, old.view!.images);
  assert.deepEqual(next.view!.focus, old.view!.focus);
  assert.equal(agent.view, undefined);
});
test("native Sheets renders formatted values, merges, dimensions and formula protection", () => {
  const result = nativeSheetView(
    {
      sheets: [
        {
          properties: {
            title: "보고/서",
            gridProperties: { rowCount: 20, columnCount: 5 },
          },
          merges: [
            {
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 2,
            },
          ],
          data: [
            {
              columnMetadata: [{ pixelSize: 110 }, { pixelSize: 90 }],
              rowMetadata: [{ pixelSize: 48 }],
              rowData: [
                {
                  values: [
                    {
                      formattedValue: "₩1,000",
                      userEnteredValue: { formulaValue: "=500*2" },
                      effectiveFormat: {
                        textFormat: { bold: true },
                        horizontalAlignment: "RIGHT",
                        backgroundColor: { red: 1, green: 0.5 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    "보고/서",
    [{ key: "value", label: "금액", cell: "A1" }],
  );
  const cell = result.cells.find((c) => c.address === "A1")!;
  assert.equal(result.sheet, "보고/서");
  assert.equal(cell.width, 200);
  assert.equal(cell.height, 48);
  assert.equal(cell.text, "₩1,000");
  assert.equal(cell.formula, true);
  assert.equal(cell.style.backgroundColor, "#ff8000");
});
