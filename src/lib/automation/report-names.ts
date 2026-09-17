import { normalizeCampus } from "./master";
import type { ReportSource } from "./report-submission";
import type { masterOverview } from "./master";
import { productConfig } from "../product-config";
export const nameHints = (name: string) => ({
  campus: name.match(/(?:남부|북부|중부|서부)(?:캠퍼스)?/)?.[0] || "",
  company: name
    .replace(/\.xlsx$/i, "")
    .replace(/\[[^\]]+\]|\([^)]*\)/g, " ")
    .split(/멘토링보고서[_\s]*|_멘토링보고서/)
    .map((s) =>
      s.replace(/[_\s]*(공유|최종|수정본)(?:[_\s]*\d+)?$/g, "").trim(),
    )
    .filter((s) => s && !/^공유/.test(s)),
});
export const normalizeCompany = (s: string) =>
  s
    .normalize("NFC")
    .replace(/주식회사|\(주\)|㈜/g, "")
    .replace(/\s+/g, "");
export function reportNamePlan(
  source: ReportSource,
  companies: ReturnType<typeof masterOverview>["companies"],
  extension: string,
) {
  const hints = nameHints(source.name),
    issues: string[] = [];
  if (
    source.tabs.some((t) =>
      t.formulaCells.some((c) => ["C3", "E4"].includes(c)),
    )
  )
    issues.push(
      "기업명·캠퍼스가 수식으로 지정되어 있습니다. 원본 확인이 필요합니다.",
    );
  const identities = source.tabs
    .filter((t) => !t.hidden)
    .map((t) => ({
      company:
        t.cells[2]?.[1] === "기업명" ? (t.cells[2]?.[2] || "").trim() : "",
      campuses: [
        ...(t.cells[3]?.[4] || "").matchAll(/([가-힣]+)\s*캠퍼스/g),
      ].map((m) => normalizeCampus(m[1])),
    }))
    .filter((x) => x.company);
  if (!identities.length)
    issues.push("보고서 본문의 기업명을 찾지 못했습니다.");
  const matches = identities.map((identity) =>
    companies.filter(
      (c) =>
        normalizeCompany(c.company) === normalizeCompany(identity.company) &&
        identity.campuses.length > 0 &&
        identity.campuses.every((v) => v === normalizeCampus(c.campus)),
    ),
  );
  if (matches.some((m) => m.length !== 1))
    issues.push("본문 기업명·캠퍼스가 마스터의 한 기업과 일치하지 않습니다.");
  const rows = new Set(matches.flatMap((m) => m.map((c) => c.row)));
  if (rows.size !== 1)
    issues.push("회차별 기업 정보가 서로 다르거나 매칭되지 않습니다.");
  const company = matches[0]?.length === 1 ? matches[0][0] : null;
  if (
    company &&
    hints.campus &&
    normalizeCampus(hints.campus) !== normalizeCampus(company.campus)
  )
    issues.push("파일명 캠퍼스 힌트와 본문이 다릅니다.");
  const after = company
    ? `[${productConfig().programName.replace(/\s+/g, "")}] ${company.campus}_전담멘토링보고서_${company.company}${extension}`
    : "";
  if (after.length > 240 || /[\x00-\x1f/\\]/.test(after))
    issues.push("통일 파일명에 허용하지 않는 문자 또는 길이가 있습니다.");
  return {
    fileId: source.id,
    version: source.version,
    before: source.name,
    after,
    hints,
    issues,
    ready: issues.length === 0 && after !== source.name,
  };
}

export function matchReportCompany(
  company: string,
  campus: string,
  companies: ReturnType<typeof masterOverview>["companies"],
) {
  const matches = companies.filter(
    (c) =>
      normalizeCompany(c.company) === normalizeCompany(company) &&
      normalizeCampus(c.campus) === normalizeCampus(campus),
  );
  if (matches.length !== 1)
    throw new Error(
      "보고서 기업명·캠퍼스와 일치하는 마스터 기업을 하나로 특정할 수 없습니다.",
    );
  return matches[0];
}
