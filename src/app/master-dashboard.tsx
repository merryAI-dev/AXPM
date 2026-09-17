"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import {
  dashboardCell,
  dashboardSummary,
  type DashboardData,
} from "@/lib/automation/dashboard";
export default function MasterDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      setData(await api("automation/master/dashboard"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true,
      running = false;
    async function load() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      setBusy(true);
      try {
        const result = await api("automation/master/dashboard");
        if (active) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
        if (active) setBusy(false);
      }
    }
    void load();
    window.addEventListener("axpm:master-updated", load);
    return () => {
      active = false;
      window.removeEventListener("axpm:master-updated", load);
    };
  }, []);
  const get = (cell: string) => (data ? dashboardCell(data, cell) : "");
  const summary = data ? dashboardSummary(data) : null;
  const link = data
    ? `${data.product.masterUrl}&range=${data.range.split("!")[1]}`
    : "#";
  function table(
    title: string,
    header: string[],
    rows: number[],
    columns: string[],
  ) {
    return (
      <section className="panel" key={title}>
        <h2>{title}</h2>
        <div className="dashboardTable">
          <table>
            <thead>
              <tr>
                {header.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  {columns.map((c, i) =>
                    i === 0 ? (
                      <th scope="row" key={c}>
                        {get(`${c}${r}`) || "—"}
                      </th>
                    ) : (
                      <td key={c} title={`${c}${r}`}>
                        {get(`${c}${r}`) || "—"}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  return (
    <div className="workspacePanel">
      <section className="workspaceHero">
        <div>
          <span className="eyebrow">{data?.product.programName || "운영 대시보드"}</span>
          <h2>사업 운영 대시보드</h2>
          <p>마스터의 진행 현황과 참여 현황을 한눈에 확인하세요.</p>
        </div>
        <a className="textButton" href={link} target="_blank" rel="noreferrer">
          원본 집계표 ↗
        </a>
      </section>
      <div className="toolbar">
        <span className="hint">
          {data
            ? `원본 확인 ${new Date(data.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 열 때·변경 후 갱신`
            : error
              ? "원본 집계표 조회 실패"
              : "원본 집계표를 읽고 있습니다…"}
        </span>
        <button className="secondary" disabled={busy} onClick={refresh}>
          {busy ? "조회 중…" : "새로고침"}
        </button>
      </div>
      {error && (
        <p className="banner error" role="alert">
          {error}
          {data && " · 아래는 마지막으로 확인한 값입니다."}
        </p>
      )}
      {summary && (
        <>
          <div className="stats">
            {[
              [
                "전담 멘토링",
                summary.dedicated,
                `목표 ${summary.dedicatedTarget}회 · 달성률 ${summary.dedicatedRate}`,
              ],
              [
                "특화 멘토링",
                summary.specialty,
                `목표 ${summary.specialtyTarget}건 · 달성률 ${summary.specialtyRate}`,
              ],
              [
                "통합 달성률",
                summary.combinedRate,
                `${summary.combined} / ${summary.combinedTarget}회`,
              ],
              [
                "총 참여 현황",
                summary.participatingCompanies,
                `신청 합계 ${summary.totalCompanies}개사`,
              ],
            ].map(([label, value, detail]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value || "—"}</strong>
                <p>{detail}</p>
              </article>
            ))}
          </div>
          {table(
            "캠퍼스별 멘토링 진행",
            ["캠퍼스", "1차", "2차", "3차", "4차", "특화"],
            [100, 101, 102, 103, 104, 105],
            ["J", "K", "L", "M", "N", "O"],
          )}
          {get("Q107") && <p className="hint">{get("Q107")}</p>}
          {table(
            "참여 기업 현황",
            [
              "캠퍼스",
              ...["K", "L", "M", "N", "O", "P", "Q", "R", "S"].map((c) =>
                get(`${c}110`),
              ),
            ],
            [111, 112, 113, 114, 115, 116],
            ["J", "K", "L", "M", "N", "O", "P", "Q", "R", "S"],
          )}
          {table(
            "멘토별 담당 기업",
            [
              "멘토",
              ...["K", "L", "M", "N", "O", "Q"].map((c) => get(`${c}118`)),
            ],
            [119, 120, 121, 122, 123],
            ["J", "K", "L", "M", "N", "O", "Q"],
          )}
          {table(
            "멘토별 진행 회차",
            ["멘토", "진행 회차"],
            [126, 127, 128, 129, 130],
            ["J", "K"],
          )}
          <p className="hint">
            출처: {data!.range} · 원본 수식의 표시값을 사용합니다. 빈 셀은 ‘—’로
            표시합니다.
          </p>
        </>
      )}
    </div>
  );
}
