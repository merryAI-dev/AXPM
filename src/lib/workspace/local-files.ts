import { z } from "zod";
import { randomUUID } from "node:crypto";
import { userDoc, storage, ApiError } from "../firebase";
import { readWorkbook, editWorkbook, fingerprint } from "./workbook";
import { editSchema, valuesSchema, type Mapping } from "./schema";
const files = (uid: string) => userDoc(uid).collection("workbooks");
export async function uploadWorkbook(uid: string, file: File) {
  if (file.size > 10000000 || !file.name.toLowerCase().endsWith(".xlsx"))
    throw new Error("10MB 이하의 XLSX 파일을 선택해주세요.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const info = await readWorkbook(buffer);
  const id = randomUUID(),
    objectPath = `users/${uid}/workbooks/${id}/${fingerprint(buffer)}.xlsx`;
  await storage().file(objectPath).save(buffer, { resumable: false });
  const data = {
    id,
    name: file.name,
    objectPath,
    version: fingerprint(buffer),
    sheets: info.sheets,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origin: "upload",
  };
  await files(uid).doc(id).set(data);
  return data;
}
export async function listWorkbooks(uid: string) {
  return (
    await files(uid).orderBy("updatedAt", "desc").limit(50).get()
  ).docs.map((x) => ({
    id: x.id,
    name: x.data().name,
    version: x.data().version,
    updatedAt: x.data().updatedAt,
  }));
}
export async function localWorkbook(uid: string, id: string) {
  if (!/^[\w-]{1,128}$/.test(id)) throw new Error("파일 ID를 확인해주세요.");
  const file = (await files(uid).doc(id).get()).data();
  if (!file) throw new ApiError(404, "업로드 파일을 찾을 수 없습니다.");
  const [buffer] = await storage().file(file.objectPath).download();
  return { file, buffer };
}
export async function readLocal(
  uid: string,
  id: string,
  selected?: { sheet: string; mapping: Mapping },
) {
  const { file, buffer } = await localWorkbook(uid, id);
  return {
    ...(await readWorkbook(buffer, selected)),
    file: { id, name: file.name },
    profile: file.profile || null,
  };
}
export async function saveLocal(uid: string, id: string, raw: unknown) {
  const p = z
    .object({
      ...editSchema.shape,
      version: z.string(),
      before: valuesSchema,
      after: valuesSchema,
    })
    .parse(raw);
  const { file, buffer } = await localWorkbook(uid, id);
  if (file.version !== p.version)
    throw new ApiError(409, "파일이 변경되었습니다. 다시 읽어주세요.");
  const output = await editWorkbook(
    buffer,
    p.sheet,
    p.mapping,
    p.before,
    p.after,
  );
  const version = fingerprint(output),
    objectPath = `users/${uid}/workbooks/${id}/${version}.xlsx`;
  await storage().file(objectPath).save(output, { resumable: false });
  const ref = files(uid).doc(id);
  await ref.firestore.runTransaction(async (tx) => {
    if ((await tx.get(ref)).data()?.version !== p.version)
      throw new ApiError(
        409,
        "동시에 다른 편집이 저장되었습니다. 다시 읽어주세요.",
      );
    tx.update(ref, {
      objectPath,
      version,
      profile: { sheet: p.sheet, mapping: p.mapping },
      updatedAt: new Date().toISOString(),
    });
    tx.create(ref.collection("versions").doc(), {
      before: file.objectPath,
      after: objectPath,
      createdAt: new Date().toISOString(),
    });
  });
  return { id, version };
}
