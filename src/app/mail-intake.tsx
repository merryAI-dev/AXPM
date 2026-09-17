"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { download } from "./workspace-panel";

type Item = {
  id: string;
  originalName: string;
  storedName?: string;
  sender: string;
  subject: string;
  receivedAt?: string;
  status: string;
  issues?: string[];
  error?: string;
  driveUrl?: string;
};
type MailState = {
  configured: boolean;
  connected: boolean;
  connectionError: string;
  inbox: string;
  query: string;
  folderId: string;
  lastSync: null | {
    finishedAt: string;
    collected: number;
    normalized: number;
    review: number;
    skipped: number;
  };
  items: Item[];
};

const label: Record<string, string> = {
  normalized: "이름 통일",
  collected: "수집 완료",
  review: "검토 필요",
  failed: "수집 실패",
  processing: "처리 중",
};

export default function MailIntake() {
  const [state, setState] = useState<MailState | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => api("mail/intake").then(setState);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const items = useMemo(() => {
    const needle = query.trim().normalize("NFC").toLowerCase();
    if (!needle) return state?.items || [];
    return (state?.items || []).filter((item) =>
      [item.subject, item.sender, item.originalName, item.storedName]
        .join(" ")
        .normalize("NFC")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, state]);
  const summary = state?.items.reduce(
    (count, item) => {
      count.total++;
      if (item.status === "normalized") count.normalized++;
      if (item.status === "review" || item.status === "failed") count.attention++;
      return count;
    },
    { total: 0, normalized: 0, attention: 0 },
  );
  async function sync() {
    setBusy(true);
    setError("");
    try {
      await api("mail/sync", {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const { url } = await api("mail/oauth/start", {});
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("mail/oauth/disconnect", {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel mailIntake">
      <div className="panelTitle">
        <div>
          <span className="eyebrow">GMAIL ATTACHMENT INTAKE</span>
          <h2>메일 첨부 수집</h2>
        </div>
        <span className={`badge ${state?.connected ? "green" : ""}`}>
          {state?.connected ? "Gmail 연결됨" : "연동 필요"}
        </span>
      </div>
      <p className="hint">
        지정한 메일함의 첨부를 관리 Drive에 저장하고 XLSX 보고서 이름을
        본문 기준으로 통일합니다. 같은 첨부는 다시 저장하지 않습니다.
      </p>
      {error && <p className="banner error">{error}</p>}
      {!state?.connected ? (
        <div className="emptyState">
          <strong>Google Workspace 연동이 필요합니다.</strong>
          <p>사용할 Google 계정으로 로그인하고 Gmail 첨부 읽기에 직접 동의하면 됩니다.</p>
          {state?.connectionError && <p className="hint">{state.connectionError}</p>}
          <button className="secondary" onClick={connect} disabled={busy}>
            {busy ? "연결 준비 중…" : "내 Google 계정 연동하기"}
          </button>
        </div>
      ) : (
        <>
          <div className="metricRow">
            <div><small>최근 수집</small><strong>{summary?.total || 0}건</strong></div>
            <div><small>이름 통일</small><strong>{summary?.normalized || 0}건</strong></div>
            <div><small>확인 필요</small><strong>{summary?.attention || 0}건</strong></div>
          </div>
          <div className="toolbar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="제목·보낸 사람·파일명 검색"
              aria-label="수집한 메일 첨부 검색"
            />
            <button onClick={sync} disabled={busy}>
              {busy ? "확인 중…" : "새 첨부 가져오기"}
            </button>
          </div>
          <p className="hint">
            {state.inbox} · {state.lastSync?.finishedAt
              ? `마지막 확인 ${new Date(state.lastSync.finishedAt).toLocaleString("ko-KR")}`
              : "아직 확인하지 않음"}
          </p>
          <button className="textButton" onClick={disconnect} disabled={busy}>Google 연결 해제</button>
          <div className="mailList">
            {items.map((item) => (
              <article className="proposal" key={item.id}>
                <div className="panelTitle">
                  <strong>{item.subject}</strong>
                  <span className="badge">{label[item.status] || item.status}</span>
                </div>
                <small>{item.sender} · {item.receivedAt ? new Date(item.receivedAt).toLocaleDateString("ko-KR") : ""}</small>
                <p>{item.originalName}{item.storedName && item.storedName !== item.originalName ? ` → ${item.storedName}` : ""}</p>
                {(item.issues?.length || item.error) && (
                  <p className="hint">{item.error || item.issues?.join(" · ")}</p>
                )}
                {item.status !== "failed" && item.status !== "processing" && (
                  <div className="buttonRow">
                    <button className="secondary" onClick={() => download("mail/download", { id: item.id }, item.storedName || item.originalName)}>
                      다운로드
                    </button>
                    {item.driveUrl && <a className="button secondary" href={item.driveUrl} target="_blank" rel="noreferrer">Drive에서 보기 ↗</a>}
                  </div>
                )}
              </article>
            ))}
            {!items.length && <p className="empty">표시할 첨부가 없습니다.</p>}
          </div>
        </>
      )}
    </section>
  );
}
