import { listWorkbooks, readLocal } from "./local-files";
import { z } from "zod";
import { workspace, driveConfig } from "./drive";
import { indexStatus, searchIndex } from "./indexer";
import { jobInput, idSchema, editSchema } from "./schema";
import { proposeDrive } from "./jobs";
export const workspaceTools = {
  list_uploaded_workbooks: z.object({}),
  read_uploaded_cells: z.object({
    id: z.string().uuid(),
    selected: editSchema.optional(),
  }),
  inspect_workspace: z.object({}),
  list_drive_files: z.object({
    parentId: idSchema.optional(),
    pageToken: z.string().max(2000).optional(),
  }),
  search_drive_index: z.object({
    query: z.string().max(200),
    cursor: idSchema.optional(),
  }),
  read_drive_cells: z.object({
    fileId: idSchema,
    selected: editSchema.optional(),
  }),
  propose_drive_change: jobInput,
};
export const workspaceDescriptions: Record<
  keyof typeof workspaceTools,
  string
> = {
  list_uploaded_workbooks:
    "운영자가 업로드한 엑셀 목록을 읽습니다. Google 연결 없이 가능하며 Drive 원본 현황과 구분하세요.",
  read_uploaded_cells:
    "업로드 엑셀의 실제 시트와 셀을 읽습니다. 먼저 selected 없이 시트를 조사하세요. 업로드 사본이며 Drive 최신 원본이라고 표현하지 마세요.",
  inspect_workspace:
    "관리 폴더 설정과 조사 진행 상태를 확인합니다. 실제 접근 가능 여부는 파일 조회로 확인하세요.",
  list_drive_files:
    "관리 폴더 안의 실제 파일 목록을 한 페이지 조회합니다. nextPageToken이 있으면 전체 목록이 아닙니다. 바로가기의 외부 대상을 따라가지 않습니다.",
  search_drive_index:
    "조사한 파일명 검색입니다. 본문 검색이 아니며 complete=false 또는 nextCursor가 있으면 전체 결과가 아닙니다. 조회한 파일은 원본에서 다시 확인하세요.",
  read_drive_cells:
    "XLSX/Google Sheets의 시트와 지정 셀의 실제 값을 읽습니다. 첫 호출로 시트를 조사하고 실제 양식에 맞는 셀을 지정하세요. 셀 위치·기업·회차를 파일명만 보고 단정하지 마세요.",
  propose_drive_change:
    "파일 생성/복사/이름 변경/휴지통/복원/셀 변경을 승인 대기 상태로 제안합니다. 실행 권한은 없습니다. 원본 ID·버전과 before 값은 조회 결과 그대로 사용하세요. requestId는 새 UUID이며 재전송 시 같은 값을 사용합니다.",
};
export async function callWorkspaceTool(
  uid: string,
  name: string,
  raw: unknown,
) {
  if (!(name in workspaceTools))
    throw new Error("허용되지 않은 Drive 도구입니다.");
  switch (name) {
    case "list_uploaded_workbooks":
      return listWorkbooks(uid);
    case "read_uploaded_cells": {
      const p = workspaceTools.read_uploaded_cells.parse(raw);
      return readLocal(uid, p.id, p.selected);
    }
    case "inspect_workspace":
      return { config: await driveConfig(uid), index: await indexStatus(uid) };
    case "list_drive_files": {
      const p = workspaceTools.list_drive_files.parse(raw);
      return (await workspace(uid)).list(p.parentId, p.pageToken);
    }
    case "search_drive_index": {
      const p = workspaceTools.search_drive_index.parse(raw);
      return searchIndex(uid, p.query, p.cursor);
    }
    case "read_drive_cells": {
      const p = workspaceTools.read_drive_cells.parse(raw);
      return (await workspace(uid)).read(p.fileId, p.selected);
    }
    case "propose_drive_change":
      return proposeDrive(uid, raw);
  }
}
