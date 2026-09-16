import { z } from "zod";
export const FOLDER = "application/vnd.google-apps.folder";
export const SHEET = "application/vnd.google-apps.spreadsheet";
export const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
export const addressSchema = z
  .string()
  .regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/)
  .refine((v) => {
    const [, col, row] = v.match(/^([A-Z]+)(\d+)$/)!;
    return (
      [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) <= 16384 &&
      Number(row) <= 1048576
    );
  }, "Excel 셀 범위를 벗어났습니다.");
export const mappingSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(100),
      cell: addressSchema,
    }),
  )
  .min(1)
  .max(50)
  .refine(
    (m) =>
      new Set(m.map((x) => x.key)).size === m.length &&
      new Set(m.map((x) => x.cell)).size === m.length,
    "중복 필드 또는 셀입니다.",
  );
export type Mapping = z.infer<typeof mappingSchema>;
export const editSchema = z.object({
  sheet: z.string().min(1).max(100),
  mapping: mappingSchema,
});
export const valuesSchema = z.record(
  z.string(),
  z
    .string()
    .max(32767)
    .refine((v) => !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v)),
);
export const fileSchema = z.object({
  id: idSchema,
  name: z.string(),
  mimeType: z.string(),
  parents: z.array(z.string()).default([]),
  version: z.string(),
  modifiedTime: z.string().default(""),
  size: z.string().default("0"),
  trashed: z.boolean().default(false),
  webViewLink: z.string().default(""),
  capabilities: z
    .object({
      canEdit: z.boolean().optional(),
      canTrash: z.boolean().optional(),
      canAddChildren: z.boolean().optional(),
      canCopy: z.boolean().optional(),
    })
    .default({}),
});
export type DriveFile = z.infer<typeof fileSchema>;
const name = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((x) => !/[\x00-\x1f]/.test(x));
const existing = { fileId: idSchema, version: z.string().min(1) };
export const commandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workbook.publish"),
    parentId: idSchema,
    name,
    workbookId: z.string().uuid(),
    version: z.string().min(1),
  }),
  z.object({ kind: z.literal("folder.create"), parentId: idSchema, name }),
  z.object({
    kind: z.literal("file.copy"),
    ...existing,
    parentId: idSchema,
    name,
  }),
  z.object({ kind: z.literal("file.rename"), ...existing, name }),
  z.object({ kind: z.literal("file.trash"), ...existing }),
  z.object({ kind: z.literal("file.restore"), ...existing }),
  z.object({
    kind: z.literal("cells.update"),
    ...existing,
    ...editSchema.shape,
    before: valuesSchema,
    after: valuesSchema,
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export const jobInput = z.object({
  command: commandSchema,
  reason: z.string().min(1).max(2000),
  requestId: z.string().uuid(),
});
export const driveConfigSchema = z.object({
  rootId: z
    .string()
    .max(300)
    .transform((v) => v.match(/\/folders\/([\w-]+)/)?.[1] || v)
    .pipe(idSchema),
  label: z.string().min(1).max(100).default("사업 공유 폴더"),
});
export function validateValues(
  mapping: Mapping,
  values: Record<string, string>,
) {
  if (
    Object.keys(values).sort().join("|") !==
    mapping
      .map((x) => x.key)
      .sort()
      .join("|")
  )
    throw new Error("매핑과 값의 필드가 일치하지 않습니다.");
}
