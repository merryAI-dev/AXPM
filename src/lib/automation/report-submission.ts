import { z } from "zod";
import { digest } from "./blueprint";
import { masterEventSchema, normalizeCampus } from "./master";
import { idSchema } from "../workspace/schema";
import { productConfig } from "../product-config";
export const reportFolder = () => productConfig().reportFolderId;
export const reportWatchSchema = z.object({
  folderId: z
    .string()
    .trim()
    .transform((s) => s.match(/\/folders\/([\w-]+)/)?.[1] || s)
    .pipe(idSchema)
    .default(reportFolder),
  campus: z.string().trim().min(1).max(40).default("전체"),
  enabled: z.boolean().default(false),
  autoApply: z.boolean().default(false),
});
export type ReportWatchConfig = z.infer<typeof reportWatchSchema>;
export type ReportTab = {
  name: string;
  cells: string[][];
  formulaCells: string[];
  hidden?: boolean;
};
export type ReportSource = {
  id: string;
  name: string;
  version: string;
  tabs: ReportTab[];
};
const text = (s: unknown) =>
  String(s ?? "")
    .normalize("NFC")
    .trim();
const hasValue = (s: unknown) =>
  !/^(?:null|undefined|n\/a|[-–—]+)?$/i.test(text(s));
const extractDates = (s: string) =>
  [
    ...s.matchAll(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})(?:일)?/g),
  ].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
const validDate = (s: string) =>
  Boolean(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const cell = (tab: ReportTab, row: number, col: number) =>
  text(tab.cells[row - 1]?.[col - 1]);
export function parseSubmission(
  source: ReportSource,
  tab: ReportTab,
  config: ReportWatchConfig,
) {
  if (tab.hidden || !/^\s*[1-4]회차(?:\s|\(|\[|$)/.test(tab.name)) return null;
  const issues: string[] = [];
  const shifted =
    cell(tab, 3, 1) === "기업명" &&
    cell(tab, 4, 1) === "담당멘토" &&
    cell(tab, 4, 3) === "일시 및 장소" &&
    cell(tab, 6, 1) === "멘토링 주제";
  const value = (row: number, col: number) =>
    cell(tab, row, col - (shifted ? 1 : 0));
  const address = (row: number, col: number) =>
    `${String.fromCharCode(64 + col - (shifted ? 1 : 0))}${row}`;
  if (/초안|작성중|취소/.test(tab.name))
    issues.push("초안·작성중·취소 탭은 자동 반영하지 않습니다.");
  if (/샘플|양식|예시|템플릿/.test(source.name + tab.name))
    issues.push("샘플·양식 파일은 반영하지 않습니다.");
  const roundMatch = tab.name.match(/^\s*([1-4])회차(?:\s|\(|\[|$)/);
  if (!roundMatch) issues.push("탭 이름 앞에 1~4회차가 필요합니다.");
  if (
    value(3, 2) !== "기업명" ||
    value(4, 2) !== "담당멘토" ||
    value(4, 4) !== "일시 및 장소" ||
    value(6, 2) !== "멘토링 주제"
  )
    issues.push("보고서 기본 양식(C3·C4·E4·C6)을 확인해주세요.");
  const datePlace = value(4, 5);
  const dates = [
    ...datePlace.matchAll(
      /(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})(?:일)?/g,
    ),
  ].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  const completedOn = dates.length === 1 ? dates[0] : "";
  const tabDates = extractDates(tab.name);
  const tabDate = tabDates.length === 1 ? tabDates[0] : "";
  if (!validDate(tabDate))
    issues.push(
      "회차 탭 이름에 유효한 날짜 한 개가 필요합니다. 예: 4회차(2026.09.17)",
    );
  const writtenFields = tab.cells.flatMap((row, r) =>
    row.flatMap((v, c) =>
      /^(?:보고서\s*)?작성\s*일(?:자)?\s*[:：]?$/.test(text(v))
        ? [
            {
              address: `${String.fromCharCode(65 + c + 1)}${r + 1}`,
              value: text(row[c + 1]),
            },
          ]
        : [],
    ),
  );
  const writtenDates = writtenFields.flatMap((f) => extractDates(f.value));
  const reportWrittenOn = writtenFields.length
    ? writtenDates.length === 1
      ? writtenDates[0]
      : ""
    : tabDate;
  if (!validDate(reportWrittenOn))
    issues.push(
      "보고서 작성일을 확인해주세요. 작성일 필드가 있으면 유효한 날짜가 필요합니다.",
    );
  const writtenEvidence = writtenFields.length
    ? `작성일 ${writtenFields.map((f) => f.address).join(",")}`
    : "탭 날짜 (운영자 지정 작성일 기준)";
  if (
    !completedOn ||
    !Number.isFinite(Date.parse(completedOn)) ||
    new Date(completedOn).toISOString().slice(0, 10) !== completedOn
  )
    issues.push("E4에 실제 진행일 한 개가 필요합니다.");
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  if (reportWrittenOn > today || tabDate > today)
    issues.push("미래 작성일·탭 날짜는 완료로 반영하지 않습니다.");
  if (completedOn > today)
    issues.push("미래 진행일의 보고서는 아직 완료로 반영하지 않습니다.");
  const campuses = [...datePlace.matchAll(/([가-힣]+)\s*캠퍼스/g)].map((m) =>
    normalizeCampus(m[1]),
  );
  const campus =
    config.campus === "전체" && new Set(campuses).size === 1
      ? `${campuses[0]}캠퍼스`
      : config.campus;
  if (!campuses.length || campuses.some((c) => c !== normalizeCampus(campus)))
    issues.push("E4 진행 장소의 캠퍼스가 감시 설정과 일치해야 합니다.");
  const lines = tab.cells.map((row) =>
    row.map(text).filter(Boolean).join("\n"),
  );
  const start = lines.findIndex((s) =>
    /^(?:Section\s*2\s*[:：]|2[.)])\s*멘토링\s*내용/i.test(s),
  );
  const end = lines.findIndex(
    (s, i) =>
      i > start && /^(?:Section\s*3\s*[:：]|3[.)])\s*다음\s*멘토링/i.test(s),
  );
  const companyStart = lines.findIndex((s) =>
    /^(?:Section\s*1\s*[:：]|1[.)])\s*기업\s*현황/i.test(s),
  );
  const companyStatus =
    companyStart >= 0 && start > companyStart
      ? lines
          .slice(companyStart + 1, start)
          .filter(Boolean)
          .join("\n")
      : "";
  if (!hasValue(companyStatus)) issues.push("기업현황 본문이 필요합니다.");
  if (!hasValue(value(5, 3)) || value(5, 2) !== "참석자")
    issues.push("참석자(C5)가 필요합니다.");
  const discussion =
    start >= 0 && end > start
      ? lines
          .slice(start + 1, end)
          .filter(Boolean)
          .join("\n")
      : "";
  if (!hasValue(discussion)) issues.push("멘토링 내용 본문이 필요합니다.");
  if (
    /내용내용|(?:^|\s|[-•])0{3,}(?:\s|$)|작성\s*예시|입력\s*예시/m.test(
      companyStatus + "\n" + discussion,
    )
  )
    issues.push("본문에 양식 예시가 남아 있습니다.");
  if (![value(3, 3), value(4, 3), value(6, 3)].every(hasValue))
    issues.push("기업명·담당멘토·멘토링 주제가 필요합니다.");
  if (tab.formulaCells.length)
    issues.push("보고서에 수식이 있습니다. 원본 값 확인이 필요합니다.");
  const sourceHash = digest({ name: tab.name, cells: tab.cells });
  const eventId = `report-${digest({ file: source.id, round: roundMatch?.[1] }).slice(0, 40)}`;
  const event = {
    eventId,
    company: value(3, 3),
    campus,
    mentor: value(4, 3),
    kind: "전담" as const,
    round: Number(roundMatch?.[1] || 0),
    completedOn,
    reportWrittenOn,
    evidence: `필수 항목이 채워진 보고서: https://drive.google.com/file/d/${source.id}/view | 탭 ${tab.name} | 기업 ${address(3, 3)}, 멘토 ${address(4, 3)}, 진행일 ${address(4, 5)}, 본문 ${start + 2}~${end}행 | 보고서 작성일 ${reportWrittenOn}: ${writtenEvidence} | 원문 SHA256 ${sourceHash}`,
  };
  const parsed = masterEventSchema.safeParse(event);
  if (!parsed.success && !issues.length)
    issues.push("보고서의 완료 기록 필드를 확인해주세요.");
  return {
    fileId: source.id,
    fileName: source.name,
    tab: tab.name,
    version: source.version,
    sourceHash,
    eventId,
    company: event.company,
    round: event.round,
    issues,
    event: issues.length ? null : parsed.success ? parsed.data : null,
  };
}
export function inspectSubmissions(
  source: ReportSource,
  config: ReportWatchConfig,
) {
  const results = source.tabs.flatMap((tab) => {
    const result = parseSubmission(source, tab, config);
    return result ? [result] : [];
  });
  const ids = new Map<string, number>();
  for (const r of results) ids.set(r.eventId, (ids.get(r.eventId) || 0) + 1);
  return results.map((r) =>
    (ids.get(r.eventId) || 0) > 1
      ? {
          ...r,
          event: null,
          issues: [
            ...r.issues,
            "한 파일에 같은 회차의 보고서 탭이 두 개 이상입니다.",
          ],
        }
      : r,
  );
}

export function submissionState(
  issues: string[],
  sourceHash: string,
  configHash: string,
  previous:
    | { sourceHash?: string; configHash?: string; firstSeenAt?: number }
    | undefined,
  now: number,
) {
  const same =
    previous?.sourceHash === sourceHash &&
    previous?.configHash === configHash &&
    Number.isFinite(previous.firstSeenAt);
  const firstSeenAt = same ? previous!.firstSeenAt! : now;
  return {
    firstSeenAt,
    status: issues.length ? "incomplete" : "ready",
  };
}
