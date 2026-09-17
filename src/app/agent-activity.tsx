"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { automationActivity } from "@/lib/automation/activity";
const sources: Record<string, string> = {
  "report-monitor": "자동 감시",
  agent: "에이전트",
  operator: "운영자 실행",
  unclassified: "이전 실행 · 출처 미기록",
};
const statuses: Record<string, string> = {
  verified: "반영 확인",
  prepared: "반영 준비",
  writing: "기록 중",
  uncertain: "결과 확인 필요",
  done: "완료",
  failed: "실패",
  running: "실행 중",
  attention: "보완·오류 있음",
  incomplete: "필수 항목 보완",
  settling: "안정화 대기",
  preview: "반영 미리보기",
  blocked: "확인 필요",
  unchanged: "이미 반영됨",
  error: "조회 실패",
  unmapped: "양식 확인",
};
export default function AgentActivity({ visible }: { visible: boolean }) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof automationActivity>
  > | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!visible) return;
    let active = true,
      running = false;
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const d = await api("automation/activity");
        if (active) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
      }
    }
    void refresh();
    window.addEventListener("axpm:master-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("axpm:master-updated", refresh);
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <section className="panel">
      <div className="panelTitle">
        <h2>에이전트 활동</h2>
        <span className="badge">자동 반영 · 실행 이력</span>
      </div>
      <p className="hint">
        자동 기록, 점검 결과와 에이전트 요청을 표시합니다.
      </p>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p>{error ? "활동을 불러오지 못했습니다." : "활동을 읽고 있습니다…"}</p>
      ) : !data.items.length ? (
        <p>아직 기록된 활동이 없습니다.</p>
      ) : (
        <div className="driveHistoryList">
          {data.items.map((item) => (
            <article className="fileRow" key={item.id}>
              <div className="fileInfo">
                <strong>{item.title}</strong>
                <small>
                  {sources[item.source] || item.source} ·{" "}
                  {item.type === "master-reversal" && item.status === "verified"
                    ? `자동 반영 취소 확인 · ${item.cells.join(", ")}`
                    : item.type === "master-record" &&
                        item.status === "verified"
                    ? item.cells.length
                      ? `${item.source === "report-monitor" ? "자동 기록 확인" : item.source === "agent" ? "에이전트 기록 확인" : "기록 확인"} · ${item.cells.join(", ")}`
                      : "기존 기록 확인 · 변경 없음"
                    : statuses[item.status] || item.status}{" "}
                  ·{" "}
                  {new Date(item.createdAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </small>
                <details>
                  <summary>처리 근거와 결과</summary>
                  {item.error && <p className="error">{item.error}</p>}
                  {item.changes.map(
                    (c: {
                      cell: string;
                      before: unknown;
                      after: unknown;
                      format?: string;
                    }) => (
                      <p key={c.cell}>
                        {c.cell}: {String(c.before ?? "빈 셀")} →{" "}
                        {String(c.after)}
                        {c.format ? ` · 날짜 표시 형식 ${c.format}` : ""}
                      </p>
                    ),
                  )}
                  {item.evidence && <p>{item.evidence}</p>}
                  {item.summary && (
                    <p style={{ whiteSpace: "pre-wrap" }}>{item.summary}</p>
                  )}
                  {item.results.map(
                    (
                      r: {
                        fileId: string;
                        tab: string;
                        company: string;
                        fileName: string;
                        status: string;
                        issues: string[];
                        error: string;
                      },
                      i: number,
                    ) => (
                      <p key={i}>
                        <a
                          href={`https://drive.google.com/open?id=${encodeURIComponent(r.fileId)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.company || r.fileName} · {r.tab}
                        </a>{" "}
                        · {statuses[r.status] || r.status}{" "}
                        {(r.issues || []).join(" / ")} {r.error}
                      </p>
                    ),
                  )}
                </details>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
