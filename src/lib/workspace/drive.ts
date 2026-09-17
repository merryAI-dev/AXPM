import { defaultDriveConfig } from "./defaults";
import { google, type drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import { googleClient } from "../google";
import { userDoc, ApiError } from "../firebase";
import {
  FOLDER,
  SHEET,
  XLSX,
  fileSchema,
  idSchema,
  driveConfigSchema,
  type DriveFile,
  type Mapping,
} from "./schema";
import { readWorkbook } from "./workbook";
import type { SheetView } from "./sheet-view";
import { nativeSheetView } from "./native-sheet-view";
export interface DrivePort {
  preview?(id: string, sheet: string, mapping: Mapping): Promise<SheetView>;
  metadata(id: string): Promise<DriveFile>;
  list(
    parent: string,
    pageToken?: string,
    trashed?: boolean,
  ): Promise<{ files: DriveFile[]; nextPageToken: string }>;
  download(id: string): Promise<Buffer>;
  update(
    id: string,
    fields: { name?: string; trashed?: boolean },
    bytes?: Buffer,
  ): Promise<DriveFile>;
  create(
    parent: string,
    name: string,
    bytes?: Buffer,
    mimeType?: string,
  ): Promise<DriveFile>;
  copy(id: string, parent: string, name: string): Promise<DriveFile>;
  readCells(
    id: string,
    sheet: string,
    mapping: Mapping,
  ): Promise<{
    values: Record<string, string>;
    anchors: Record<string, string>;
    formulas: string[];
  }>;
  writeCells(
    id: string,
    sheet: string,
    mapping: Mapping,
    values: Record<string, string>,
  ): Promise<void>;
  sheets(
    id: string,
  ): Promise<{ name: string; rows: number; columns: number }[]>;
}
const fields =
  "id,name,mimeType,parents,version,modifiedTime,size,trashed,webViewLink,capabilities(canEdit,canTrash,canAddChildren,canCopy)";
const normalize = (v: drive_v3.Schema$File) =>
  fileSchema.parse({
    ...v,
    version: String(v.version || ""),
    parents: v.parents || [],
  });
const cellRange = (sheet: string, cell: string) =>
  `'${sheet.replace(/'/g, "''")}'!${cell}`;
function indices(address: string) {
  const [, col, row] = address.match(/^([A-Z]+)(\d+)$/)!;
  return {
    row: Number(row) - 1,
    col: [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1,
  };
}
export async function googleDrivePort(uid: string): Promise<DrivePort> {
  const auth = await googleClient(uid, "drive");
  const drive = google.drive({ version: "v3", auth, timeout: 30000 });
  const sheets = google.sheets({ version: "v4", auth, timeout: 30000 });
  return {
    async preview(id, sheet, mapping) {
      const { data } = await sheets.spreadsheets.get({
        spreadsheetId: id,
        ranges: [cellRange(sheet, "A1:BH500")],
        includeGridData: true,
      });
      return nativeSheetView(data, sheet, mapping);
    },
    async metadata(id) {
      return normalize(
        (await drive.files.get({ fileId: id, fields, supportsAllDrives: true }))
          .data,
      );
    },
    async list(parent, pageToken, trashed = false) {
      idSchema.parse(parent);
      const { data } = await drive.files.list({
        q: `'${parent}' in parents and trashed = ${trashed}`,
        pageToken,
        pageSize: 100,
        fields: `nextPageToken,incompleteSearch,files(${fields})`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        orderBy: "folder,name",
      });
      if (data.incompleteSearch)
        throw new Error("Drive 검색이 불완전합니다. 다시 시도해주세요.");
      return {
        files: (data.files || []).map(normalize),
        nextPageToken: data.nextPageToken || "",
      };
    },
    async download(id) {
      const meta = normalize(
        (await drive.files.get({ fileId: id, fields, supportsAllDrives: true }))
          .data,
      );
      if (Number(meta.size) > 10_000_000)
        throw new Error("인앱 편집은 10MB 이하 파일을 지원합니다.");
      const r = await drive.files.get(
        { fileId: id, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      );
      const b = Buffer.from(r.data as ArrayBuffer);
      if (b.length > 10_000_000)
        throw new Error("파일 크기 한도를 초과했습니다.");
      return b;
    },
    async update(id, body, bytes) {
      return normalize(
        (
          await drive.files.update({
            fileId: id,
            requestBody: body,
            fields,
            supportsAllDrives: true,
            ...(bytes
              ? { media: { mimeType: XLSX, body: Readable.from(bytes) } }
              : {}),
          })
        ).data,
      );
    },
    async create(parent, name, bytes, mimeType) {
      return normalize(
        (
          await drive.files.create({
            requestBody: {
              name,
              parents: [parent],
              mimeType: bytes ? mimeType || XLSX : FOLDER,
            },
            fields,
            supportsAllDrives: true,
            ...(bytes
              ? {
                  media: {
                    mimeType: mimeType || XLSX,
                    body: Readable.from(bytes),
                  },
                }
              : {}),
          })
        ).data,
      );
    },
    async copy(id, parent, name) {
      return normalize(
        (
          await drive.files.copy({
            fileId: id,
            requestBody: { name, parents: [parent] },
            fields,
            supportsAllDrives: true,
          })
        ).data,
      );
    },
    async sheets(id) {
      const { data } = await sheets.spreadsheets.get({
        spreadsheetId: id,
        fields: "sheets(properties)",
      });
      return (data.sheets || []).map((s) => ({
        name: s.properties!.title!,
        rows: s.properties?.gridProperties?.rowCount || 0,
        columns: s.properties?.gridProperties?.columnCount || 0,
      }));
    },
    async readCells(id, sheet, mapping) {
      const ranges = mapping.map((f) => cellRange(sheet, f.cell));
      const [display, raw, meta] = await Promise.all([
        sheets.spreadsheets.values.batchGet({
          spreadsheetId: id,
          ranges,
          valueRenderOption: "FORMATTED_VALUE",
        }),
        sheets.spreadsheets.values.batchGet({
          spreadsheetId: id,
          ranges,
          valueRenderOption: "FORMULA",
        }),
        sheets.spreadsheets.get({
          spreadsheetId: id,
          fields: "sheets(properties,merges)",
        }),
      ]);
      const target = meta.data.sheets?.find(
        (s) => s.properties?.title === sheet,
      );
      if (!target) throw new Error("시트를 찾을 수 없습니다.");
      const values: Record<string, string> = {},
        anchors: Record<string, string> = {},
        formulas: string[] = [];
      mapping.forEach((f, i) => {
        values[f.key] = String(
          display.data.valueRanges?.[i]?.values?.[0]?.[0] ?? "",
        );
        const v = raw.data.valueRanges?.[i]?.values?.[0]?.[0];
        if (typeof v === "string" && v.startsWith("=")) formulas.push(f.key);
        const pos = indices(f.cell);
        const merge = target.merges?.find(
          (m) =>
            pos.row >= (m.startRowIndex || 0) &&
            pos.row < m.endRowIndex! &&
            pos.col >= (m.startColumnIndex || 0) &&
            pos.col < m.endColumnIndex!,
        );
        anchors[f.key] =
          merge &&
          (pos.row !== (merge.startRowIndex || 0) ||
            pos.col !== (merge.startColumnIndex || 0))
            ? "병합 영역의 첫 셀을 지정하세요"
            : f.cell;
      });
      return { values, anchors, formulas };
    },
    async writeCells(id, sheet, mapping, values) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: id,
        requestBody: {
          valueInputOption: "RAW",
          data: mapping.map((f) => ({
            range: cellRange(sheet, f.cell),
            values: [[values[f.key]]],
          })),
        },
      });
    },
  };
}
export class DriveWorkspace {
  constructor(
    public port: DrivePort,
    public root: string,
  ) {
    idSchema.parse(root);
  }
  async scoped(id: string, allowTrashed = false): Promise<DriveFile> {
    idSchema.parse(id);
    const file = await this.port.metadata(id);
    if (file.trashed && !allowTrashed)
      throw new ApiError(409, "휴지통에 있는 파일입니다.");
    let current = file;
    const seen = new Set<string>();
    for (let depth = 0; depth < 100; depth++) {
      if (current.id === this.root) {
        if (current.mimeType !== FOLDER || current.trashed)
          throw new ApiError(409, "관리 폴더를 확인해주세요.");
        return file;
      }
      if (seen.has(current.id) || current.parents.length !== 1) break;
      seen.add(current.id);
      current = await this.port.metadata(current.parents[0]);
      if (current.trashed)
        throw new ApiError(409, "상위 폴더가 휴지통에 있습니다.");
    }
    throw new ApiError(403, "관리 폴더 밖의 파일에는 접근할 수 없습니다.");
  }
  async folder(id: string) {
    const f = await this.scoped(id);
    if (f.mimeType !== FOLDER) throw new Error("폴더를 선택해주세요.");
    return f;
  }
  async list(parent = this.root, pageToken?: string, trashed = false) {
    const folder = await this.folder(parent);
    return { folder, ...(await this.port.list(parent, pageToken, trashed)) };
  }
  async read(
    id: string,
    selected?: { sheet: string; mapping: Mapping },
    preview = false,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.readRevision(id, selected, preview);
      } catch (e) {
        if (!(e instanceof ReadRevisionChanged) || attempt === 2) throw e;
      }
    }
    throw new Error("파일을 안정적으로 읽지 못했습니다.");
  }
  private async readRevision(
    id: string,
    selected?: { sheet: string; mapping: Mapping },
    preview = false,
  ) {
    const file = await this.scoped(id);
    let result;
    if (file.mimeType === XLSX)
      result = await readWorkbook(
        await this.port.download(id),
        selected,
        preview,
      );
    else if (file.mimeType === SHEET)
      result = {
        sheets: await this.port.sheets(id),
        ...(preview && selected && this.port.preview
          ? {
              view: await this.port.preview(
                id,
                selected.sheet,
                selected.mapping,
              ),
            }
          : {}),
        ...(selected
          ? await this.port.readCells(id, selected.sheet, selected.mapping)
          : { values: {}, anchors: {}, formulas: [] }),
      };
    else
      throw new Error(
        "셀 편집은 XLSX와 Google Sheets를 지원합니다. 다른 형식은 원본에서 열어주세요.",
      );
    const latest = await this.scoped(id);
    if (file.version !== latest.version) throw new ReadRevisionChanged();
    return { ...result, file, version: file.version };
  }
  async expect(id: string, version: string, allowTrashed = false) {
    const file = await this.scoped(id, allowTrashed);
    if (file.id === this.root)
      throw new Error("관리 루트 폴더는 변경할 수 없습니다.");
    if (file.version !== version)
      throw new ApiError(
        409,
        "원본 버전이 변경되었습니다. 다시 읽고 제안해주세요.",
      );
    return file;
  }
}
class ReadRevisionChanged extends ApiError {
  constructor() {
    super(409, "읽는 동안 파일이 변경되었습니다. 다시 읽어주세요.");
  }
}
export async function driveConfig(uid: string) {
  const raw = (
    await userDoc(uid).collection("config").doc("drive").get()
  ).data();
  return driveConfigSchema.parse(
    raw || {
      ...defaultDriveConfig(),
      rootId:
        process.env.GOOGLE_SERVICE_ACCOUNT_ROOT_ID ||
        defaultDriveConfig().rootId,
    },
  );
}
export async function workspace(uid: string) {
  const config = await driveConfig(uid);
  if (!config) throw new Error("관리할 Drive 폴더를 먼저 설정해주세요.");
  return new DriveWorkspace(await googleDrivePort(uid), config.rootId);
}
