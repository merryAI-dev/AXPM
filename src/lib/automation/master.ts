import { z } from "zod";
import { digest } from "./blueprint";
import { productConfig } from "../product-config";

export const MASTER = {
  get spreadsheetId() {
    return productConfig().masterSpreadsheetId;
  },
  get sheetId() {
    return productConfig().masterSheetId;
  },
  get title() {
    return productConfig().masterSheetTitle;
  },
  get rootId() {
    return productConfig().driveRootId;
  },
  get dashboardRange() {
    return productConfig().masterDashboardRange;
  },
};
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "YYYY-MM-DD 실제 날짜가 필요합니다.",
  );
export const masterEventSchema = z
  .object({
    eventId: z.string().regex(/^[\w가-힣-]{1,150}$/),
    company: z.string().trim().min(1).max(200),
    campus: z.string().trim().min(1).max(40),
    mentor: z.string().trim().min(1).max(100),
    kind: z.enum(["전담", "특화"]),
    round: z.number().int().min(1).max(4),
    completedOn: date,
    reportWrittenOn: date.optional(),
    notes: z.string().trim().max(3000).optional(),
    evidence: z.string().trim().min(5).max(4000),
  })
  .refine(
    (e) => e.kind !== "특화" || (e.round === 1 && !e.notes),
    "특화는 완료 여부 한 칸만 관리합니다. round=1로 지정하고 메모는 근거에 포함해주세요.",
  );
export const masterRequestSchema = z.object({
  event: masterEventSchema,
  mode: z.enum(["preview", "apply"]).default("preview"),
  expectedPlan: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type MasterEvent = z.infer<typeof masterEventSchema>;
export type MasterCell = {
  value: string | number | boolean | null;
  formula?: string;
  checkbox?: boolean;
  merged?: boolean;
  numberFormat?: { type?: string | null; pattern?: string | null };
};
export type MasterGrid = { rows: MasterCell[][]; version: string };
export const normalizeCampus = (s: string) =>
  s
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "")
    .replace(/캠퍼스$/, "");
const exact = (s: unknown) =>
  String(s ?? "")
    .normalize("NFC")
    .trim();
export function verifyMaster(grid: MasterGrid) {
  const headers: Record<number, string> = {
    2: "회사명",
    6: "소속",
    7: "담당멘토",
    13: "총 진행 멘토링회차",
    14: "1회차",
    15: "보고서작성",
    16: "1회차 진행 후 특이사항",
    17: "2회차",
    18: "보고서작성",
    19: "2회차 진행 후 특이사항",
    20: "3회차",
    21: "보고서작성",
    22: "3회차 진행 후 특이사항",
    23: "4회차",
    24: "보고서작성",
    25: "4회차 진행 후 특이사항",
    26: "전문특화멘토링 완료여부",
    27: "보고서작성",
  };
  for (const [column, header] of Object.entries(headers)) {
    if (
      exact(grid.rows[4]?.[Number(column)]?.value).replace(/\s/g, "") !==
      header.replace(/\s/g, "")
    )
      throw new Error(
        `마스터 ${Number(column) + 1}열 양식이 변경되었습니다. 매핑 확인이 필요합니다.`,
      );
  }
}
export function planMaster(grid: MasterGrid, raw: MasterEvent) {
  const event = masterEventSchema.parse(raw);
  verifyMaster(grid);
  const matches = grid.rows.flatMap((row, index) =>
    index >= 5 &&
    exact(row[2]?.value) === exact(event.company) &&
    normalizeCampus(exact(row[6]?.value)) === normalizeCampus(event.campus)
      ? [{ row, index }]
      : [],
  );
  if (matches.length !== 1)
    throw new Error(
      "기업명·캠퍼스로 마스터 한 행을 특정할 수 없습니다. 중복 또는 미등록 기업을 확인해주세요.",
    );
  const { row, index } = matches[0];
  if ([2, 6, 7].some((c) => row[c]?.merged))
    throw new Error(
      "기업 식별 셀이 병합되어 있습니다. 행 매핑을 확인해주세요.",
    );
  const mentorName = (value: unknown) =>
    exact(value)
      .replace(/\s*멘토(?:님)?$/, "")
      .trim();
  if (
    event.kind === "전담" &&
    mentorName(row[7]?.value) !== mentorName(event.mentor)
  )
    throw new Error("전담 멘토가 마스터와 일치하지 않습니다.");
  const completeCol = event.kind === "특화" ? 26 : 14 + (event.round - 1) * 3;
  const changes: {
    cell: string;
    column: number;
    before: MasterCell;
    after: string | number | boolean;
    numberFormat?: { type: "DATE"; pattern: string };
  }[] = [];
  function put(
    column: number,
    after: string | number | boolean,
    dateCell = false,
  ) {
    const before = row[column] || { value: null };
    const cell = `${column < 26 ? String.fromCharCode(65 + column) : `A${String.fromCharCode(65 + column - 26)}`}${index + 1}`;
    if (before.formula || before.merged)
      throw new Error(`${cell}: 수식·병합 셀은 자동 변경할 수 없습니다.`);
    if (typeof after === "boolean" && !before.checkbox)
      throw new Error(`${cell}: 체크박스 양식이 아닙니다.`);
    const numberFormat =
      dateCell &&
      !["DATE", "DATE_TIME"].includes(before.numberFormat?.type || "")
        ? { type: "DATE" as const, pattern: "m/d" }
        : undefined;
    if (before.value === after && !numberFormat) return;
    if (
      before.value !== after &&
      before.value !== null &&
      before.value !== "" &&
      !(after === true && before.value === false)
    )
      throw new Error(
        `${cell}: 기존 기록과 다릅니다. 자동 덮어쓰기를 중단했습니다.`,
      );
    changes.push({
      cell,
      column,
      before,
      after,
      ...(numberFormat ? { numberFormat } : {}),
    });
  }
  put(completeCol, true);
  if (event.reportWrittenOn)
    put(
      completeCol + 1,
      (Date.parse(event.reportWrittenOn) - Date.UTC(1899, 11, 30)) / 86400000,
      true,
    );
  if (event.kind === "전담" && event.notes) put(completeCol + 2, event.notes);
  const plan = {
    target: MASTER,
    event,
    row: index + 1,
    version: grid.version,
    changes,
  };
  return { ...plan, planHash: digest(plan) };
}

export function planMasterReversal(
  grid: MasterGrid,
  original: {
    row: number;
    changes: {
      cell: string;
      column: number;
      before: MasterCell;
      after: string | number | boolean;
    }[];
  },
) {
  verifyMaster(grid);
  if (!Number.isInteger(original.row) || original.row < 6)
    throw new Error("기존 반영 행을 확인할 수 없습니다.");
  const row = grid.rows[original.row - 1];
  if (!row) throw new Error("기존 반영 행이 마스터에 없습니다.");
  const changes = original.changes.map((change) => {
    const current = row[change.column] || { value: null };
    if (current.formula || current.merged)
      throw new Error(`${change.cell}: 수식·병합 셀은 자동 취소할 수 없습니다.`);
    if (current.value !== change.after)
      throw new Error(
        `${change.cell}: 자동 반영 후 값이 변경되어 취소를 중단했습니다.`,
      );
    if (
      change.before.value !== null &&
      change.before.value !== "" &&
      change.before.value !== false
    )
      throw new Error(
        `${change.cell}: 자동 반영 전 기존 값이 있어 취소할 수 없습니다.`,
      );
    return {
      cell: change.cell,
      column: change.column,
      before: current,
      after: change.before.value,
    };
  });
  const plan = {
    target: MASTER,
    row: original.row,
    version: grid.version,
    changes,
  };
  return { ...plan, planHash: digest(plan) };
}
export function masterOverview(grid: MasterGrid, campus?: string) {
  verifyMaster(grid);
  const companies = grid.rows.flatMap((r, i) =>
    i >= 5 &&
    exact(r[2]?.value) &&
    (!campus || normalizeCampus(exact(r[6]?.value)) === normalizeCampus(campus))
      ? [
          {
            row: i + 1,
            company: exact(r[2]?.value),
            campus: exact(r[6]?.value),
            mentor: exact(r[7]?.value),
            completedRounds: [14, 17, 20, 23].flatMap((c, index) =>
              r[c]?.value === true ? [index + 1] : [],
            ),
            missingReportRounds: [14, 17, 20, 23].flatMap((c, index) =>
              r[c]?.value === true &&
              (r[c + 1]?.value == null || r[c + 1]?.value === "")
                ? [index + 1]
                : [],
            ),
            unformattedReportRounds: [14, 17, 20, 23].flatMap((c, index) =>
              r[c]?.value === true &&
              typeof r[c + 1]?.value === "number" &&
              !["DATE", "DATE_TIME"].includes(
                r[c + 1]?.numberFormat?.type || "",
              )
                ? [index + 1]
                : [],
            ),
            specialtyComplete: r[26]?.value === true,
            missingReports: [14, 17, 20, 23, 26].filter(
              (c) =>
                r[c]?.value === true &&
                (r[c + 1]?.value == null || r[c + 1]?.value === ""),
            ).length,
          },
        ]
      : [],
  );
  return {
    target: MASTER,
    checkedAt: new Date().toISOString(),
    companies,
    totals: {
      companies: companies.length,
      dedicated: companies.reduce((n, c) => n + c.completedRounds.length, 0),
      specialty: companies.filter((c) => c.specialtyComplete).length,
      missingReports: companies.reduce((n, c) => n + c.missingReports, 0),
    },
  };
}

type Receipt = {
  metadataKey?: string | null;
  metadataValue?: string | null;
  location?: { sheetId?: number | null } | null;
};
export function hasMasterReceipt(
  data: {
    developerMetadata?: Receipt[] | null;
    sheets?: { developerMetadata?: Receipt[] | null }[] | null;
  },
  marker: string,
) {
  return [
    ...(data.developerMetadata || []),
    ...(data.sheets || []).flatMap((s) => s.developerMetadata || []),
  ].some(
    (m) =>
      m.metadataKey === "axpm.master.event" &&
      m.metadataValue === marker &&
      m.location?.sheetId === MASTER.sheetId,
  );
}
