import { chromium } from "@playwright/test";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { userDoc, storage, db } from "../src/lib/firebase";
process.loadEnvFile(".env.local");
let uploadedId = "",
  ownerId = "";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 1080 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("private/validation", { recursive: true });
try {
  await page.goto(process.env.APP_ORIGIN || "http://localhost:3000");
  const stateResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/state") && r.status() === 200,
  );
  await page.getByRole("button", { name: /로컬 검증 계정/ }).click();
  ownerId = (await (await stateResponse).json()).uid;
  await page.getByRole("heading", { name: "관리할 폴더" }).waitFor();
  await page.screenshot({
    path: "private/validation/workspace-desktop.png",
    fullPage: true,
  });
  const filename = (await readdir(join(homedir(), "Downloads"))).find(
    (n) => n.normalize("NFC") === "멘토링 보고서 .xlsx",
  );
  assert.ok(filename, "Provided source report template must exist");
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith("/api/workbooks/upload") && r.status() === 200,
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles(join(join(homedir(), "Downloads"), filename));
  uploadedId = (await (await uploaded).json()).id;
  await page.getByRole("heading", { name: "1. 시트와 셀 지정" }).waitFor();
  await page.getByRole("button", { name: "지정한 셀 읽기" }).click();
  await page.getByRole("button", { name: /변경 0개 확인/ }).waitFor();
  const areas = page.locator(".editorFields textarea");
  assert.equal(await areas.count(), 9);
  await areas
    .nth(7)
    .fill("브라우저 검증용 합성 메모입니다. 실제 멘토링 기록이 아닙니다.");
  await page.getByRole("button", { name: "변경 1개 확인" }).click();
  await page.getByRole("button", { name: "확인한 셀 저장" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "셀 저장과 생성 파일 검증" })
    .waitFor();
  const fileDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "저장된 XLSX 다운로드" }).click();
  await (
    await fileDownload
  ).saveAs("private/validation/workspace-edited-report.xlsx");
  await page.screenshot({
    path: "private/validation/workspace-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "← 파일 목록" }).click();
  await page.getByRole("button", { name: /작업 센터/ }).click();
  await page.getByRole("heading", { name: /결과까지 확인하세요/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /파일 · 보고서 편집/ }).click();
  await page.getByRole("heading", { name: "관리할 폴더" }).waitFor();
  await page.screenshot({
    path: "private/validation/workspace-mobile.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real supplied XLSX template upload, nine-cell editor, synthetic note save/download, job center navigation, mobile overflow, no browser exceptions. Saved files stay private.",
  );
} finally {
  await browser.close();
  if (uploadedId && ownerId) {
    await storage().deleteFiles({
      prefix: `users/${ownerId}/workbooks/${uploadedId}/`,
    });
    await db().recursiveDelete(
      userDoc(ownerId).collection("workbooks").doc(uploadedId),
    );
  }
}
