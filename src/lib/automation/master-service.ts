import { dashboardSummary, type DashboardData } from "./dashboard";
import { randomUUID } from "node:crypto";
import { google, type sheets_v4 } from "googleapis";
import { db, userDoc, ApiError } from "../firebase";
import { googleClient } from "../google";
import { workspace } from "../workspace/drive";
import { SHEET } from "../workspace/schema";
import { digest } from "./blueprint";
import { publicProductConfig } from "../product-config";
import {
  MASTER,
  masterOverview,
  hasMasterReceipt,
  masterRequestSchema,
  planMaster,
  planMasterReversal,
  type MasterGrid,
} from "./master";

async function connection(uid: string) {
  const ws = await workspace(uid);
  const file = await ws.scoped(MASTER.spreadsheetId);
  if (file.mimeType !== SHEET)
    throw new Error("대상 마스터가 Google 시트가 아닙니다.");
  const api = google.sheets({
    version: "v4",
    auth: await googleClient(uid, "drive"),
    timeout: 30000,
  });
  async function readOnce(): Promise<MasterGrid> {
    const before = await ws.scoped(MASTER.spreadsheetId);
    const { data: metadata } = await api.spreadsheets.get({
      spreadsheetId: MASTER.spreadsheetId,
      fields: "sheets(properties)",
    });
    const properties = metadata.sheets?.find(
      (s) => s.properties?.sheetId === MASTER.sheetId,
    )?.properties;
    const rowCount = properties?.gridProperties?.rowCount || 0;
    if (properties?.title !== MASTER.title || rowCount < 6 || rowCount > 1000)
      throw new Error("마스터 탭 또는 조회 범위(최대 1,000행)를 확인해주세요.");
    const { data } = await api.spreadsheets.get({
      spreadsheetId: MASTER.spreadsheetId,
      ranges: [`'${MASTER.title}'!A1:AB${rowCount}`],
      fields:
        "sheets(properties,merges,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,effectiveFormat(numberFormat),dataValidation))))",
    });
    const sheet = data.sheets?.find(
      (s) =>
        s.properties?.sheetId === MASTER.sheetId &&
        s.properties.title === MASTER.title,
    );
    if (!sheet) throw new Error("지정된 사업관리현황 탭을 찾을 수 없습니다.");
    if ((sheet.properties?.gridProperties?.rowCount || 0) > 1000)
      throw new Error(
        "마스터 행이 1,000행을 넘었습니다. 조회 범위를 확장한 뒤 실행해주세요.",
      );
    const rows: MasterGrid["rows"] = [];
    for (const block of sheet.data || [])
      for (const [offset, row] of (block.rowData || []).entries()) {
        const index = (block.startRow || 0) + offset;
        rows[index] = (row.values || []).map((c, col) => ({
          value:
            c.effectiveValue?.boolValue ??
            c.effectiveValue?.numberValue ??
            c.effectiveValue?.stringValue ??
            null,
          ...(c.userEnteredValue?.formulaValue
            ? { formula: c.userEnteredValue.formulaValue }
            : {}),
          ...(c.effectiveFormat?.numberFormat
            ? { numberFormat: c.effectiveFormat.numberFormat }
            : {}),
          checkbox: c.dataValidation?.condition?.type === "BOOLEAN",
          merged: (sheet.merges || []).some(
            (m) =>
              index >= (m.startRowIndex || 0) &&
              index < m.endRowIndex! &&
              col >= (m.startColumnIndex || 0) &&
              col < m.endColumnIndex!,
          ),
        }));
      }
    const after = await ws.scoped(MASTER.spreadsheetId);
    if (before.version !== after.version)
      throw new ApiError(
        409,
        "조회 중 마스터가 변경되었습니다. 다시 읽어주세요.",
      );
    return { rows, version: after.version };
  }
  async function read(): Promise<MasterGrid> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await readOnce();
      } catch (error) {
        if (
          attempt >= 2 ||
          !(error instanceof Error) ||
          !error.message.includes("조회 중 마스터가 변경")
        )
          throw error;
      }
    }
  }
  return { api, ws, file, read };
}
export async function inspectDashboard(uid: string): Promise<DashboardData> {
  const conn = await connection(uid);
  const before = await conn.ws.scoped(MASTER.spreadsheetId);
  const { data } = await conn.api.spreadsheets.get({
    spreadsheetId: MASTER.spreadsheetId,
    ranges: [`'${MASTER.title}'!${MASTER.dashboardRange}`],
    fields:
      "sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue))))",
  });
  const sheet = data.sheets?.find(
    (s) =>
      s.properties?.sheetId === MASTER.sheetId &&
      s.properties.title === MASTER.title,
  );
  if (!sheet) throw new Error("대시보드 원본 탭을 찾을 수 없습니다.");
  const rows: DashboardData["rows"] = Array.from({ length: 33 }, () =>
    Array.from({ length: 10 }, () => ({ text: "" })),
  );
  for (const block of sheet.data || [])
    for (const [r, row] of (block.rowData || []).entries())
      for (const [c, cell] of (row.values || []).entries()) {
        const ri = (block.startRow || 0) + r - 97,
          ci = (block.startColumn || 0) + c - 9;
        if (ri >= 0 && ri < 33 && ci >= 0 && ci < 10)
          rows[ri][ci] = {
            text: cell.formattedValue ?? "",
            ...(cell.userEnteredValue?.formulaValue
              ? { formula: cell.userEnteredValue.formulaValue }
              : {}),
          };
      }
  await conn.ws.expect(MASTER.spreadsheetId, before.version);
  if (
    rows[8][0].text !== "total(1~4회)" ||
    rows[18][0].text !== "사업 총 신청 기업"
  )
    throw new Error(
      "마스터 대시보드 양식이 변경되었습니다. 셀 매핑을 확인해주세요.",
    );
  return {
    rows,
    checkedAt: new Date().toISOString(),
    spreadsheetId: MASTER.spreadsheetId,
    sheetId: MASTER.sheetId,
    range: `${MASTER.title}!${MASTER.dashboardRange}`,
    product: publicProductConfig(),
  };
}
export async function inspectMaster(
  uid: string,
  campus?: string,
  includeDashboard = true,
) {
  const overview = masterOverview(await (await connection(uid)).read(), campus);
  return {
    ...overview,
    ...(!campus && includeDashboard
      ? {
          dashboard: dashboardSummary(await inspectDashboard(uid)),
          instruction:
            `전체 사업 실적 보고는 dashboard의 ${MASTER.dashboardRange} 요약 셀을 기준으로 하세요. totals는 기업 행 체크박스 재집계입니다. 서로 다르면 두 기준과 차이를 명시하세요.`,
        }
      : {}),
  };
}
export async function reconcileMasterEvent(uid: string, eventId: string) {
  const ref = userDoc(uid).collection("masterEvents").doc(digest(eventId));
  const previous = (await ref.get()).data();
  if (!previous || previous.status === "verified") return;
  if (previous.status !== "uncertain")
    throw new ApiError(409, "기존 기록의 처리가 진행 중입니다.");
  const conn = await connection(uid);
  const expectedMarker = digest({ eventId, eventHash: previous.eventHash });
  const { data } = await conn.api.spreadsheets.get({
    spreadsheetId: MASTER.spreadsheetId,
    fields:
      "developerMetadata(metadataKey,metadataValue,location),sheets(developerMetadata(metadataKey,metadataValue,location))",
  });
  const committed = hasMasterReceipt(data, expectedMarker);
  if (!committed)
    throw new ApiError(
      409,
      "기존 기록의 반영 증거가 없어 자동 재실행을 보류합니다.",
    );
  const remaining = planMaster(await conn.read(), previous.event);
  if (remaining.changes.length)
    throw new ApiError(
      409,
      "기존 기록과 현재 셀이 달라 자동 재실행을 보류합니다.",
    );
  await ref.update({
    status: "verified",
    reconciledAt: new Date().toISOString(),
    result: {
      target: MASTER,
      eventId,
      row: remaining.row,
      cells: previous.plan.changes.map((c: { cell: string }) => c.cell),
      checkedAt: new Date().toISOString(),
      reconciliation: "시트 반영 마커와 현재 셀 재조회 확인 · 추가 쓰기 없음",
    },
  });
}
export async function recordMasterEvent(
  uid: string,
  raw: unknown,
  source:
    "operator" | "agent" | "report-monitor" = "operator",
) {
  const request = masterRequestSchema.parse(raw);
  const conn = await connection(uid);
  const eventHash = digest(request.event);
  const eventRef = userDoc(uid)
    .collection("masterEvents")
    .doc(digest(request.event.eventId));
  let previous = (await eventRef.get()).data();
  if (previous?.status === "uncertain" && previous.eventHash === eventHash) {
    await reconcileMasterEvent(uid, request.event.eventId);
    previous = (await eventRef.get()).data();
  }
  if (previous) {
    if (previous.eventHash !== eventHash)
      throw new ApiError(409, "같은 기록ID에 다른 내용을 사용할 수 없습니다.");
    if (previous.status === "verified") {
      if (planMaster(await conn.read(), request.event).changes.length)
        throw new ApiError(
          409,
          "이전 반영 후 원본 값이 변경되었습니다. 이력을 확인해주세요.",
        );
      return { status: "unchanged", result: previous.result };
    }
    throw new ApiError(
      409,
      "이 요청의 기록 결과를 확인 중입니다. 실행 이력과 원본을 대조해주세요.",
    );
  }
  const plan = planMaster(await conn.read(), request.event);
  if (request.mode === "preview") return { status: "preview", ...plan };
  if (request.expectedPlan !== plan.planHash)
    throw new ApiError(
      409,
      "최신 미리보기의 expectedPlan이 필요합니다. 원본 변경 시 다시 미리보기하세요.",
    );
  if (!conn.file.capabilities.canEdit)
    throw new ApiError(403, "마스터 편집 권한이 없습니다.");
  const lock = db().collection("automationLocks").doc(digest(MASTER));
  const token = randomUUID();
  await db().runTransaction(async (tx) => {
    const [held, existing] = await Promise.all([
      tx.get(lock),
      tx.get(eventRef),
    ]);
    if (existing.exists || (held.data()?.until || 0) > Date.now())
      throw new ApiError(
        409,
        "마스터 반영이 처리 중입니다. 잠시 후 다시 조회해주세요.",
      );
    tx.set(lock, { token, until: Date.now() + 120_000 });
  });
  let sent = false;
  try {
    const latest = planMaster(await conn.read(), request.event);
    if (latest.planHash !== plan.planHash)
      throw new ApiError(
        409,
        "반영 직전 원본이 변경되었습니다. 다시 미리보기해주세요.",
      );
    await eventRef.create({
      eventHash,
      event: request.event,
      source,
      activityType: "master-record",
      status: "prepared",
      plan,
      createdAt: new Date().toISOString(),
    });
    if (plan.changes.length) {
      const markerValue = digest({ eventId: request.event.eventId, eventHash });
      const requests: sheets_v4.Schema$Request[] = [
        {
          createDeveloperMetadata: {
            developerMetadata: {
              metadataId:
                parseInt(
                  digest({
                    target: MASTER,
                    eventId: request.event.eventId,
                  }).slice(0, 7),
                  16,
                ) + 1,
              metadataKey: "axpm.master.event",
              metadataValue: markerValue,
              location: { sheetId: MASTER.sheetId },
              visibility: "DOCUMENT",
            },
          },
        },
        ...plan.changes.map((c) => ({
          updateCells: {
            start: {
              sheetId: MASTER.sheetId,
              rowIndex: plan.row - 1,
              columnIndex: c.column,
            },
            rows: [
              {
                values: [
                  {
                    ...(c.numberFormat
                      ? { userEnteredFormat: { numberFormat: c.numberFormat } }
                      : {}),
                    userEnteredValue:
                      typeof c.after === "boolean"
                        ? { boolValue: c.after }
                        : typeof c.after === "number"
                          ? { numberValue: c.after }
                          : { stringValue: c.after },
                  },
                ],
              },
            ],
            fields: c.numberFormat
              ? "userEnteredValue,userEnteredFormat.numberFormat"
              : "userEnteredValue",
          },
        })),
      ];
      await db().runTransaction(async (tx) => {
        const owner = (await tx.get(lock)).data();
        if (owner?.token !== token || owner.until <= Date.now())
          throw new Error("마스터 실행 잠금이 만료되었습니다.");
        tx.update(eventRef, { status: "writing" });
      });
      sent = true;
      await conn.api.spreadsheets.batchUpdate(
        { spreadsheetId: MASTER.spreadsheetId, requestBody: { requests } },
        { retry: false },
      );
    }
    const verified = await conn.read();
    const remaining = planMaster(verified, request.event);
    if (remaining.changes.length)
      throw new Error("마스터 재조회 검증에 실패했습니다.");
    const result = {
      target: MASTER,
      eventId: request.event.eventId,
      row: remaining.row,
      cells: plan.changes.map((c) => c.cell),
      checkedAt: new Date().toISOString(),
    };
    await eventRef.update({ status: "verified", result });
    return { status: "verified", result };
  } catch (e) {
    if ((await eventRef.get()).exists) {
      if (sent)
        await eventRef.update({
          status: "uncertain",
          error: e instanceof Error ? e.message : "반영 확인 실패",
        });
      else await eventRef.delete();
    }
    throw e;
  } finally {
    await db().runTransaction(async (tx) => {
      if ((await tx.get(lock)).data()?.token === token) tx.delete(lock);
    });
  }
}

export async function reverseMasterEvent(
  uid: string,
  input: {
    masterEventId: string;
    proposalId: string;
    fileId: string;
    round: number;
  },
) {
  const originalRef = userDoc(uid)
    .collection("masterEvents")
    .doc(digest(input.masterEventId));
  const original = (await originalRef.get()).data();
  if (!original)
    throw new ApiError(404, "취소할 자동 반영 기록을 찾을 수 없습니다.");
  if (
    original.status === "reversed" &&
    original.reversal?.proposalId === input.proposalId
  )
    return { status: "unchanged", result: original.reversal };
  if (original.status !== "verified" || original.source !== "report-monitor")
    throw new ApiError(409, "자동 감시가 확인한 반영 기록만 취소할 수 있습니다.");
  if (!original.plan?.changes?.length)
    throw new ApiError(409, "취소할 마스터 셀 변경이 없습니다.");

  const configRaw = (
    await userDoc(uid).collection("config").doc("reportWatch").get()
  ).data();
  if (!configRaw) throw new Error("보고서 폴더 감시 설정이 없습니다.");
  const { reportWatchSchema, inspectSubmissions } = await import(
    "./report-submission"
  );
  const { readReportSource } = await import("./report-source");
  const ws = await workspace(uid);
  const source = await readReportSource(uid, ws, input.fileId);
  const candidate = inspectSubmissions(
    source,
    reportWatchSchema.parse(configRaw),
  ).find((item) => item.round === input.round);
  if (candidate?.event)
    throw new ApiError(
      409,
      "보고서 원본이 다시 유효해져 취소하지 않았습니다. 최신 상태를 확인해주세요.",
    );

  const conn = await connection(uid);
  const initial = planMasterReversal(await conn.read(), original.plan);
  const lock = db().collection("automationLocks").doc(digest(MASTER));
  const token = randomUUID();
  const reversalEventId = `reversal-${input.proposalId}`;
  const reversalRef = userDoc(uid)
    .collection("masterEvents")
    .doc(digest(reversalEventId));
  await db().runTransaction(async (tx) => {
    const [held, existing] = await Promise.all([
      tx.get(lock),
      tx.get(reversalRef),
    ]);
    if (existing.exists || (held.data()?.until || 0) > Date.now())
      throw new ApiError(409, "마스터 반영이 처리 중입니다. 잠시 후 다시 확인해주세요.");
    tx.set(lock, { token, until: Date.now() + 120_000 });
    tx.create(reversalRef, {
      activityType: "master-reversal",
      source: "report-monitor",
      status: "prepared",
      createdAt: new Date().toISOString(),
      event: original.event,
      originalEventId: input.masterEventId,
      proposalId: input.proposalId,
      plan: initial,
    });
  });
  let sent = false;
  try {
    const latest = planMasterReversal(await conn.read(), original.plan);
    if (latest.planHash !== initial.planHash)
      throw new ApiError(
        409,
        "취소 직전 마스터가 변경되었습니다. 다시 확인해주세요.",
      );
    await reversalRef.update({ status: "writing" });
    sent = true;
    await conn.api.spreadsheets.batchUpdate(
      {
        spreadsheetId: MASTER.spreadsheetId,
        requestBody: {
          requests: latest.changes.map((change) => ({
            updateCells: {
              start: {
                sheetId: MASTER.sheetId,
                rowIndex: latest.row - 1,
                columnIndex: change.column,
              },
              rows: [
                {
                  values: [
                    change.after === null || change.after === ""
                      ? {}
                      : {
                          userEnteredValue:
                            typeof change.after === "boolean"
                              ? { boolValue: change.after }
                              : typeof change.after === "number"
                                ? { numberValue: change.after }
                                : { stringValue: change.after },
                        },
                  ],
                },
              ],
              fields: "userEnteredValue",
            },
          })),
        },
      },
      { retry: false },
    );
    const verified = await conn.read();
    for (const change of latest.changes) {
      const value = verified.rows[latest.row - 1]?.[change.column]?.value ?? null;
      const expected = change.after === "" ? null : change.after;
      if (value !== expected)
        throw new Error(`${change.cell}: 취소 후 재조회 검증에 실패했습니다.`);
    }
    const result = {
      proposalId: input.proposalId,
      originalEventId: input.masterEventId,
      row: latest.row,
      cells: latest.changes.map((change) => change.cell),
      checkedAt: new Date().toISOString(),
    };
    await db().runTransaction(async (tx) => {
      const current = await tx.get(originalRef);
      if (current.data()?.status !== "verified")
        throw new ApiError(409, "기존 반영 기록 상태가 변경되었습니다.");
      tx.update(originalRef, {
        status: "reversed",
        reversedAt: result.checkedAt,
        reversal: result,
      });
      tx.update(reversalRef, { status: "verified", result });
    });
    return { status: "verified", result };
  } catch (error) {
    if (sent)
      await reversalRef.update({
        status: "uncertain",
        error: error instanceof Error ? error.message : "취소 확인 실패",
      });
    else await reversalRef.delete();
    throw error;
  } finally {
    await db().runTransaction(async (tx) => {
      if ((await tx.get(lock)).data()?.token === token) tx.delete(lock);
    });
  }
}
export async function masterApi(request: Request, uid: string, path: string) {
  if (path === "automation/config" && request.method === "GET")
    return Response.json(publicProductConfig());
  if (path === "automation/activity" && request.method === "GET") {
    const { automationActivity } = await import("./activity");
    return Response.json(await automationActivity(uid));
  }
  if (path === "automation/master/dashboard" && request.method === "GET")
    return Response.json(await inspectDashboard(uid));
  if (path === "automation/master" && request.method === "GET")
    return Response.json(
      await inspectMaster(
        uid,
        new URL(request.url).searchParams.get("campus") || undefined,
      ),
    );
  if (path === "automation/master/events" && request.method === "POST")
    return Response.json(await recordMasterEvent(uid, await request.json()));
  if (path === "automation/master/history" && request.method === "GET")
    return Response.json(
      (
        await userDoc(uid)
          .collection("masterEvents")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get()
      ).docs.map((d) => ({ id: d.id, ...d.data() })),
    );
  return null;
}
