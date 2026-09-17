"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
type History = {
  events: {
    id: string;
    fileId: string;
    name: string;
    modifiedTime: string;
    observedAt: string;
    eventTime: string;
    changes: string[];
    before: { name: string } | null;
  }[];
  truncated: boolean;
  since: string;
  index: { count: number; complete: boolean } | null;
};
export default function DriveHistory({ visible }: { visible: boolean }) {
  const [data, setData] = useState<History | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      setScanning(true);
      setError("");
      try {
        const status = await api("drive/status");
        if (!status.connected)
          throw new Error(
            status.connectionError || "Drive 연결을 확인해주세요.",
          );
        const initial = await api("drive/history");
        if (active) setData(initial);
        const lastIndexed = Date.parse(status.index?.updatedAt || "");
        if (status.index?.complete && Date.now() - lastIndexed < 10 * 60_000)
          return;
        let restart = !!status.index?.complete;
        while (active) {
          let index;
          try {
            index = await api("drive/index", { restart });
          } catch (e) {
            if ((e as Error).message.includes("폴더를 조사 중")) {
              restart = false;
              await new Promise((resolve) => setTimeout(resolve, 2500));
              continue;
            }
            throw e;
          }
          restart = false;
          if (!active) return;
          window.dispatchEvent(
            new CustomEvent("axpm:drive-index", { detail: index }),
          );
          setData((current) =>
            current
              ? {
                  ...current,
                  index: { count: index.count, complete: index.complete },
                }
              : current,
          );
          if (index.complete) {
            setData(await api("drive/history"));
            break;
          }
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setScanning(false);
      }
    }
    const timer = setTimeout(load, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  if (!visible) return null;
  return (
    <section className="panel">
      <div className="panelTitle">
        <h2>최근 24시간 Drive 변경</h2>
        <span className="badge">
          {scanning
            ? `확인 중 · ${data?.index?.count || 0}개 항목`
            : "메타데이터 이력"}
        </span>
      </div>
      <p className="hint">
        최근 수정되거나 이름, 위치, 버전이 바뀐 파일을 표시합니다.
      </p>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {!data?.events.length && (
        <p>
          {scanning
            ? "최근 수정된 파일을 찾고 있습니다…"
            : error
              ? "변경 이력을 확인하지 못했습니다."
              : "확인된 범위에서 최근 24시간 변경이 없습니다."}
        </p>
      )}
      {data?.events.length ? (
        <div className="driveHistoryList">
          {data.events.map((e) => (
            <article className="fileRow" key={e.id}>
              <div className="fileInfo">
                <a
                  href={`https://drive.google.com/open?id=${encodeURIComponent(e.fileId)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.name} ↗
                </a>
                <small>
                  {e.changes.join(" · ")}
                  {e.before && e.before.name !== e.name
                    ? ` · 이전 이름: ${e.before.name}`
                    : ""}
                </small>
                <small>
                  수정{" "}
                  {e.modifiedTime
                    ? new Date(e.modifiedTime).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                      })
                    : "시각 미확인"}{" "}
                  · 확인{" "}
                  {new Date(e.observedAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {data?.truncated && <p className="hint">최신 50건까지 표시합니다.</p>}
    </section>
  );
}
