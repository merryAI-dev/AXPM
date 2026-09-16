"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { defaultMapping, fieldLabels } from "@/lib/report-fields";
import {
  FOLDER,
  SHEET,
  XLSX,
  type DriveFile,
  type Mapping,
  type Command,
} from "@/lib/workspace/schema";
type LocalFile = {
  id: string;
  name: string;
  version: string;
  updatedAt: string;
};
type EditorData = {
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
    index: {
      count: number;
      folders: number;
      complete: boolean;
      remainingFolders: number;
    } | null;
  } | null>(null);
  const [root, setRoot] = useState(""),
    [rootLabel, setRootLabel] = useState("사업 공유 폴더");
  const [files, setFiles] = useState<DriveFile[]>([]),
    [locals, setLocals] = useState<LocalFile[]>([]);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]),
    [next, setNext] = useState("");
  const [trashed, setTrashed] = useState(false),
    [query, setQuery] = useState(""),
    [searchMode, setSearchMode] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{
    id: string;
    source: "drive" | "local";
  } | null>(null);
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
  const parent = trail.at(-1)?.id || status?.config?.rootId || "";
  async function refresh() {
    const [s, l] = await Promise.all([api("drive/status"), api("workbooks")]);
    setStatus(s);
    setLocals(l);
    setRoot(s.config?.rootId || "");
    setRootLabel(s.config?.label || "사업 공유 폴더");
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
    refresh().catch((e) => setError(e.message));
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
    const data = await api(
      `drive/search?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`,
    );
    setFiles(cursor ? (prev) => [...prev, ...data.files] : data.files);
    setNext(data.nextCursor);
    setSearchMode(true);
    setNotice(
      `폴더 조사본에서 검색했습니다. ${data.complete ? "조사 완료" : "조사 중인 범위의 결과"}`,
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
        source={editor.source}
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
          <h2>
            파일을 찾고,
            <br />
            다음 업무로 이어가세요
          </h2>
          <p>기존 Drive는 그대로 사용하고, 필요한 변경은 확인한 뒤 반영해요.</p>
        </div>
        <div className="connectionMark">
          <span className={`badge ${status?.connected ? "green" : ""}`}>
            {status?.connected ? "Drive 권한 연결됨" : "Drive 연결 보류"}
          </span>
          <small>연결 전에는 업로드한 엑셀을 편집할 수 있어요</small>
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
      <section className="panel">
        <div className="panelTitle">
          <h2>관리할 폴더</h2>
          <span className="badge">설정과 접근 권한은 별도</span>
        </div>
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
            disabled={busy || !status?.connected || !status.config}
            onClick={() =>
              act(async () => {
                await api("drive/index", {
                  restart: !status?.index || status.index.complete,
                });
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
      </section>
      <section className="panel">
        <div className="panelTitle">
          <h2>Drive 파일</h2>
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
            aria-label="조사한 파일 이름 검색"
            placeholder="조사한 파일 이름으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="secondary"
            disabled={busy || !status?.connected}
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
        {!files.length ? (
          <div className="emptyState">
            <span className="emptyIcon" aria-hidden="true">
              ▱
            </span>
            <h3>
              {!status?.connected
                ? "연결하면 실제 파일을 불러옵니다"
                : "표시할 파일이 없습니다"}
            </h3>
            <p>
              {!status?.connected
                ? "예시 파일이나 예상 건수를 실제 현황으로 표시하지 않습니다."
                : "폴더를 열거나 조사한 파일을 검색해주세요."}
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
                        : setEditor({ id: f.id, source: "drive" })
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
      <section className="panel">
        <div className="panelTitle">
          <h2>업로드한 엑셀 편집</h2>
          <span className="badge">Drive 연결 없이 사용</span>
        </div>
        <p>
          원본 파일의 셀을 읽고 수정합니다. 저장한 파일은 이 운영실에 보관되며
          Drive 원본에는 반영되지 않습니다.
        </p>
        <label className="uploadBox">
          보고서 XLSX 업로드
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                act(async () => {
                  const form = new FormData();
                  form.set("file", f);
                  const result = await api("workbooks/upload", form);
                  await refresh();
                  setEditor({ id: result.id, source: "local" });
                });
              e.target.value = "";
            }}
          />
        </label>
        {!locals.length && (
          <p className="hint">아직 업로드한 파일이 없습니다.</p>
        )}
        {locals.map((f) => (
          <article key={f.id} className="fileRow">
            <span className="fileIcon" aria-hidden="true">
              ▤
            </span>
            <div className="fileInfo">
              <button
                className="fileName"
                onClick={() => setEditor({ id: f.id, source: "local" })}
              >
                {f.name}
              </button>
              <small>
                업로드 사본 · {new Date(f.updatedAt).toLocaleString("ko-KR")}
              </small>
            </div>
            <button
              className="secondary"
              onClick={() => setEditor({ id: f.id, source: "local" })}
            >
              편집
            </button>
            <button
              className="secondary"
              disabled={busy || !status?.connected || !parent}
              onClick={() =>
                act(async () => {
                  await api("drive/propose", {
                    command: {
                      kind: "workbook.publish",
                      parentId: parent,
                      name: f.name,
                      workbookId: f.id,
                      version: f.version,
                    },
                    reason: "업로드한 엑셀을 현재 관리 폴더에 새 파일로 게시",
                    requestId: crypto.randomUUID(),
                  });
                  setNotice("엑셀 게시 변경안을 작업 센터에 저장했습니다.");
                })
              }
            >
              Drive 게시
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
export function WorkbookEditor({
  source,
  id,
  onClose,
}: {
  source: "drive" | "local";
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
    return source === "local"
      ? api("workbooks/read", { id, selected })
      : api("drive/read", { fileId: id, selected });
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
      let profile = d.profile;
      if (source === "drive")
        profile = await api(`drive/profile?id=${encodeURIComponent(id)}`);
      setSheet(profile?.sheet || d.sheets[0]?.name || "");
      if (profile) setMapping(profile.mapping);
    });
    return () => {
      requestEpoch.current++;
    };
  }, [id, source]);
  async function load() {
    const selected = { sheet, mapping };
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
    if (source === "local") {
      await api("workbooks/save", { id, ...p });
      await load();
      setNotice("셀 저장과 생성 파일 검증을 마쳤습니다. 다운로드할 수 있어요.");
    } else {
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
          <p>
            {source === "local"
              ? "업로드 사본 · 원본 양식 보존"
              : "Drive 원본 · 승인 후 저장"}
          </p>
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
      <section className="panel">
        <div className="panelTitle">
          <h2>1. 시트와 셀 지정</h2>
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
            onClick={() => act(load)}
          >
            {busy ? "읽는 중…" : "지정한 셀 읽기"}
          </button>
          {source === "drive" && (
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
          )}
        </div>
      </section>
      <section className="panel">
        <h2>2. 내용 편집</h2>
        {!readReady ? (
          <div className="emptyState">
            <p>시트와 셀을 지정하고 ‘지정한 셀 읽기’를 눌러주세요.</p>
          </div>
        ) : (
          <>
            <div className="editorFields">
              {mapping.map((f) => {
                const blocked =
                  data?.formulas.includes(f.key) ||
                  data?.anchors[f.key] !== f.cell;
                return (
                  <label key={f.key}>
                    {f.label}
                    <small>
                      {sheet}!{f.cell}
                      {blocked && " · 수식/병합 셀: 주소를 확인해주세요"}
                    </small>
                    <textarea
                      disabled={busy || blocked}
                      rows={
                        f.key === "discussion" ||
                        (values[f.key]?.length || 0) > 120
                          ? 5
                          : 2
                      }
                      value={values[f.key] || ""}
                      onChange={(e) => {
                        setValues({ ...values, [f.key]: e.target.value });
                        setReview(false);
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <button
              className="primary"
              disabled={busy || !changes.length}
              onClick={() => setReview(true)}
            >
              변경 {changes.length}개 확인
            </button>
          </>
        )}
      </section>
      {review && readReady && (
        <section className="panel">
          <h2>3. 변경 내용 확인</h2>
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
            {source === "local" ? "확인한 셀 저장" : "변경안 저장"}
          </button>
        </section>
      )}
      {source === "drive" && data?.file.mimeType === XLSX && (
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
      {source === "local" && (
        <button
          className="secondary"
          disabled={busy || !data}
          onClick={() =>
            act(() =>
              download(
                "workbooks/download",
                { id },
                data?.file.name || "report.xlsx",
              ),
            )
          }
        >
          저장된 XLSX 다운로드
        </button>
      )}
    </div>
  );
}
