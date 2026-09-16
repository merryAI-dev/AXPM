import type { overview } from "./store";
export function operationsContext(state: Awaited<ReturnType<typeof overview>>) {
  const data = state.snapshot;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
  const upcoming = (data?.appointments || [])
    .filter((a) => a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    snapshotId: data?.id,
    importedAt: data?.importedAt,
    sources: data?.sources.map((x) => ({ role: x.role, name: x.name })),
    policy: data?.policy,
    totals: {
      companies: data?.companies.length || 0,
      regular: data?.companies.reduce((s, c) => s + c.regular, 0) || 0,
      specialty: data?.companies.reduce((s, c) => s + c.specialtyCount, 0) || 0,
      appointments: data?.appointments.length || 0,
      findings: state.findings.length,
    },
    companies: data?.companies.map((c) => ({
      id: c.id,
      name: c.name,
      mentor: c.mentor,
      campus: c.campus,
      active: c.active,
      regular: c.regular,
      specialtyCount: c.specialtyCount,
      requested: c.requested,
      assigned: c.assigned,
      evidenceId: c.evidenceId,
      findingTitles: [
        ...new Set(
          state.findings
            .filter((f) => f.companyId === c.id)
            .map((f) => f.title),
        ),
      ],
    })),
    findings: state.findings.slice(0, 30),
    findingsTruncated: state.findings.length > 30,
    upcomingAppointments: upcoming.slice(0, 50),
    upcomingTruncated: upcoming.length > 50,
    tickets: state.tickets,
    google: state.google,
    instruction:
      "개별 기업의 전체 근거·일정·누락은 기업 상세 도구로 조회하세요. 위 findings는 최대 30개이며 전체 목록이 아닙니다.",
  };
}
export function companyContext(
  state: Awaited<ReturnType<typeof overview>>,
  id: string,
) {
  const company = state.snapshot?.companies.find((c) => c.id === id);
  const appointments =
    state.snapshot?.appointments.filter((a) => a.companyId === id) || [];
  const findings = state.findings.filter((f) => f.companyId === id);
  const ids = new Set([
    company?.evidenceId,
    `${id}-representative`,
    ...(company?.rounds.map((r) => r.evidenceId) || []),
    ...appointments.map((a) => a.evidenceId),
    ...findings.flatMap((f) => f.evidenceIds),
  ]);
  return {
    company,
    appointments,
    findings,
    evidence: state.snapshot?.evidence.filter((e) => ids.has(e.id)),
    tickets: state.tickets.filter((t) => t.companyId === id),
  };
}
