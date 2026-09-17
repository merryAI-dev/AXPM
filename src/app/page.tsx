"use client";

import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { api, auth } from "@/lib/client";
import WorkspacePanel from "./workspace-panel";
import JobsPanel from "./jobs-panel";
import ReportWatch from "./report-watch";
import MasterDashboard from "./master-dashboard";
import MasterStatus from "./master-status";
import AgentActivity from "./agent-activity";
import DriveHistory from "./drive-history";
import MailIntake from "./mail-intake";

type Proposal = {
  id: string; kind: string; title: string; reason: string; evidenceIds: string[];
  status: string; fileName?: string; tab?: string; round?: number; error?: string;
};
type Run = { id: string; goal: string; summary: string; status: string; trace?: { tool: string; result: string }[] };
type State = {
  uid: string; proposals: Proposal[]; runs: Run[]; agentConfigured: boolean;
  agentRuntime: { engine: string; provider: string; model: string };
};

const tabs = [
  { id: "overview", name: "홈 대시보드", icon: "◈" },
  { id: "drive", name: "Drive · 보고서", icon: "▱" },
  { id: "automation", name: "자동 반영", icon: "↻" },
  { id: "approvals", name: "승인 대기함", icon: "◇" },
  { id: "jobs", name: "작업 이력", icon: "◎" },
];
const proposalStatus: Record<string, [string, string]> = {
  pending: ["승인 대기", "blue"], executing: ["실행 중", "blue"],
  done: ["실행 완료", "green"], rejected: ["거절", ""],
  uncertain: ["결과 확인 필요", "amber"],
};
const runStatus: Record<string, [string, string]> = {
  running: ["확인 중", "blue"], done: ["보고 완료", "green"],
  failed: ["확인 필요", "red"],
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [goal, setGoal] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  async function refresh() { setState(await api("state")); }
  useEffect(() => onAuthStateChanged(auth, (next) => {
    setUser(next); setLoaded(true);
    if (next) refresh().catch((e) => setError(e.message)); else setState(null);
  }), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function act(label: string, action: () => Promise<unknown>) {
    setBusy(label); setError(""); setNotice("");
    try { await action(); await refresh(); setNotice(`${label} 완료`); }
    catch (e) { setError(e instanceof Error ? e.message : "처리 실패"); }
    finally { setBusy(""); }
  }
  async function login() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: "mysc.co.kr" });
    await act("로그인", () => signInWithPopup(auth, provider));
  }
  async function runAgent() {
    const request = goal.trim();
    if (!request || agentBusy) return;
    setGoal(""); setAgentBusy(true); setError("");
    try { await api("agent", { goal: request }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "에이전트 실행 실패"); }
    finally { setAgentBusy(false); }
  }

  if (!loaded) return <main className="login">운영 환경을 확인하고 있습니다…</main>;
  if (!user) return (
    <main className="login">
      <section className="loginCard">
        <span className="eyebrow">AXPM OPERATIONS</span>
        <h1>멘토링 운영 에이전트</h1>
        <p>MYSC Google 계정으로 로그인해주세요.</p>
        {error && <p className="banner error">{error}</p>}
        <button className="primary" disabled={!!busy} onClick={login}>Google로 로그인</button>
      </section>
    </main>
  );

  const proposals = (state?.proposals || []).filter((proposal) => proposal.kind === "master_reversal");
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">AX<span>PM</span><small>MENTORING OPERATIONS</small></a>
        <nav>{tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? "selected" : ""} onClick={() => setTab(item.id)}>
            <span>{item.icon}</span>{item.name}
            {item.id === "approvals" && pending.length > 0 && <b>{pending.length}</b>}
          </button>
        ))}</nav>
        <div className="sideBottom"><small>운영 계정</small><p>{user.email}</p><button onClick={() => signOut(auth)}>로그아웃 ↗</button></div>
      </aside>
      <main className="main">
        <header><h1>{tabs.find((item) => item.id === tab)?.name}</h1></header>
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner success">{notice}</div>}
        <div className="contentGrid">
          <section className="content">
            {tab === "overview" && <><MasterDashboard /><AgentActivity visible /><DriveHistory visible /></>}
            {tab === "drive" && <><MailIntake /><WorkspacePanel /><DriveHistory visible /></>}
            {tab === "automation" && <><ReportWatch visible /><MasterStatus visible /></>}
            {tab === "jobs" && <JobsPanel />}
            {tab === "approvals" && (
              <section className="panel">
                <div className="panelTitle"><h2>자동 반영 취소</h2><span>{pending.length}건 대기</span></div>
                <p className="hint">보고서 탭이나 필수값이 제거된 경우에만 제안됩니다. 승인하면 에이전트가 기록한 마스터 셀만 원복합니다.</p>
                {proposals.length ? proposals.map((proposal) => (
                  <article className="proposal" key={proposal.id}>
                    <div className="panelTitle">
                      <span className="badge">자동 반영 취소</span>
                      <span className={`badge ${proposalStatus[proposal.status]?.[1] || ""}`}>{proposalStatus[proposal.status]?.[0] || proposal.status}</span>
                    </div>
                    <h3>{proposal.title}</h3><p>{proposal.reason}</p>
                    <div className="changeBox">{proposal.fileName || "멘토링 보고서"} · {proposal.tab || `${proposal.round}회차`}<strong>완료 체크·작성일·자동 메모 원복</strong></div>
                    <details><summary>판단 근거</summary>{proposal.evidenceIds.map((id) => <p key={id}>{id}</p>)}</details>
                    {proposal.error && <p className="error">{proposal.error}</p>}
                    {proposal.status === "pending" && <div className="actions">
                      <button className="secondary" disabled={!!busy} onClick={() => act("취소 제안 거절", () => api("proposal", { id: proposal.id, approve: false }))}>유지</button>
                      <button className="primary" disabled={!!busy} onClick={() => act("자동 반영 취소", () => api("proposal", { id: proposal.id, approve: true }))}>승인하고 반영 취소</button>
                    </div>}
                  </article>
                )) : <div className="emptyState"><h3>승인을 기다리는 취소 제안이 없습니다.</h3><p>보고서 변경은 자동 점검 후 이곳에 표시됩니다.</p></div>}
              </section>
            )}
          </section>
          <aside className="agentPanel">
            <div className="agentHeading"><span className="agentAvatar">✳</span><div><h2>운영 에이전트</h2><span>{state?.agentConfigured ? `${state.agentRuntime.engine} · ${state.agentRuntime.provider}` : "모델 연결 필요"}</span></div></div>
            <p className="agentIntro">마스터와 Drive 원본을 조회하고 멘토링 자동화 상태를 확인합니다.</p>
            <div className="conversation">{(state?.runs || []).slice(0, 5).map((run) => (
              <div className="exchange" key={run.id}>
                <div className="userMessage">{run.goal}</div>
                <div className="agentMessage">
                  <span className={`badge ${runStatus[run.status]?.[1] || ""}`}>{runStatus[run.status]?.[0] || run.status}</span>
                  <p>{run.summary || "원본을 확인하고 있습니다…"}</p>
                  {run.trace?.length ? <details><summary>사용한 도구 {run.trace.length}개</summary>{run.trace.map((item, index) => <small key={index}>{item.tool} · {item.result}</small>)}</details> : null}
                </div>
              </div>
            ))}</div>
            <form className="agentComposer" onSubmit={(event) => { event.preventDefault(); void runAgent(); }}>
              <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="에이전트에게 요청" />
              <button className="primary" disabled={agentBusy || !state?.agentConfigured || !goal.trim()}>{agentBusy ? "확인 중…" : "요청 ↑"}</button>
            </form>
          </aside>
        </div>
        <footer>AXPM · 멘토링 운영 에이전트</footer>
      </main>
    </div>
  );
}
