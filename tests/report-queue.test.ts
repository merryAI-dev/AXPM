import test from "node:test";
import assert from "node:assert/strict";
import { fileSchema } from "../src/lib/workspace/schema";
import {
  reportQueue,
  reportRetryDelay,
  type ReportCheckpoint,
} from "../src/lib/automation/report-queue";
const now = Date.parse("2026-09-17T02:00:00Z");
const file = (
  id: string,
  version = "1",
  modifiedTime = "2026-08-01T00:00:00Z",
) =>
  fileSchema.parse({
    id,
    version,
    modifiedTime,
    name: id,
    mimeType: "application/vnd.google-apps.spreadsheet",
  });
const checkpoint = (
  extra: Partial<ReportCheckpoint> = {},
): ReportCheckpoint => ({
  version: "1",
  configHash: "cfg",
  checkedAt: now - 180_000,
  revisit: false,
  ...extra,
});
test("unchanged completed reports are skipped, edited versions are read immediately", () => {
  const files = [file("unchanged"), file("changed", "2")];
  const saved = new Map(files.map((f) => [f.id, checkpoint()]));
  assert.deepEqual(
    reportQueue(files, saved, "cfg", 120, now).map((f) => f.id),
    ["changed"],
  );
});
test("newly edited files are ahead of historical discovery and due stability reads", () => {
  const files = [
    file("history"),
    file("settling"),
    file("new-report", "1", new Date(now - 60_000).toISOString()),
  ];
  const saved = new Map([["settling", checkpoint({ revisit: true })]]);
  assert.deepEqual(
    reportQueue(files, saved, "cfg", 120, now).map((f) => f.id),
    ["new-report", "settling", "history"],
  );
});
test("stability and retry deadlines persist across runs; a new version bypasses backoff", () => {
  const saved = new Map([
    ["report", checkpoint({ revisit: true, retryAt: now + 60_000 })],
  ]);
  assert.equal(reportQueue([file("report")], saved, "cfg", 120, now).length, 0);
  assert.equal(
    reportQueue([file("report")], saved, "cfg", 120, now + 60_000).length,
    1,
  );
  assert.equal(
    reportQueue([file("report", "2")], saved, "cfg", 120, now).length,
    1,
  );
});
test("configuration changes and six-hour reconciliation invalidate skip decisions", () => {
  const saved = new Map([["report", checkpoint()]]);
  assert.equal(
    reportQueue([file("report")], saved, "new-cfg", 120, now).length,
    1,
  );
  assert.equal(
    reportQueue([file("report")], saved, "cfg", 120, now + 6 * 60 * 60_000)
      .length,
    1,
  );
});
test("failed reads back off with a bounded delay", () => {
  assert.deepEqual(
    [1, 2, 3, 10].map(reportRetryDelay),
    [60_000, 120_000, 240_000, 900_000],
  );
});
