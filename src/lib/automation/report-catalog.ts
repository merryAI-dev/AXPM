import type { DriveWorkspace } from "../workspace/drive";
import { FOLDER, SHEET, XLSX, type DriveFile } from "../workspace/schema";
export async function reportCatalog(ws: DriveWorkspace, root: string) {
  const queue = [root],
    seen = new Set<string>(),
    files: DriveFile[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (seen.size > 50)
      throw new Error(
        "폴더가 50개를 넘습니다. 캠퍼스 하위 폴더를 선택해주세요.",
      );
    let pageToken = "";
    do {
      const page = await ws.list(id, pageToken || undefined);
      for (const file of page.files) {
        if (
          /이전자료|이전파일|삭제할|샘플|템플릿|양식|보관|archive/i.test(
            file.name,
          )
        )
          continue;
        if (file.mimeType === FOLDER) queue.push(file.id);
        else if ([SHEET, XLSX].includes(file.mimeType)) files.push(file);
      }
      if (files.length > 300)
        throw new Error(
          "파일이 300개를 넘습니다. 캠퍼스 하위 폴더를 선택해주세요.",
        );
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return files.sort((a, b) => a.id.localeCompare(b.id));
}
