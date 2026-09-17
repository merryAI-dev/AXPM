"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { download } from "./workspace-panel";
import type { Command } from "@/lib/workspace/schema";
type Job = {
  id: string;
  kind: string;
  status: string;
  reason?: string;
  goal?: string;
  command?: Command;
  target?: { name: string };
  createdAt: string;
  attempts: number;
  error?: string;
  backupPath?: string;
  backupMime?: string;
  result?: { summary?: string; name?: string };
};
const labels: Record<string, string> = {
  pending: "승인 대기",
  queued: "실행 대기",
  running: "실행 중",
  done: "확인 완료",
  failed: "실행 전 실패",
  uncertain: "결과 확인 필요",
  rejected: "반려",
};
const kinds: Record<string, string> = {
  "workbook.publish": "엑셀 Drive 게시",
  "folder.create": "폴더 생성",
  "file.copy": "파일 복사",
  "file.rename": "이름 변경",
  "file.trash": "휴지통 이동",
  "file.restore": "복원",
  "cells.update": "셀 편집",
  "agent.run": "에이전트 조사",
};
export default function JobsPanel() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [selected, setSelected] = useState<string>(""),
    [events, setEvents] = useState<{ type: string; at: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all");
  async function refresh() {
    setJobs(await api("jobs"));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      5000,
    );
    return () => clearInterval(timer);
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const counts = ["pending", "queued", "running", "uncertain"].map(
    (status) =>
      [status, jobs.filter((j) => j.status === status).length] as const,
  );
  return (
    <div className="workspacePanel">
      <section className="workspaceHero">
        <div>
          <span className="eyebrow">작업과 승인</span>
          <h2>무엇을 바꾸는지, 결과까지 확인하세요</h2>
          <p>
            에이전트와 운영자의 변경안을 함께 관리합니다. 외부 변경은 승인 후
            실행해요.
          </p>
        </div>
      </section>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <div className="jobStats">
        {counts.map(([status, count]) => (
          <button
            className={filter === status ? "selected" : ""}
            key={status}
            onClick={() => setFilter(filter === status ? "all" : status)}
          >
            <small>{labels[status]}</small>
            <strong>{count}</strong>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => act(refresh)}
        >
          새로고침
        </button>
        <button className="textButton" onClick={() => setFilter("all")}>
          최근 작업 전체
        </button>
        <small>최근 50건 · 실행 후에는 원본을 다시 읽어 확인합니다</small>
      </div>
      {jobs.filter((j) => filter === "all" || j.status === filter).length ===
        0 && (
        <section className="panel emptyState">
          <h3>표시할 작업이 없습니다</h3>
          <p>파일 변경안이나 에이전트 요청을 만들면 여기에 남습니다.</p>
        </section>
      )}
      {jobs
        .filter((j) => filter === "all" || j.status === filter)
        .map((j) => (
          <section key={j.id} className="panel jobCard">
            <div className="panelTitle">
              <div>
                <small>{new Date(j.createdAt).toLocaleString("ko-KR")}</small>
                <h2>{kinds[j.command?.kind || j.kind] || j.kind}</h2>
              </div>
              <span
                className={`badge ${
                  (
                    {
                      done: "green",
                      pending: "blue",
                      queued: "blue",
                      running: "blue",
                      uncertain: "amber",
                      failed: "red",
                    } as Record<string, string>
                  )[j.status] || ""
                }`}
              >
                {labels[j.status] || j.status}
              </span>
            </div>
            <p>{j.target?.name || j.goal}</p>
            <p>{j.reason}</p>
            {j.error && <p className="error">{j.error}</p>}
            {j.result?.summary && (
              <p className="agentSummary">{j.result.summary}</p>
            )}
            <button
              className="textButton"
              onClick={() =>
                act(async () => {
                  if (selected === j.id) {
                    setSelected("");
                    return;
                  }
                  setEvents(await api(`jobs/events?id=${j.id}`));
                  setSelected(j.id);
                })
              }
            >
              {selected === j.id ? "접기" : "변경 내용 · 이력 확인"}
            </button>
            {selected === j.id && (
              <div className="reviewBox">
                {j.command?.kind === "cells.update" ? (
                  <div className="diffList">
                    {j.command.mapping
                      .filter((f) => {
                        const c = j.command! as Extract<
                          Command,
                          { kind: "cells.update" }
                        >;
                        return c.before[f.key] !== c.after[f.key];
                      })
                      .map((f) => {
                        const c = j.command! as Extract<
                          Command,
                          { kind: "cells.update" }
                        >;
                        return (
                          <article key={f.key}>
                            <strong>
                              {c.sheet}!{f.cell} · {f.label}
                            </strong>
                            <div className="diffColumns">
                              <div>
                                <small>현재 값</small>
                                <p>{c.before[f.key] || "(빈 셀)"}</p>
                              </div>
                              <div>
                                <small>변경할 값</small>
                                <p>{c.after[f.key] || "(빈 셀)"}</p>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                  </div>
                ) : (
                  j.command && (
                    <p>
                      {"name" in j.command
                        ? `이름: ${j.command.name}`
                        : j.command.kind === "file.trash"
                          ? "휴지통으로 이동합니다. 폴더는 하위 항목도 영향을 받습니다."
                          : "휴지통에서 복원합니다."}
                    </p>
                  )
                )}
                <ol className="eventList">
                  {events.map((e, i) => (
                    <li key={i}>
                      {new Date(e.at).toLocaleString("ko-KR")} · {e.type}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="toolbar">
              {j.status === "pending" && (
                <>
                  <button
                    className="primary"
                    disabled={busy || selected !== j.id}
                    onClick={() =>
                      act(async () => {
                        await api("jobs/decide", { id: j.id, approve: true });
                      })
                    }
                  >
                    확인한 변경 승인
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api("jobs/decide", { id: j.id, approve: false });
                      })
                    }
                  >
                    반려
                  </button>
                  {selected !== j.id && (
                    <small>변경 내용을 먼저 펼쳐 확인해주세요</small>
                  )}
                </>
              )}
              {j.status === "queued" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api("jobs/process", { id: j.id });
                    })
                  }
                >
                  지금 실행
                </button>
              )}
              {j.backupPath && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(() =>
                      download(
                        "jobs/backup",
                        { id: j.id },
                        `backup.${j.backupMime?.includes("json") ? "json" : "xlsx"}`,
                      ),
                    )
                  }
                >
                  변경 전 백업 다운로드
                </button>
              )}
            </div>
            {j.status === "uncertain" && (
              <p className="hint">
                자동으로 재실행하지 않습니다. 원본과 이력을 확인하고 필요한
                변경을 새로 요청해주세요.
              </p>
            )}
          </section>
        ))}
    </div>
  );
}
