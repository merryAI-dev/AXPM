import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type {
  Snapshot,
  Company,
  Appointment,
  Evidence,
  Finding,
} from "./types";

export const digest = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const norm = (s: string) =>
  String(s).normalize("NFC").replace(/\s+/g, "").toLowerCase();
export function text(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((x) => x.text).join("");
    if ("error" in v) return "";
    if ("result" in v) {
      if (v.result instanceof Date) return v.result.toISOString().slice(0, 10);
      if (typeof v.result === "object" && v.result && "error" in v.result)
        return "";
      return String(v.result ?? "");
    }
    if ("text" in v) return String(v.text ?? "");
  }
  return String(v).trim();
}
export function checked(cell: ExcelJS.Cell): boolean {
  return (
    cell.value === true || cell.value === 1 || /^(true|1)$/i.test(text(cell))
  );
}
export function dateValue(cell: ExcelJS.Cell): string {
  const raw = text(cell);
  const m = raw.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return "";
  const result = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return Number.isNaN(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result
    ? ""
    : result;
}
export type Input = {
  role: "mentor" | "internal" | "applications" | "dedicated";
  name: string;
  buffer: Buffer;
};
export async function importWorkbooks(inputs: Input[]): Promise<Snapshot> {
  for (const role of ["mentor", "applications"]) {
    if (inputs.filter((x) => x.role === role).length !== 1)
      throw new Error(`${role} 파일을 하나씩 선택해주세요.`);
  }
  const books = await Promise.all(
    inputs.map(async (x) => {
      const w = new ExcelJS.Workbook();
      await w.xlsx.load(x.buffer as never);
      return { ...x, w };
    }),
  );
  const evidence: Evidence[] = [];
  const findings: Finding[] = [];
  function ev(role: string, sheet: string, cell: string, detail: string) {
    const id = digest(`${role}:${sheet}:${cell}`).slice(0, 20);
    evidence.push({ id, source: role, sheet, cell, detail });
    return id;
  }
  const source = books.find((x) => x.role === "mentor")!;
  const master = source.w.worksheets.find((s) =>
    norm(s.name).includes("전체사업관리현황"),
  );
  if (!master)
    throw new Error(
      "멘토용 파일에서 전체 사업관리현황 시트를 찾지 못했습니다.",
    );
  const expected: Record<string, string> = {
    C5: "회사명",
    D5: "대표자",
    N5: "총진행멘토링회차",
    O5: "1회차",
    R5: "2회차",
    U5: "3회차",
    X5: "4회차",
    AA5: "전문특화멘토링완료여부",
  };
  for (const [cell, label] of Object.entries(expected))
    if (norm(text(master.getCell(cell))) !== label)
      throw new Error(
        `${master.name}!${cell} 열 구조가 변경되었습니다. 매핑 확인이 필요합니다.`,
      );
  const companies: Company[] = [];
  for (let r = 6; r <= master.rowCount; r++) {
    const c = (col: string) => master.getCell(`${col}${r}`);
    if (c("C").isMerged && c("C").master.address !== c("C").address) continue;
    const name = text(c("C"));
    if (!name) continue;
    const rows = [r];
    while (
      rows[rows.length - 1] < master.rowCount &&
      master.getCell(`C${rows[rows.length - 1] + 1}`).isMerged &&
      master.getCell(`C${rows[rows.length - 1] + 1}`).master.address ===
        c("C").address
    )
      rows.push(rows[rows.length - 1] + 1);
    const cells = (col: string) => [
      ...new Map(
        rows.map((row) => {
          const cell = master.getCell(`${col}${row}`).master;
          return [cell.address, cell] as const;
        }),
      ).values(),
    ];
    const id = digest(
      `${source.role}:${norm(name)}:${norm(text(c("F")))}`,
    ).slice(0, 20);
    if (companies.some((x) => x.id === id))
      throw new Error(
        `중복 기업 식별자: ${master.name}!C${r}. 이메일/기업명 중복을 먼저 확인해주세요.`,
      );
    const evidenceId = ev("mentor", master.name, `C${r}`, name);
    const rounds = ["O", "R", "U", "X"].map((col, i) => {
      const complete = cells(col).some(checked);
      const report = cells(["P", "S", "V", "Y"][i])
        .map(text)
        .filter(Boolean)
        .join("; ");
      const evidenceId = ev(
        "mentor",
        master.name,
        cells(col)
          .map((x) => x.address)
          .join(","),
        `${i + 1}회차 완료=${complete}; 보고서 기록=${report || "없음"}`,
      );
      if (cells(col).filter(checked).length > 1)
        findings.push({
          id: `${id}-duplicate-${i}`,
          severity: "high",
          title: "회차 중복 완료표시",
          companyId: id,
          evidenceIds: [evidenceId],
          detail:
            "같은 기업·회차에 완료 체크가 여러 개 있습니다. 해당 회차는 1회로 집계했으며 원본 확인이 필요합니다.",
        });
      return { round: i + 1, complete, report, evidenceId };
    });
    const category = text(c("B"));
    const company: Company = {
      id,
      name,
      email: text(c("F")),
      campus: text(c("G")),
      mentor: text(c("H")),
      category,
      active: !["사업불참확정", "사업종료"].includes(category),
      regular: rounds.filter((x) => x.complete).length,
      specialty: cells("AA").some(checked),
      specialtyCount: cells("AA").filter(checked).length,
      requested: cells("AC").some((x) => !!text(x)),
      assigned: cells("AD").some((x) => !!text(x)),
      rounds,
      specialtyReport: cells("AB").map(text).filter(Boolean).join("; "),
      evidenceId,
    };
    // Representative is only included in the report context, not inferred from company names.
    evidence.push({
      id: `${id}-representative`,
      source: "mentor",
      sheet: master.name,
      cell: `D${r}`,
      detail: text(c("D")),
    });
    const specialtyEvidence = ev(
      "mentor",
      master.name,
      cells("AA")
        .map((x) => x.address)
        .join(","),
      `특화 완료표시=${company.specialtyCount}건; 보고서 기록=${company.specialtyReport || "없음"}`,
    );
    const cachedValues = cells("N").map(text).filter(Boolean);
    const cached = cachedValues.length
      ? String(cachedValues.reduce((sum, v) => sum + Number(v), 0))
      : "";
    if (cached !== "" && Number(cached) !== company.regular)
      findings.push({
        id: `${id}-count`,
        severity: "high",
        title: "집계 불일치",
        companyId: id,
        evidenceIds: rounds.map((x) => x.evidenceId),
        detail: `기존 합계 ${cached}, 완료 체크 재집계 ${company.regular}`,
      });
    for (const round of rounds) {
      if (round.complete !== !!round.report)
        findings.push({
          id: `${id}-report-${round.round}`,
          severity: "high",
          title: round.complete ? "보고서 기록 누락" : "완료 체크 확인",
          companyId: id,
          evidenceIds: [round.evidenceId],
          detail: `${round.round}회차: 완료 체크와 보고서 기록이 일치하지 않습니다. 보고서 원문 존재 여부는 별도 확인이 필요합니다.`,
        });
    }
    if (company.specialtyCount !== cells("AB").filter((x) => !!text(x)).length)
      findings.push({
        id: `${id}-special-report`,
        severity: "high",
        title: "특화 보고서·완료 확인",
        companyId: id,
        evidenceIds: [specialtyEvidence],
        detail: "특화 완료 체크 수와 보고서 기록 수가 일치하지 않습니다.",
      });
    companies.push(company);
  }
  if (!companies.length) throw new Error("기업 데이터가 없습니다.");
  const appointments: Appointment[] = [];
  const applications = books.find((x) => x.role === "applications")!;
  let scheduleSheets = 0;
  for (const s of applications.w.worksheets) {
    if (norm(text(s.getCell("F3"))) !== "기업명") continue;
    scheduleSheets++;
    for (let r = 5; r <= s.rowCount; r++) {
      const company = text(s.getCell(`F${r}`));
      if (!company) continue;
      const date = dateValue(s.getCell(`C${r}`)); // ExcelJS resolves only actual merged cells; no blind forward-fill.
      const time = text(s.getCell(`E${r}`));
      const strike =
        s.getCell(`F${r}`).font?.strike || s.getCell(`G${r}`).font?.strike;
      const note = [text(s.getCell(`H${r}`)), text(s.getCell(`I${r}`))]
        .filter(Boolean)
        .join("\n");
      const needsReview =
        !!strike ||
        /취소|변경|보류/.test(note) ||
        !date ||
        !/^\d{1,2}:\d{2}\s*[~～–-]\s*\d{1,2}:\d{2}$/.test(time);
      const matches = companies.filter((x) => norm(x.name) === norm(company));
      const evidenceId = ev(
        "applications",
        s.name,
        `F${r}`,
        `신청: ${company}; ${date || "날짜 미확인"} ${time}; 취소선=${!!strike}`,
      );
      const appointment: Appointment = {
        id: digest(`${s.name}:${r}`).slice(0, 20),
        company,
        companyId: matches.length === 1 ? matches[0].id : null,
        mentor: s.name,
        date,
        time,
        status: needsReview ? "review" : "scheduled",
        evidenceId,
        note,
        kind: "specialty",
      };
      appointments.push(appointment);
      if (needsReview || matches.length !== 1)
        findings.push({
          id: `${appointment.id}-review`,
          severity: "medium",
          title: needsReview ? "일정 상태 확인" : "기업 연결 확인",
          companyId: appointment.companyId,
          evidenceIds: [evidenceId],
          detail: needsReview
            ? "취소선·변경 메모 또는 날짜·시간 누락을 확인해주세요. 자동으로 완료/취소 처리하지 않습니다."
            : "회사명이 정확히 일치하는 단일 기업을 찾지 못했습니다. 자동 합치지 않습니다.",
        });
    }
  }
  if (!scheduleSheets)
    throw new Error(
      "특화 신청 파일에서 기업명(F3) 일정 시트를 찾지 못했습니다.",
    );
  const dedicated = books.find((x) => x.role === "dedicated");
  if (dedicated) {
    let parsed = 0;
    for (const s of dedicated.w.worksheets) {
      let header = 0;
      let companyCol = 0;
      for (let r = 1; r <= 8; r++)
        for (let col = 1; col <= 14; col++)
          if (
            text(s.getCell(r, col)) === "기업명" &&
            !s.getCell(r, col).isMerged
          ) {
            header = r;
            companyCol = col;
          }
      // Some templates merge their header vertically; use the merge's master row.
      if (!header)
        for (let r = 1; r <= 8; r++)
          for (let col = 1; col <= 14; col++)
            if (text(s.getCell(r, col)) === "기업명") {
              header = Number(s.getCell(r, col).master.row);
              companyCol = col;
            }
      if (!header) continue;
      parsed++;
      const requestDate = text(s.getCell(header, 4)) === "요청일자";
      const noteCols: number[] = [];
      for (let col = 1; col <= 15; col++)
        if (/비고|전달사항/.test(text(s.getCell(header, col))))
          noteCols.push(col);
      for (let r = header + 1; r <= s.rowCount; r++) {
        const company = text(s.getCell(r, companyCol));
        if (!company || company === "기업명") continue;
        const date = dateValue(s.getCell(r, requestDate ? 4 : 3));
        const time = requestDate ? "" : text(s.getCell(r, companyCol - 2));
        const note = noteCols
          .map((col) => text(s.getCell(r, col)))
          .filter(Boolean)
          .join("\n");
        const strike = !!s.getCell(r, companyCol).font?.strike;
        const review =
          strike ||
          !date ||
          !/^\d{1,2}:\d{2}\s*[~～–-]\s*\d{1,2}:\d{2}$/.test(time) ||
          /취소|변경|보류/.test(note);
        const matches = companies.filter((x) => norm(x.name) === norm(company));
        const evidenceId = ev(
          "dedicated",
          s.name,
          s.getCell(r, companyCol).address,
          `전담 신청: ${company}; ${date} ${time}; 취소선=${strike}`,
        );
        const id = digest(`dedicated:${s.name}:${r}`).slice(0, 20);
        appointments.push({
          id,
          company,
          companyId: matches.length === 1 ? matches[0].id : null,
          mentor: s.name,
          date,
          time,
          note,
          evidenceId,
          kind: "dedicated",
          status: review ? "review" : "scheduled",
        });
        if (review || matches.length !== 1)
          findings.push({
            id: `${id}-review`,
            title: review ? "전담 일정 상태 확인" : "기업 연결 확인",
            severity: "medium",
            companyId: matches.length === 1 ? matches[0].id : null,
            evidenceIds: [evidenceId],
            detail: "일정·취소선 또는 기업명 연결을 운영자가 확인해야 합니다.",
          });
      }
    }
    if (!parsed)
      throw new Error("전담 신청 파일에서 기업명 헤더를 찾지 못했습니다.");
  }
  const internal = books.find((x) => x.role === "internal");
  const policySheet = internal?.w.getWorksheet("기술협상");
  const policyText = policySheet ? text(policySheet.getCell("C7")) : "";
  const basis =
    policyText.includes("멘토링") || policyText.includes("3회")
      ? policyText
      : "기준 미확인: 운영자가 목표 횟수를 설정해야 합니다.";
  if (policySheet) ev("internal", policySheet.name, "C7", basis);
  return {
    id: digest(
      JSON.stringify({ companies, appointments, evidence, findings, basis }),
    ),
    importedAt: new Date().toISOString(),
    companies,
    appointments,
    evidence,
    findings,
    sources: books.map((x) => ({
      role: x.role,
      name: x.name,
      sha256: digest(x.buffer),
      sheets: x.w.worksheets.length,
    })),
    policy: {
      targetPerCompany: 3,
      targetBasis: basis,
      excludedCategories: ["사업불참확정", "사업종료"],
    },
  };
}

export function monitor(
  snapshot: Snapshot,
  target: number,
  asOf: string,
): Finding[] {
  const findings = [...snapshot.findings];
  for (const c of snapshot.companies) {
    // Specialty completion is a boolean; it establishes at least one, not a session ledger.
    const total = c.regular + c.specialtyCount;
    if (c.active && total < target)
      findings.push({
        id: `${c.id}-target`,
        title: "목표 대비 잔여",
        severity: "info",
        companyId: c.id,
        evidenceIds: [c.evidenceId],
        detail: `전담 ${c.regular}회 + 특화 완료표시 ${c.specialtyCount}건. 설정 목표 ${target}회 대비 ${target - total}회 부족. 미달 판정은 마감일·인정기준 확인이 필요합니다.`,
      });
    if (c.requested && !c.assigned && !c.specialty)
      findings.push({
        id: `${c.id}-assignment`,
        title: "특화 배정 확인",
        severity: "medium",
        companyId: c.id,
        evidenceIds: [c.evidenceId],
        detail: "특화 요청은 있으나 배정·완료 기록이 없습니다.",
      });
    for (const kind of ["dedicated", "specialty"] as const) {
      const hasSource = snapshot.sources.some(
        (x) => x.role === (kind === "dedicated" ? "dedicated" : "applications"),
      );
      const applications = snapshot.appointments.filter(
        (x) =>
          x.companyId === c.id && x.kind === kind && x.status !== "cancelled",
      );
      if (
        hasSource &&
        c.active &&
        !applications.length &&
        (kind === "dedicated" ? c.regular === 0 : c.requested && !c.specialty)
      )
        findings.push({
          id: `${c.id}-${kind}-unapplied`,
          title: `${kind === "dedicated" ? "전담" : "특화"} 미신청 후보`,
          severity: "medium",
          companyId: c.id,
          evidenceIds: [c.evidenceId],
          detail:
            "신청 시트에 정확히 연결된 기록이 없습니다. 다른 회사명으로 신청했을 가능성이 있으므로 안내 전 확인해주세요.",
        });
    }
  }
  for (const a of snapshot.appointments)
    if (a.status === "scheduled" && a.date && a.date < asOf)
      findings.push({
        id: `${a.id}-past`,
        title: "지난 일정 결과 확인",
        severity: "medium",
        companyId: a.companyId,
        evidenceIds: [a.evidenceId],
        detail: `${a.date} ${a.time}. 신청은 완료 증빙이 아니므로 결과 확인이 필요합니다.`,
      });
  return findings;
}
