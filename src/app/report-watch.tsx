"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
type Item = {
  fileId: string;
  fileName?: string;
  tab?: string;
  status?: string;
  issues?: string[];
  error?: string;
};
type RenameItem = {
  fileId: string;
  before: string;
  after: string;
  ready: boolean;
  issues: string[];
  hints: { campus: string; company: string[] };
};
const initial = {
  folderId: "",
  campus: "전체",
  enabled: false,
  autoApply: false,
};
const labels: Record<string, string> = {
  incomplete: "필수 항목 보완",
  settling: "작성 중 · 안정화 대기",
  ready: "반영 가능",
  preview: "마스터 반영 미리보기",
  verified: "마스터 반영 확인",
  unchanged: "이미 반영됨",
  blocked: "확인 필요",
  uncertain: "반영 후 원본 변경 · 확인 필요",
  error: "조회 실패",
  unmapped: "양식 확인",
  done: "이름 변경 확인",
  partial: "일부 처리",
  skipped: "실행 대기",
};
export default function ReportWatch({ visible }: { visible: boolean }) {
  const [form, setForm] = useState(initial),
    [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState<{
    results: Item[];
    processed: number;
    totalFiles: number;
    complete: boolean;
    checkedAt: string;
  } | null>(null);
  const [batch, setBatch] = useState<{
    batchId: string;
    items: RenameItem[];
  } | null>(null);
  const [renamed, setRenamed] = useState<Item[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<{
    summary: string;
    trace: { tool: string; result: string }[];
  } | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [worker, setWorker] = useState<{
    status: string;
    startedAt?: string;
    lastSuccessAt?: string;
    lastError?: string;
  } | null>(null);
  const workerTime = Math.max(
    Date.parse(worker?.startedAt || "") || 0,
    Date.parse(worker?.lastSuccessAt || "") || 0,
  );
  const workerActive = workerTime > Date.now() - 10 * 60_000;
  const running = useRef(false);
  async function load() {
    const [data, product] = await Promise.all([
      api("automation/reports"),
      api("automation/config"),
    ]);
    if (data.config) {
      setForm(data.config);
      setConnected(true);
      setMonitorEnabled(data.config.enabled);
    } else
      setForm((current) => ({
        ...current,
        folderId: product.reportFolderId,
        campus: product.defaultCampus || "전체",
      }));
    setLatest(data.latest);
    setWorker(data.worker);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function work(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function scan() {
    await work(async () => {
      const data = await api("automation/reports/run", {});
      setLatest(data);
      window.dispatchEvent(new Event("axpm:master-updated"));
    });
  }
  if (!visible) return null;
  return (
    <section className="panel">
      <div className="panelTitle">
        <h2>기존 멘토링 보고서 감시 · 파일명 통일</h2>
        <span className="badge">
          {busy ? "처리 중" : connected ? "폴더 연결됨" : "연결 설정 필요"}
        </span>
      </div>
      {workerActive && (
        <p className="banner success" role="status">
          백그라운드 자동 점검 실행 중 · 브라우저를 닫아도 이 Mac이 켜져 있고
          로그인된 동안 계속됩니다.
          {worker?.lastSuccessAt &&
            ` 마지막 점검 ${new Date(worker.lastSuccessAt).toLocaleString("ko-KR")}`}
        </p>
      )}
      {worker?.status === "error" && (
        <p className="banner error">자동 점검 오류: {worker.lastError}</p>
      )}
      <p className="hint">
        회차 탭의 기업명·멘토·진행일·참석자·주제·기업현황·멘토링 내용이 채워지고
        탭 날짜가 유효하면 시간 대기 없이 마스터의 완료 체크와 작성일을
        반영합니다. 작성일 필드를 우선 사용하고, 없으면 회차 탭 날짜를
        사용합니다. 비어 있거나 작성중인 탭은 보류합니다.
      </p>
      <label>
        보고서 폴더 URL 또는 ID
        <input
          value={form.folderId}
          disabled={busy}
          onChange={(e) => {
            setForm({ ...form, folderId: e.target.value });
            setBatch(null);
          }}
        />
      </label>
      <label>
        캠퍼스
        <input
          value={form.campus}
          disabled={busy}
          onChange={(e) => setForm({ ...form, campus: e.target.value })}
          placeholder="전체 또는 기본 캠퍼스"
        />
      </label>
      <label className="inlineCheck">
        <input
          type="checkbox"
          checked={form.autoApply}
          disabled={busy}
          onChange={(e) => setForm({ ...form, autoApply: e.target.checked })}
        />
        필수 항목 검증을 통과한 보고서를 마스터에 자동 반영
      </label>
      <label className="inlineCheck">
        <input
          type="checkbox"
          checked={form.enabled}
          disabled={busy}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        자동 점검 사용 · 백그라운드 실행 및 화면 점검 허용
      </label>
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !connected}
          onClick={() =>
            void work(async () => {
              setAgent(
                await api("automation/reports/agent", {
                  mode: "preview",
                  task: "all",
                }),
              );
              await load();
            })
          }
        >
          Hermes로 조사·계획
        </button>
        <button
          className="primary"
          disabled={busy || !connected || !form.autoApply}
          onClick={() =>
            void work(async () => {
              setAgent(
                await api("automation/reports/agent", {
                  mode: "apply",
                  task: "all",
                }),
              );
              await load();
              window.dispatchEvent(new Event("axpm:master-updated"));
            })
          }
        >
          Hermes로 보고서 반영·파일명 통일 실행
        </button>
      </div>
      {agent && (
        <div className="finding">
          <div>
            <strong>Hermes 작업 결과</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{agent.summary}</p>
            <details>
              <summary>도구 실행 이력</summary>
              {agent.trace.map((t, i) => (
                <p key={i}>
                  {t.tool}: {t.result}
                </p>
              ))}
            </details>
          </div>
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              await api("automation/reports/setup", form);
              await load();
            })
          }
        >
          보고서 감시 설정 저장
        </button>
        <button
          className="secondary"
          disabled={busy || !connected}
          onClick={() => void scan()}
        >
          지금 보고서 읽기
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              const folderId =
                form.folderId.match(/\/folders\/([\w-]+)/)?.[1] ||
                form.folderId;
              setBatch(
                await api("automation/report-names/preview", { folderId }),
              );
              setRenamed([]);
            })
          }
        >
          파일명 통일 목록 만들기
        </button>
      </div>
      <p className="hint">
        하위 캠퍼스 폴더도 읽습니다. 샘플·이전자료·보관 폴더는 제외합니다. 한
        번에 최대 15개 파일을 점검하며 다음 실행에서 이어갑니다. 백그라운드
        서비스가 연결되면 화면을 닫아도 점검을 이어갑니다.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {latest && (
        <>
          <p className="hint">
            최근 점검 {new Date(latest.checkedAt).toLocaleString("ko-KR")} ·
            이번 {latest.processed}/{latest.totalFiles}개 파일 ·{" "}
            {latest.complete ? "목록 끝까지 도달" : "다음 점검에서 계속"}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>파일·탭</th>
                  <th>처리 상태</th>
                  <th>확인 항목</th>
                </tr>
              </thead>
              <tbody>
                {latest.results.map((r, i) => (
                  <tr key={`${r.fileId}:${r.tab}:${i}`}>
                    <td>
                      {r.fileName}
                      <br />
                      {r.tab}
                    </td>
                    <td>{labels[r.status || ""] || r.status}</td>
                    <td>
                      {r.error || r.issues?.join(" · ") || "필수 항목 확인"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {batch && (
        <>
          <h3>
            파일명 변경 전·후 · {batch.items.filter((i) => i.ready).length}개
            변경 가능
          </h3>
          <p className="hint">
            회차가 여러 개 들어 있는 기업 파일은 사업명·캠퍼스·전담
            멘토링·기업명으로 통일합니다. 본문과 마스터가 일치하는 파일만
            변경합니다.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>현재 이름</th>
                  <th>통일할 이름</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((item) => (
                  <tr key={item.fileId}>
                    <td>{item.before}</td>
                    <td>{item.after || "매칭 필요"}</td>
                    <td>
                      {item.issues.join(" · ") ||
                        (item.ready ? "변경 가능" : "이미 동일")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="primary"
            disabled={
              busy || !batch.items.some((i) => i.ready) || renamed.length > 0
            }
            onClick={() =>
              void work(async () => {
                const result = await api("automation/report-names/apply", {
                  batchId: batch.batchId,
                });
                setRenamed(result.results);
              })
            }
          >
            변경 가능한 파일명 일괄 반영
          </button>
        </>
      )}
      {renamed.map((r) => (
        <p key={r.fileId} className={r.error ? "error" : "hint"}>
          {batch?.items.find((i) => i.fileId === r.fileId)?.before}:{" "}
          {r.error || labels[r.status || ""] || r.status}
        </p>
      ))}
    </section>
  );
}
