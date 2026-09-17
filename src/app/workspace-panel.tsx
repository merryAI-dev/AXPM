"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import WorkbookViewer from "./workbook-viewer";
import type { SheetView } from "@/lib/workspace/sheet-view";
import { defaultMapping, fieldLabels } from "@/lib/report-fields";
import {
  FOLDER,
  SHEET,
  XLSX,
  type DriveFile,
  type Mapping,
  type Command,
} from "@/lib/workspace/schema";
type EditorData = {
  view?: SheetView;
  file: { id: string; name: string; mimeType?: string };
  version: string;
  sheets: { name: string; rows: number; columns: number }[];
  values: Record<string, string>;
  anchors: Record<string, string>;
  formulas: string[];
  profile?: { sheet: string; mapping: Mapping } | null;
};
const initialMapping = (): Mapping =>
  Object.entries(defaultMapping).map(([key, cell]) => ({
    key,
    label: fieldLabels[key],
    cell,
  }));
export async function download(path: string, body: unknown, name: string) {
  const blob = await api(path, body, true),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function WorkspacePanel() {
  const [status, setStatus] = useState<{
    config: { rootId: string; label: string } | null;
    connected: boolean;
    connectionError?: string;
    index: {
      count: number;
      folders: number;
      complete: boolean;
      remainingFolders: number;
    } | null;
  } | null>(null);
  const [root, setRoot] = useState(""),
    [rootLabel, setRootLabel] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]),
    [next, setNext] = useState("");
  const [trashed, setTrashed] = useState(false),
    [query, setQuery] = useState(""),
    [searchMode, setSearchMode] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ id: string } | null>(null);
  const [action, setAction] = useState<{
      kind:
        | "folder.create"
        | "file.rename"
        | "file.copy"
        | "file.trash"
        | "file.restore";
      file?: DriveFile;
    } | null>(null),
    [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState("");
  const activeRoot = status?.connected ? status.config?.rootId : undefined;
  const parent = trail.at(-1)?.id || status?.config?.rootId || "";
  async function refresh() {
    const s = await api("drive/status");
    setStatus(s);
    setRoot(s.config?.rootId || "");
    setRootLabel(s.config?.label || "");
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!activeRoot) return;
    let cancelled = false;
    setLoading(true);
    setFiles([]);
    setQuery("");
    setTrashed(false);
    const breadcrumb = [{ id: activeRoot, name: status!.config!.label }];
    api(`drive/list?parent=${encodeURIComponent(activeRoot)}`)
      .then((data) => {
        if (cancelled) return;
        setFiles(data.files);
        setTrail(breadcrumb);
        setNext(data.nextPageToken);
        setSearchMode(false);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRoot]);
  useEffect(() => {
    const update = (event: Event) => {
      const index = (event as CustomEvent).detail;
      setIndexing(!index.complete);
      setStatus((s) => (s ? { ...s, index } : s));
    };
    window.addEventListener("axpm:drive-index", update);
    return () => window.removeEventListener("axpm:drive-index", update);
  }, []);
  async function browse(
    id: string,
    breadcrumb: typeof trail,
    pageToken = "",
    trash = trashed,
  ) {
    const data = await api(
      `drive/list?parent=${encodeURIComponent(id)}&pageToken=${encodeURIComponent(pageToken)}&trashed=${trash}`,
    );
    setFiles(pageToken ? (prev) => [...prev, ...data.files] : data.files);
    setNext(data.nextPageToken);
    setTrail(breadcrumb);
    setSearchMode(false);
  }
  async function search(cursor = "") {
    if (!query.trim()) {
      await browse(
        status!.config!.rootId,
        [{ id: status!.config!.rootId, name: status!.config!.label }],
        "",
        false,
      );
      setTrashed(false);
      return;
    }
    const matches: DriveFile[] = [];
    let nextCursor = cursor;
    do {
      const data = await api(
        `drive/search?q=${encodeURIComponent(query.trim())}&cursor=${encodeURIComponent(nextCursor)}`,
      );
      matches.push(...data.files);
      nextCursor = data.nextCursor;
    } while (nextCursor && matches.length < 100);
    setFiles(cursor ? (prev) => [...prev, ...matches] : matches);
    setNext(nextCursor);
    setSearchMode(true);
    setTrashed(false);
    setTrail([{ id: status!.config!.rootId, name: status!.config!.label }]);
    setNotice(
      status?.index?.complete
        ? "사업 폴더 전체에서 이름으로 검색했습니다."
        : "하위 폴더를 읽고 있습니다. 검색 목록이 준비되면 다시 검색할 수 있어요.",
    );
  }
  async function propose() {
    if (!action) return;
    const f = action.file;
    const command =
      action.kind === "folder.create"
        ? { kind: action.kind, parentId: parent, name }
        : {
            kind: action.kind,
            fileId: f!.id,
            version: f!.version,
            ...(action.kind === "file.rename" || action.kind === "file.copy"
              ? { name }
              : {}),
            ...(action.kind === "file.copy" ? { parentId: parent } : {}),
          };
    await api("drive/propose", {
      command,
      reason: "운영자가 파일 관리 화면에서 요청한 변경",
      requestId: crypto.randomUUID(),
    });
    setAction(null);
    setNotice(
      "변경안을 저장했습니다. 작업 센터에서 내용을 확인하고 승인해주세요.",
    );
  }
  if (editor)
    return (
      <WorkbookEditor
        id={editor.id}
        onClose={() => {
          setEditor(null);
          refresh().catch((e) => setError(e.message));
        }}
      />
    );
  return (
    <div className="workspacePanel">
      <section className="workspaceHero">
        <div>
          <span className="eyebrow">사업 운영 워크스페이스</span>
          <h2>파일을 찾고, 다음 업무로 이어가세요</h2>
          <p>기존 Drive는 그대로 사용하고, 필요한 변경은 확인한 뒤 반영해요.</p>
        </div>
        <div className="connectionMark">
          <span className={`badge ${status?.connected ? "green" : ""}`}>
            {!status
              ? "Drive 연결 확인 중"
              : status.connected
                ? "Drive 연결됨"
                : "Drive 연결 확인 필요"}
          </span>
          <small>
            {status?.connected
              ? status.config?.label
              : status?.connectionError ||
                "사업 폴더 접근 권한을 확인하고 있습니다."}
          </small>
        </div>
      </section>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner success" role="status">
          {notice}
        </p>
      )}
      <details className="panel">
        <summary>
          관리 폴더 설정 · {status?.config?.label || "연결 필요"}
        </summary>
        <div className="driveConfig">
          <label>
            폴더 이름
            <input
              value={rootLabel}
              onChange={(e) => setRootLabel(e.target.value)}
            />
          </label>
          <label>
            Drive 폴더 URL 또는 ID
            <input
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </label>
          <button
            className="secondary"
            disabled={busy || !root.trim()}
            onClick={() =>
              act(async () => {
                await api("drive/config", { rootId: root, label: rootLabel });
                setFiles([]);
                setTrail([]);
                setNext("");
                await refresh();
                setNotice(
                  "관리 폴더 설정을 저장했습니다. 연결 후 접근을 확인할 수 있어요.",
                );
              })
            }
          >
            설정 저장
          </button>
        </div>
        <div className="toolbar">
          <button
            className="primary"
            disabled={busy || !status?.connected || !status.config}
            onClick={() =>
              act(() =>
                browse(status!.config!.rootId, [
                  { id: status!.config!.rootId, name: rootLabel },
                ]),
              )
            }
          >
            폴더 열기
          </button>
          <button
            className="secondary"
            disabled={busy || indexing || !status?.connected || !status.config}
            onClick={() =>
              act(async () => {
                let index = await api("drive/index", {
                  restart: !status?.index || status.index.complete,
                });
                while (!index.complete)
                  index = await api("drive/index", { restart: false });
                await refresh();
              })
            }
          >
            {status?.index && !status.index.complete
              ? "폴더 조사 계속"
              : "전체 폴더 조사"}
          </button>
          {status?.index && (
            <small>
              조사한 항목 {status.index.count}개 ·{" "}
              {status.index.complete
                ? "조사 완료"
                : `남은 폴더 ${status.index.remainingFolders}개`}
            </small>
          )}
        </div>
      </details>
      <section className="panel" aria-busy={loading || busy}>
        <div className="panelTitle">
          <h2>사업 폴더 · 파일 탐색</h2>
          <label className="inlineCheck">
            <input
              type="checkbox"
              checked={trashed}
              onChange={(e) => {
                const v = e.target.checked;
                setTrashed(v);
                if (parent && status?.connected)
                  act(() => browse(parent, trail, "", v));
              }}
            />
            현재 폴더 휴지통
          </label>
        </div>
        <p className="hint" role="status">
          {indexing
            ? `검색 목록 준비 중 · ${status?.index?.count || 0}개 파일·폴더`
            : status?.index?.complete
              ? `전체 ${status.index.count}개 파일·폴더 검색 가능`
              : "폴더를 선택하면 하위 구조를 바로 볼 수 있습니다."}
        </p>
        {indexError && (
          <p className="banner error">
            검색 목록 준비 실패: {indexError} · 관리 폴더 설정에서 다시 조사할
            수 있습니다.
          </p>
        )}
        <nav className="breadcrumbs" aria-label="폴더 경로">
          {trail.map((f, i) => (
            <button
              key={f.id}
              disabled={busy}
              onClick={() => act(() => browse(f.id, trail.slice(0, i + 1)))}
            >
              {f.name} {i < trail.length - 1 && "›"}
            </button>
          ))}
        </nav>
        <div className="toolbar">
          <input
            aria-label="사업 폴더 전체 이름 검색"
            placeholder="전체 폴더에서 기업명·파일명 검색"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && status?.connected) {
                e.preventDefault();
                void act(() => search());
              }
            }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="secondary"
            disabled={busy || loading || !status?.connected}
            onClick={() => act(() => search())}
          >
            검색
          </button>
          <button
            className="secondary"
            disabled={
              busy || !parent || !status?.connected || trashed || searchMode
            }
            onClick={() => {
              setAction({ kind: "folder.create" });
              setName("");
            }}
          >
            새 폴더
          </button>
        </div>
        {loading ? (
          <div className="emptyState" role="status">
            폴더와 파일을 불러오는 중…
          </div>
        ) : !files.length ? (
          <div className="emptyState">
            <span className="emptyIcon" aria-hidden="true">
              ▱
            </span>
            <h3>
              {!status?.connected
                ? "연결하면 실제 파일을 불러옵니다"
                : searchMode
                  ? "검색 결과가 없습니다"
                  : "빈 폴더입니다"}
            </h3>
            <p>
              {!status?.connected
                ? "예시 파일이나 예상 건수를 실제 현황으로 표시하지 않습니다."
                : searchMode
                  ? indexing
                    ? "검색 목록을 준비 중입니다. 잠시 후 다시 검색해주세요."
                    : "다른 기업명이나 파일명으로 검색해보세요."
                  : "상위 폴더로 이동하거나 새 폴더를 만들 수 있습니다."}
            </p>
          </div>
        ) : (
          <div className="fileList">
            {files.map((f) => (
              <article key={f.id} className="fileRow">
                <span
                  className={`fileIcon ${f.mimeType === FOLDER ? "folder" : ""}`}
                  aria-hidden="true"
                >
                  {f.mimeType === FOLDER ? "▱" : "▤"}
                </span>
                <div className="fileInfo">
                  <button
                    className="fileName"
                    disabled={
                      busy ||
                      f.trashed ||
                      ![FOLDER, SHEET, XLSX].includes(f.mimeType)
                    }
                    onClick={() =>
                      f.mimeType === FOLDER
                        ? act(() =>
                            browse(f.id, [
                              ...trail,
                              { id: f.id, name: f.name },
                            ]),
                          )
                        : setEditor({ id: f.id })
                    }
                  >
                    {f.name}
                  </button>
                  <small>
                    {f.mimeType === FOLDER
                      ? "폴더"
                      : f.mimeType === SHEET
                        ? "Google Sheets"
                        : f.mimeType === XLSX
                          ? "Excel"
                          : "원본에서 내용 확인"}{" "}
                    ·{" "}
                    {f.modifiedTime
                      ? new Date(f.modifiedTime).toLocaleDateString("ko-KR")
                      : "수정일 미확인"}
                  </small>
                </div>
                <div className="fileActions">
                  {!f.trashed && (
                    <a
                      className="textButton"
                      href={`https://drive.google.com/open?id=${encodeURIComponent(f.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      원본 ↗
                    </a>
                  )}
                  {(f.trashed
                    ? ["file.restore"]
                    : [
                        "file.rename",
                        ...(f.mimeType !== FOLDER && !searchMode
                          ? ["file.copy"]
                          : []),
                        "file.trash",
                      ]
                  ).map((kind) => (
                    <button
                      key={kind}
                      className="textButton"
                      disabled={busy}
                      onClick={() => {
                        setAction({
                          kind: kind as NonNullable<typeof action>["kind"],
                          file: f,
                        });
                        setName(
                          kind === "file.copy" ? `${f.name} 사본` : f.name,
                        );
                      }}
                    >
                      {
                        (
                          {
                            "file.restore": "복원",
                            "file.rename": "이름 변경",
                            "file.copy": "복사",
                            "file.trash": "휴지통",
                          } as Record<string, string>
                        )[kind]
                      }
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
        {next && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              act(() =>
                searchMode ? search(next) : browse(parent, trail, next),
              )
            }
          >
            다음 항목 보기
          </button>
        )}
        {action && (
          <div className="reviewBox" role="region" aria-label="파일 변경안">
            <h3>변경안 만들기</h3>
            <p>{action.file?.name || "새 폴더"}</p>
            {["file.rename", "file.copy", "folder.create"].includes(
              action.kind,
            ) ? (
              <label>
                새 이름
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            ) : (
              <p>
                {action.kind === "file.trash"
                  ? "휴지통으로 이동할 변경안을 만듭니다. 폴더라면 하위 항목도 영향을 받습니다."
                  : "원래 폴더로 복원할 변경안을 만듭니다."}
              </p>
            )}
            <div className="toolbar">
              <button
                className="primary"
                disabled={busy}
                onClick={() => act(propose)}
              >
                변경안 저장
              </button>
              <button className="secondary" onClick={() => setAction(null)}>
                취소
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
export function WorkbookEditor({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<EditorData | null>(null),
    [sheet, setSheet] = useState(""),
    [mapping, setMapping] = useState<Mapping>(initialMapping);
  const [before, setBefore] = useState<Record<string, string>>({}),
    [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState(false),
    [loadedKey, setLoadedKey] = useState("");
  const key = JSON.stringify({ sheet, mapping }),
    readReady = loadedKey === key;
  const changes = mapping.filter((f) => before[f.key] !== values[f.key]);
  const requestEpoch = useRef(0);
  async function read(selected?: {
    sheet: string;
    mapping: Mapping;
  }): Promise<EditorData> {
    return api("drive/read", { fileId: id, selected, preview: !!selected });
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const epoch = ++requestEpoch.current;
    act(async () => {
      const d = await read();
      if (epoch !== requestEpoch.current) return;
      setData(d);
      const profile = await api(`drive/profile?id=${encodeURIComponent(id)}`);
      if (epoch !== requestEpoch.current) return;
      const selected = {
        sheet: profile?.sheet || d.sheets[0]?.name || "",
        mapping: profile?.mapping || initialMapping(),
      };
      setSheet(selected.sheet);
      setMapping(selected.mapping);
      const loaded = await read(selected);
      if (epoch !== requestEpoch.current) return;
      setData(loaded);
      setBefore(loaded.values);
      setValues(loaded.values);
      setLoadedKey(JSON.stringify(selected));
    });
    return () => {
      requestEpoch.current++;
    };
  }, [id]);
  async function load(selected = { sheet, mapping }) {
    const d = await read(selected);
    setData(d);
    setBefore(d.values);
    setValues(d.values);
    setLoadedKey(JSON.stringify(selected));
    setReview(false);
  }
  async function save() {
    if (!readReady || !data) throw new Error("셀을 다시 읽어주세요.");
    const p = { sheet, mapping, version: data.version, before, after: values };
    await api("drive/propose", {
      command: { kind: "cells.update", fileId: id, ...p },
      reason: "운영자가 보고서 편집 화면에서 검토한 셀 변경",
      requestId: crypto.randomUUID(),
    });
    setNotice(
      "셀 변경안을 작업 센터에 저장했습니다. 승인 후 Drive에 반영됩니다.",
    );
    setReview(false);
  }
  return (
    <div className="workspacePanel">
      <button
        className="textButton"
        onClick={() => {
          if (
            changes.length &&
            readReady &&
            !window.confirm("저장하지 않은 변경을 닫을까요?")
          )
            return;
          onClose();
        }}
      >
        ← 파일 목록
      </button>
      <section className="workspaceHero">
        <div>
          <span className="eyebrow">셀 기반 보고서 편집</span>
          <h2 className="editorTitle">{data?.file.name || "파일 읽는 중"}</h2>
          <p>Drive 원본 · 승인 후 저장</p>
        </div>
      </section>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="banner success">
          {notice}
        </p>
      )}
      <div className="documentSheetPicker">
        <label>
          시트
          <select
            aria-label="보고서 시트"
            value={sheet}
            disabled={busy}
            onChange={(e) => {
              if (
                changes.length &&
                readReady &&
                !window.confirm("저장하지 않은 변경을 닫고 시트를 바꿀까요?")
              )
                return;
              const nextSheet = e.target.value;
              setSheet(nextSheet);
              setReview(false);
              act(() => load({ sheet: nextSheet, mapping }));
            }}
          >
            {data?.sheets.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <span className="hint">
          {busy
            ? "원본 문서를 읽고 있어요…"
            : "문서에서 수정할 셀을 선택하세요"}
        </span>
      </div>
      {readReady && data?.view ? (
        <WorkbookViewer
          view={data.view}
          mapping={mapping}
          values={values}
          before={before}
          anchors={data.anchors}
          formulas={data.formulas}
          busy={busy}
          onChange={(key, value) => {
            setValues((prev) => ({ ...prev, [key]: value }));
            setReview(false);
          }}
        />
      ) : (
        <div className="panel emptyState">
          <p>
            {busy
              ? "문서를 불러오는 중…"
              : "매핑 설정에서 시트와 셀을 읽어주세요."}
          </p>
        </div>
      )}
      {readReady && (
        <div className="documentSaveBar">
          <span>
            {changes.length
              ? `수정한 셀 ${changes.length}개 · 아직 저장하지 않았어요`
              : "저장된 원본을 보고 있어요"}
          </span>
          <button
            className="primary"
            disabled={busy || !changes.length}
            onClick={() => setReview(true)}
          >
            변경 {changes.length}개 확인
          </button>
        </div>
      )}
      <details className="panel documentMapping">
        <summary>셀 매핑 설정 · {mapping.length}개 항목</summary>
        <div className="panelTitle">
          <h2>시트와 셀 지정</h2>
          <span className="badge">파일별 매핑</span>
        </div>
        <p>
          처음 표시되는 주소는 제공한 보고서 양식 기준입니다. 다른 양식이라면
          주소를 고친 뒤 셀을 읽어주세요.
        </p>
        <label>
          시트
          <select
            value={sheet}
            disabled={busy}
            onChange={(e) => {
              setSheet(e.target.value);
              setReview(false);
            }}
          >
            {data?.sheets.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="mappingGrid">
          {mapping.map((f, i) => (
            <div key={f.key} className="mappingItem">
              <input
                aria-label={`필드 ${i + 1} 이름`}
                disabled={busy}
                value={f.label}
                onChange={(e) =>
                  setMapping(
                    mapping.map((v, n) =>
                      n === i ? { ...v, label: e.target.value } : v,
                    ),
                  )
                }
              />
              <input
                aria-label={`${f.label} 셀 주소`}
                disabled={busy}
                value={f.cell}
                onChange={(e) =>
                  setMapping(
                    mapping.map((v, n) =>
                      n === i
                        ? { ...v, cell: e.target.value.toUpperCase() }
                        : v,
                    ),
                  )
                }
              />
              <button
                className="textButton"
                aria-label={`${f.label} 매핑 삭제`}
                disabled={busy || mapping.length === 1}
                onClick={() => setMapping(mapping.filter((_, n) => n !== i))}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
        <div className="toolbar">
          <button
            className="secondary"
            disabled={busy || mapping.length >= 50}
            onClick={() =>
              setMapping([
                ...mapping,
                { key: crypto.randomUUID(), label: "새 필드", cell: "A1" },
              ])
            }
          >
            필드 추가
          </button>
          <button
            className="primary"
            disabled={busy || !sheet}
            onClick={() => act(() => load())}
          >
            {busy ? "읽는 중…" : "지정한 셀 읽기"}
          </button>
          <button
            className="secondary"
            disabled={busy || !readReady}
            onClick={() =>
              act(async () => {
                await api("drive/profile", { fileId: id, sheet, mapping });
                setNotice("이 파일의 매핑을 저장했습니다.");
              })
            }
          >
            매핑 저장
          </button>
        </div>
      </details>
      {review && readReady && (
        <section className="panel">
          <h2>변경 내용 확인</h2>
          <div className="diffList">
            {changes.map((f) => (
              <article key={f.key}>
                <strong>
                  {f.label} · {f.cell}
                </strong>
                <div className="diffColumns">
                  <div>
                    <small>현재 값</small>
                    <p>{before[f.key] || "(빈 셀)"}</p>
                  </div>
                  <div>
                    <small>변경할 값</small>
                    <p>{values[f.key] || "(빈 셀)"}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <button className="primary" disabled={busy} onClick={() => act(save)}>
            변경안 저장
          </button>
        </section>
      )}
      {data?.file.mimeType === XLSX && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            act(() =>
              download("drive/download", { fileId: id }, data.file.name),
            )
          }
        >
          Drive에 저장된 XLSX 다운로드
        </button>
      )}
    </div>
  );
}
