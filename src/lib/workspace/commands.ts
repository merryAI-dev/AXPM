import { type Command, SHEET, XLSX, validateValues } from "./schema";
import { type DriveWorkspace } from "./drive";
import { editWorkbook } from "./workbook";
export async function validateCommand(ws: DriveWorkspace, command: Command) {
  if (
    command.kind === "folder.create" ||
    command.kind === "file.copy" ||
    command.kind === "workbook.publish"
  ) {
    const parent = await ws.folder(command.parentId);
    if (parent.capabilities.canAddChildren === false)
      throw new Error("폴더에 파일을 추가할 권한이 없습니다.");
    if (command.kind === "folder.create" || command.kind === "workbook.publish")
      return { target: parent };
  }
  if (!("fileId" in command)) throw new Error("파일이 필요합니다.");
  const target = await ws.expect(
    command.fileId,
    command.version,
    command.kind === "file.restore",
  );
  if (
    command.kind === "file.copy" &&
    target.mimeType === "application/vnd.google-apps.folder"
  )
    throw new Error("폴더 복사는 지원하지 않습니다.");
  if (command.kind === "file.copy" && target.capabilities.canCopy === false)
    throw new Error("복사 권한이 없습니다.");
  if (command.kind === "file.trash" && target.capabilities.canTrash === false)
    throw new Error("휴지통 이동 권한이 없습니다.");
  if (
    !["file.copy", "file.trash"].includes(command.kind) &&
    target.capabilities.canEdit === false
  )
    throw new Error("편집 권한이 없습니다.");
  if (command.kind === "cells.update") {
    validateValues(command.mapping, command.before);
    validateValues(command.mapping, command.after);
    const current = await ws.read(target.id, command);
    for (const f of command.mapping) {
      if (current.values[f.key] !== command.before[f.key])
        throw new Error(`${f.cell}: 원본 내용이 변경되었습니다.`);
      if (
        command.before[f.key] !== command.after[f.key] &&
        (current.formulas.includes(f.key) || current.anchors[f.key] !== f.cell)
      )
        throw new Error(`${f.cell}: 수식 또는 병합 셀을 확인해주세요.`);
    }
    if (
      !command.mapping.some(
        (f) => command.before[f.key] !== command.after[f.key],
      )
    )
      throw new Error("변경된 셀이 없습니다.");
  }
  return { target };
}
// Caller saves an encrypted/owner-scoped backup before the first external write.
export async function executeCommand(
  ws: DriveWorkspace,
  command: Command,
  backup: (bytes: Buffer, mime: string) => Promise<void>,
  beforeWrite: () => Promise<void>,
  publishSource?: () => Promise<Buffer>,
) {
  await validateCommand(ws, command);
  if (command.kind === "workbook.publish") {
    if (!publishSource) throw new Error("게시할 엑셀 원본이 없습니다.");
    const bytes = await publishSource();
    await beforeWrite();
    const created = await ws.port.create(command.parentId, command.name, bytes);
    const verified = await ws.scoped(created.id);
    if (
      verified.name !== command.name ||
      !verified.parents.includes(command.parentId) ||
      !(await ws.port.download(created.id)).equals(bytes)
    )
      throw new Error("게시한 엑셀 검증에 실패했습니다.");
    return verified;
  }
  if (command.kind === "folder.create") {
    await beforeWrite();
    const f = await ws.port.create(command.parentId, command.name);
    const verified = await ws.scoped(f.id);
    if (
      verified.name !== command.name ||
      !verified.parents.includes(command.parentId)
    )
      throw new Error("생성 결과를 확인하지 못했습니다.");
    return verified;
  }
  if (command.kind === "file.copy") {
    await beforeWrite();
    const f = await ws.port.copy(
      command.fileId,
      command.parentId,
      command.name,
    );
    const verified = await ws.scoped(f.id);
    if (
      verified.name !== command.name ||
      !verified.parents.includes(command.parentId)
    )
      throw new Error("복사 결과를 확인하지 못했습니다.");
    return verified;
  }
  if (command.kind === "cells.update") {
    const target = await ws.expect(command.fileId, command.version);
    const changed = command.mapping.filter(
      (f) => command.before[f.key] !== command.after[f.key],
    );
    if (target.mimeType === XLSX) {
      const original = await ws.port.download(target.id);
      const output = await editWorkbook(
        original,
        command.sheet,
        command.mapping,
        command.before,
        command.after,
      );
      await backup(original, XLSX);
      await ws.expect(target.id, command.version);
      await beforeWrite();
      await ws.port.update(target.id, {}, output);
    } else if (target.mimeType === SHEET) {
      await backup(
        Buffer.from(
          JSON.stringify({
            sheet: command.sheet,
            mapping: changed,
            values: command.before,
          }),
        ),
        "application/json",
      );
      await validateCommand(ws, command);
      await beforeWrite();
      await ws.port.writeCells(
        target.id,
        command.sheet,
        changed,
        command.after,
      );
    } else throw new Error("셀 편집을 지원하지 않는 형식입니다.");
    const verified = await ws.read(target.id, command);
    for (const f of command.mapping)
      if (verified.values[f.key] !== command.after[f.key])
        throw new Error("저장 후 읽기 결과가 다릅니다. 원본을 확인해주세요.");
    return verified.file;
  }
  const update =
    command.kind === "file.rename"
      ? { name: command.name }
      : { trashed: command.kind === "file.trash" };
  await beforeWrite();
  await ws.port.update(command.fileId, update);
  const verified = await ws.scoped(command.fileId, true);
  if (
    ("name" in update && verified.name !== update.name) ||
    ("trashed" in update && verified.trashed !== update.trashed)
  )
    throw new Error("변경 결과를 확인하지 못했습니다.");
  return verified;
}
