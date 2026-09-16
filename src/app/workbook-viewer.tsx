"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SheetView } from "@/lib/workspace/sheet-view";
import type { Mapping } from "@/lib/workspace/schema";
export default function WorkbookViewer({
  view,
  mapping,
  values,
  before,
  formulas,
  anchors,
  busy,
  onChange,
}: {
  view: SheetView;
  mapping: Mapping;
  values: Record<string, string>;
  before: Record<string, string>;
  formulas: string[];
  anchors: Record<string, string>;
  busy: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const [active, setActive] = useState("");
  const [full, setFull] = useState(false),
    [scope, setScope] = useState<"report" | "sheet">("report");
  const [zoom, setZoom] = useState<number | null>(null),
    [available, setAvailable] = useState(800);
  const viewport = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null),
    fullButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setActive("");
    setZoom(null);
  }, [view.sheet]);
  useEffect(() => {
    if (!full) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFull(false);
        fullButton.current?.focus();
      }
      if (e.key === "Tab") {
        const targets = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = targets[0],
          last = targets.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handle);
    };
  }, [full]);
  const region =
    scope === "report"
      ? view.focus
      : { x: 0, y: 0, width: view.width, height: view.height };
  const scale =
    zoom ?? Math.min(1.25, Math.max(0.2, (available - 64) / region.width));
  const selected = view.cells.find((c) => c.address === active);
  const field = mapping.find((f) => (anchors[f.key] || f.cell) === active);
  const blocked =
    !field || formulas.includes(field.key) || anchors[field.key] !== field.cell;
  const displayed = field ? values[field.key] || "" : selected?.text || "";
  return (
    <section
      ref={panel}
      tabIndex={full ? -1 : undefined}
      className={`documentViewer ${full ? "documentFullscreen" : ""}`}
      role={full ? "dialog" : undefined}
      aria-modal={full || undefined}
      aria-label="보고서 문서 뷰어"
    >
      <div className="documentToolbar">
        <div className="documentModes" aria-label="표시 범위">
          <button
            className={scope === "report" ? "isActive" : ""}
            aria-pressed={scope === "report"}
            onClick={() => {
              setScope("report");
              setZoom(null);
            }}
          >
            보고서 영역
          </button>
          <button
            className={scope === "sheet" ? "isActive" : ""}
            aria-pressed={scope === "sheet"}
            onClick={() => {
              setScope("sheet");
              setZoom(null);
            }}
          >
            전체 시트
          </button>
        </div>
        <div className="documentZoom">
          <button
            aria-label="축소"
            onClick={() => setZoom(Math.max(0.25, scale - 0.1))}
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            aria-label="확대"
            onClick={() => setZoom(Math.min(2, scale + 0.1))}
          >
            ＋
          </button>
          <button onClick={() => setZoom(null)}>폭 맞춤</button>
          <button ref={fullButton} onClick={() => setFull(!full)}>
            {full ? "전체 화면 닫기" : "전체 화면"}
          </button>
        </div>
      </div>
      <div className="documentFormulaBar">
        <span className="cellAddress">{active || "셀 선택"}</span>
        <span>
          {selected
            ? (field?.label || "원본 셀") +
              (selected.formula
                ? " · 수식 셀"
                : field
                  ? " · 편집 가능"
                  : " · 읽기 전용")
            : "문서의 셀을 누르면 내용을 읽고 수정할 수 있어요"}
        </span>
        {Object.keys(values).some((k) => values[k] !== before[k]) && (
          <span className="badge">저장 전 변경</span>
        )}
      </div>
      {view.warnings.map((w) => (
        <p className="documentWarning" key={w}>
          {w}
        </p>
      ))}
      <div className="documentBody">
        <div
          ref={viewport}
          className="documentViewport"
          tabIndex={0}
          aria-label="문서 스크롤 영역"
        >
          <div
            className="documentPaper"
            style={{
              width: region.width * scale,
              height: region.height * scale,
            }}
          >
            <div
              className="documentCrop"
              style={{
                width: region.width,
                height: region.height,
                transform: `scale(${scale})`,
              }}
            >
              <div
                className="documentSheet"
                style={{
                  width: view.width,
                  height: view.height,
                  transform: `translate(${-region.x}px,${-region.y}px)`,
                }}
              >
                {view.cells
                  .filter((c) => c.width > 0 && c.height > 0)
                  .map((c) => {
                    const mapped = mapping.find(
                      (f) => (anchors[f.key] || f.cell) === c.address,
                    );
                    const changed =
                      !!mapped && values[mapped.key] !== before[mapped.key];
                    const { verticalAlign, ...style } = c.style;
                    return (
                      <button
                        type="button"
                        key={c.address}
                        data-cell={c.address}
                        aria-label={`${c.address}${mapped ? ` ${mapped.label}` : ""}`}
                        aria-pressed={active === c.address}
                        tabIndex={
                          c.x + c.width > region.x &&
                          c.x < region.x + region.width &&
                          c.y < region.height
                            ? 0
                            : -1
                        }
                        className={`documentCell ${mapped ? "mappedCell" : ""} ${changed ? "changedCell" : ""} ${active === c.address ? "selectedCell" : ""}`}
                        onClick={() => setActive(c.address)}
                        style={
                          {
                            ...style,
                            left: c.x,
                            top: c.y,
                            width: c.width,
                            height: c.height,
                            justifyContent:
                              verticalAlign === "middle"
                                ? "center"
                                : verticalAlign === "top"
                                  ? "flex-start"
                                  : "flex-end",
                          } as CSSProperties
                        }
                      >
                        <span className="documentCellText">
                          {changed
                            ? values[mapped!.key]
                            : c.runs
                              ? c.runs.map((run, i) => (
                                  <span
                                    key={i}
                                    style={run.style as CSSProperties}
                                  >
                                    {run.text}
                                  </span>
                                ))
                              : c.text}
                        </span>
                      </button>
                    );
                  })}
                {view.images.map((img, i) => (
                  <img
                    key={i}
                    src={img.src}
                    alt={`문서에 삽입된 그림 ${i + 1}`}
                    className="documentImage"
                    draggable={false}
                    style={{
                      left: img.x,
                      top: img.y,
                      width: img.width,
                      height: img.height,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        {selected && (
          <aside className="documentInspector" aria-label="선택한 셀 편집">
            <div className="panelTitle">
              <div>
                <span className="eyebrow">
                  {view.sheet} · {active}
                </span>
                <h3>{field?.label || "셀 내용"}</h3>
              </div>
              <button
                className="textButton"
                onClick={() => setActive("")}
                aria-label="셀 편집 닫기"
              >
                닫기
              </button>
            </div>
            <label htmlFor="document-cell-value">
              {blocked ? "전체 내용" : "내용 수정"}
            </label>
            <textarea
              id="document-cell-value"
              readOnly={blocked}
              disabled={busy}
              value={displayed}
              onChange={(e) => field && onChange(field.key, e.target.value)}
              placeholder="빈 셀"
            />
            <p className="hint">
              {blocked
                ? "이 셀은 읽기 전용입니다. 편집할 셀은 아래 매핑 설정에서 지정할 수 있어요."
                : "변경은 문서에 바로 표시됩니다. 편집을 마치면 변경 내용을 확인하고 저장하세요."}
            </p>
            {field && values[field.key] !== before[field.key] && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onChange(field.key, before[field.key] || "")}
              >
                이 셀 변경 되돌리기
              </button>
            )}
            {mapping.length > 0 && (
              <label>
                다른 항목
                <select
                  aria-label="편집할 항목"
                  value={field?.key || ""}
                  onChange={(e) => {
                    const f = mapping.find((f) => f.key === e.target.value);
                    if (f) setActive(anchors[f.key] || f.cell);
                  }}
                >
                  <option value="" disabled>
                    항목 선택
                  </option>
                  {mapping.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label} · {f.cell}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </aside>
        )}
      </div>
      <div className="documentStatus">
        <span>{view.sheet}</span>
        <span>셀 서식 · 병합 · 삽입 그림 기반 미리보기</span>
      </div>
    </section>
  );
}
