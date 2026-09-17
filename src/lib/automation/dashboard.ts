export type DashboardCell = { text: string; formula?: string };
export type DashboardData = {
  rows: DashboardCell[][];
  checkedAt: string;
  spreadsheetId: string;
  sheetId: number;
  range: string;
  product: {
    programName: string;
    defaultCampus: string;
    masterSheetTitle: string;
    masterUrl: string;
    reportFolderId: string;
  };
};
export function dashboardCell(data: DashboardData, address: string) {
  const match = address.match(/^([J-S])(\d+)$/);
  if (!match) throw new Error("대시보드 셀 범위를 확인해주세요.");
  return (
    data.rows[Number(match[2]) - 98]?.[match[1].charCodeAt(0) - 74]?.text ?? ""
  );
}
export function dashboardSummary(data: DashboardData) {
  const get = (address: string) => dashboardCell(data, address);
  return {
    range: data.range,
    checkedAt: data.checkedAt,
    dedicated: get("K106"),
    dedicatedTarget: get("K107"),
    dedicatedRate: get("K108"),
    specialty: get("O106"),
    specialtyTarget: get("O107"),
    specialtyRate: get("N108"),
    combined: get("P100"),
    combinedTarget: get("P101"),
    combinedRate: get("P102"),
    participatingCompanies: get("K116"),
    totalCompanies: get("S116"),
  };
}
