"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { masterOverview } from "@/lib/automation/master";
type Status = ReturnType<typeof masterOverview>;
export default function MasterStatus({ visible }: { visible: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<{
    defaultCampus: string;
    masterSheetTitle: string;
    masterUrl: string;
  } | null>(null);
  useEffect(() => {
    if (!visible) return;
    let active = true,
      running = false;
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      if (active) setBusy(true);
      try {
        const config = product || (await api("automation/config"));
        if (active && !product) setProduct(config);
        const result = await api(
          `automation/master?campus=${encodeURIComponent(config.defaultCampus)}`,
        );
        if (active) {
          setStatus(result);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
        if (active) setBusy(false);
      }
    }
    void refresh();
    const onUpdate = () => {
      void refresh();
    };
    window.addEventListener("axpm:master-updated", onUpdate);
    return () => {
      active = false;
      window.removeEventListener("axpm:master-updated", onUpdate);
    };
  }, [visible, product]);
  if (!visible) return null;
  return (
    <section className="panel">
      <div className="panelTitle">
        <h2>{product?.defaultCampus || "기본 캠퍼스"} · 사업관리 마스터</h2>
        <span className="badge">
          {busy ? "원본 조회 중" : "열 때·변경 후 조회"}
        </span>
      </div>
      <p className="hint">
        {product?.masterSheetTitle || "사업관리 마스터"}의 완료 체크박스와
        보고서 작성일을 기준으로 집계합니다.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          {status
            ? "아래는 마지막으로 확인한 값입니다."
            : "Drive 연결과 관리 폴더 설정을 확인해주세요."}
        </p>
      )}
      {status && (
        <>
          <div className="stats">
            {[
              ["기업", status.totals.companies],
              ["전담 완료", status.totals.dedicated],
              ["특화 완료", status.totals.specialty],
              ["보고서 미기입", status.totals.missingReports],
            ].map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>
                  {value}
                  <small>건</small>
                </strong>
              </article>
            ))}
          </div>
          <p className="hint">
            원본 확인: {new Date(status.checkedAt).toLocaleString("ko-KR")}
          </p>
          <details>
            <summary>
              기업별 완료 회차 · {status.companies.length}개 기업
            </summary>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>기업</th>
                    <th>멘토</th>
                    <th>전담 완료</th>
                    <th>특화 완료</th>
                    <th>마스터 행</th>
                  </tr>
                </thead>
                <tbody>
                  {status.companies.map((c) => (
                    <tr key={c.row}>
                      <td>{c.company}</td>
                      <td>{c.mentor}</td>
                      <td>{c.completedRounds.join(", ") || "없음"}</td>
                      <td>{c.specialtyComplete ? "완료" : "미완료"}</td>
                      <td>{c.row}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <a
        className="textButton"
        href={product?.masterUrl || "#"}
        target="_blank"
        rel="noreferrer"
      >
        마스터 원본 열기 ↗
      </a>
    </section>
  );
}
