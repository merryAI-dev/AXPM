// Real browser/API/storage verification. Optional --template uses a private XLSX copy.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import JSZip from "jszip";
import { getAuth } from "firebase-admin/auth";
import { db, isEmulator, storage, userDoc } from "../src/lib/firebase";
import { fixture } from "../tests/fixtures/workspace";
process.loadEnvFile(".env.local");
if (!isEmulator()) throw new Error("Only run against Firebase emulators.");
db();
const user = await getAuth().getUserByEmail("operator@axpm.test");
const template = process.argv.indexOf("--template");
const bytes =
  template >= 0
    ? await readFile(resolve(process.argv[template + 1]))
    : await fixture();
const folder = resolve("private/validation/document-viewer");
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
let id = "";
try {
  await page.goto(process.env.APP_ORIGIN!);
  await page.getByRole("button", { name: /로컬.*시작|로컬.*로그인/ }).click();
  await page.getByText("업로드한 엑셀 편집", { exact: true }).waitFor();
  const uploaded = page.waitForResponse((r) =>
    r.url().endsWith("/api/workbooks/upload"),
  );
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "문서 뷰어 검증.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: bytes,
  });
  const response = await uploaded;
  assert.equal(response.status(), 200);
  id = (await response.json()).id;
  await page.locator('[data-cell="C3"]').waitFor({ timeout: 30000 });
  assert.equal(
    await page
      .locator(".documentCell")
      .evaluateAll((cells) =>
        cells.every(
          (cell) =>
            Math.abs(
              parseFloat(getComputedStyle(cell).height) -
                parseFloat((cell as HTMLElement).style.height),
            ) < 0.1,
        ),
      ),
    true,
    "Global button styles must not override worksheet row geometry",
  );
  assert.equal(
    await page.locator(".documentMapping").getAttribute("open"),
    null,
  );
  await page.locator(".documentViewer").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(folder, "report.png") });
  for (const image of await page.locator(".documentImage").all())
    assert.equal(
      await image.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
      true,
    );
  await page.getByRole("button", { name: "전체 화면", exact: true }).click();
  await page.locator('[data-cell="B11"]').click();
  const value =
    "합성 검증: 셀 편집과 원본 다운로드 보존\n둘째 줄도 유지합니다.";
  await page
    .getByRole("textbox", { name: "내용 수정", exact: true })
    .fill(value);
  assert.equal(await page.locator('[data-cell="B11"]').innerText(), value);
  await page.screenshot({ path: resolve(folder, "editing.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".documentFullscreen").count(), 0);
  // A changed sheet must not silently discard this draft.
  if (
    (await page.locator('select[aria-label="보고서 시트"] option').count()) > 1
  ) {
    const current = await page
      .getByLabel("보고서 시트", { exact: true })
      .inputValue();
    page.once("dialog", (d) => d.dismiss());
    await page
      .getByLabel("보고서 시트", { exact: true })
      .selectOption({ index: 1 });
    assert.equal(
      await page.getByLabel("보고서 시트", { exact: true }).inputValue(),
      current,
    );
  }
  await page
    .getByRole("button", { name: "변경 1개 확인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "확인한 셀 저장", exact: true })
    .click();
  await page
    .getByText("셀 저장과 생성 파일 검증을 마쳤습니다. 다운로드할 수 있어요.", {
      exact: true,
    })
    .waitFor();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "저장된 XLSX 다운로드", exact: true })
    .click();
  const download = await pending;
  const output = resolve(folder, "edited.xlsx");
  await download.saveAs(output);
  const [a, b] = await Promise.all([
    JSZip.loadAsync(bytes),
    JSZip.loadAsync(await readFile(output)),
  ]);
  assert.deepEqual(Object.keys(a.files).sort(), Object.keys(b.files).sort());
  const changed = [];
  for (const name of Object.keys(a.files))
    if (
      !a.files[name].dir &&
      !Buffer.from(await a.files[name].async("nodebuffer")).equals(
        await b.files[name].async("nodebuffer"),
      )
    )
      changed.push(name);
  assert.equal(changed.length, 1);
  assert.match(changed[0], /^xl\/worksheets\/sheet\d+\.xml$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".documentViewer").scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: resolve(folder, "mobile.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: automatic document rendering, images, cell edit, fullscreen, unsaved sheet guard, save/download, original ZIP preservation, mobile viewport.",
  );
} finally {
  await browser.close();
  if (id) {
    await storage().deleteFiles({
      prefix: `users/${user.uid}/workbooks/${id}/`,
    });
    await db().recursiveDelete(
      userDoc(user.uid).collection("workbooks").doc(id),
    );
  }
}
