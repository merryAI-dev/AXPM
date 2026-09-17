import { z } from "zod";
import { workspace, driveConfig } from "./drive";
import { indexStatus, searchIndex } from "./indexer";
import { jobInput, idSchema, editSchema } from "./schema";
import { proposeDrive } from "./jobs";
export const workspaceTools = {
  inspect_mail_intake: z.object({ query: z.string().max(200).optional() }),
  sync_mail_attachments: z.object({}),
  inspect_report_file: z.object({ fileId: idSchema }),
  apply_report_submissions: z.object({ fileId: idSchema.optional() }),
  apply_report_names: z.object({ batchId: z.string().uuid() }),
  inspect_report_watch: z.object({}),
  scan_report_submissions: z.object({ fileId: idSchema.optional() }),
  preview_report_names: z.object({ folderId: idSchema }),
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
  inspect_mail_intake:
    "개인 OAuth 메일 첨부 수집 연동 상태, 최근 요약과 수집 이력을 조회합니다. query로 제목·보낸 사람·원본명·저장명을 검색할 수 있습니다. 메일 본문은 반환하지 않습니다.",
  sync_mail_attachments:
    "설정된 Gmail 검색 조건으로 새 첨부를 찾아 관리 Drive에 저장하고, XLSX 보고서는 본문과 마스터를 대조해 파일명을 통일합니다. 메시지·첨부 ID로 중복 수집을 막습니다. 사용자가 실행을 요청한 경우만 호출하세요.",
  inspect_report_file:
    "실제 보고서의 회차 탭과 셀 주소·내용을 읽습니다. 파일명 추측 대신 기업·멘토·일자·필수 항목을 본문에서 확인하세요. 일부 텍스트는 길이 제한으로 잘릴 수 있으며 truncated=true를 확인하세요.",
  apply_report_submissions:
    "운영자가 켜 둔 보고서 자동 반영 설정에 따라 필수 항목과 회차 탭 날짜 검증을 통과한 보고서를 다시 읽고 마스터에 반영합니다. fileId를 생략하면 폴더의 변경 파일을, 지정하면 감시 폴더 내 그 파일을 다시 검증합니다. 완료 체크와 작성일만 반영하고 같은 결과는 중복 기록하지 않습니다. 설정을 켜거나 임의 값을 기록하지 않습니다. 실행 후 inspect_report_watch와 axpm_master로 결과를 재조회하세요. 사용자가 실행을 요청한 경우만 호출하세요.",
  apply_report_names:
    "preview_report_names로 만든 변경 전후 목록 중 본문·마스터 대조와 중복 검증을 통과한 파일명을 일괄 적용합니다. 사용자가 파일명 통일 실행을 요청한 경우에만 해당 batchId로 호출하세요. 일부 실패를 전체 성공으로 보고하지 마세요.",
  inspect_report_watch:
    "기존 보고서 필수 항목 감시 설정과 최근 보완·반영 결과를 조회합니다.",
  scan_report_submissions:
    "기존 보고서 폴더를 읽고 필수 항목과 회차 탭 날짜를 점검합니다. fileId 지정 시 해당 파일을 재조회하며 감시 폴더 밖 파일은 거부합니다. 이 도구는 마스터에 쓰지 않는 미리보기 점검입니다. 누락과 부분 조사 범위를 함께 보고하세요.",
  preview_report_names:
    "보고서 폴더를 조사해 파일명 힌트와 실제 본문·마스터를 대조하고 통일 파일명 변경 전후 목록을 만듭니다. 이름을 변경하지 않습니다. 운영 화면에서 일괄 반영할 수 있습니다.",
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
    case "inspect_mail_intake": {
      const { mailIntakeStatus } = await import("../automation/mail-intake");
      return mailIntakeStatus(
        uid,
        workspaceTools.inspect_mail_intake.parse(raw).query,
      );
    }
    case "sync_mail_attachments": {
      const { syncMailAttachments } = await import("../automation/mail-intake");
      return syncMailAttachments(uid);
    }
    case "inspect_report_file": {
      const { readReportSource } = await import("../automation/report-source");
      const source = await readReportSource(
        uid,
        await workspace(uid),
        workspaceTools.inspect_report_file.parse(raw).fileId,
      );
      let remaining = 40000;
      return {
        fileId: source.id,
        name: source.name,
        version: source.version,
        tabs: source.tabs.map((tab) => ({
          name: tab.name,
          hidden: tab.hidden,
          formulaCells: tab.formulaCells,
          cells: tab.cells.flatMap((row, r) =>
            row.flatMap((value, c) => {
              if (!value) return [];
              const limit = Math.min(4000, remaining),
                text = value.slice(0, limit);
              remaining -= text.length;
              return [
                {
                  cell: `${String.fromCharCode(65 + c)}${r + 1}`,
                  text,
                  truncated: text.length < value.length,
                },
              ];
            }),
          ),
        })),
      };
    }
    case "apply_report_submissions": {
      const { reportWatchStatus, runReportWatch } =
        await import("../automation/report-watch");
      if (!(await reportWatchStatus(uid)).config?.autoApply)
        throw new Error(
          "보고서 자동 반영 설정이 꺼져 있습니다. 운영 화면에서 설정해주세요.",
        );
      return runReportWatch(
        uid,
        false,
        false,
        workspaceTools.apply_report_submissions.parse(raw).fileId,
      );
    }
    case "apply_report_names": {
      const { applyReportNames } =
        await import("../automation/report-name-service");
      return applyReportNames(
        uid,
        workspaceTools.apply_report_names.parse(raw),
      );
    }
    case "inspect_report_watch": {
      const { reportWatchStatus } = await import("../automation/report-watch");
      return reportWatchStatus(uid);
    }
    case "scan_report_submissions": {
      const { runReportWatch } = await import("../automation/report-watch");
      return runReportWatch(
        uid,
        false,
        true,
        workspaceTools.scan_report_submissions.parse(raw).fileId,
      );
    }
    case "preview_report_names": {
      const { previewReportNames } =
        await import("../automation/report-name-service");
      return previewReportNames(
        uid,
        workspaceTools.preview_report_names.parse(raw),
      );
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
