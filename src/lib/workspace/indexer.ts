import { randomUUID } from "node:crypto";
import { userDoc } from "../firebase";
import { workspace, type DriveWorkspace } from "./drive";
import { FOLDER } from "./schema";
// One page per invocation; checkpoint and rows are committed atomically.
export async function indexStep(
  uid: string,
  restart = false,
  adapter?: DriveWorkspace,
) {
  const ws = adapter || (await workspace(uid));
  const base = userDoc(uid),
    ref = base.collection("private").doc("drive-index");
  const claim = randomUUID();
  const state = await ref.firestore.runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data();
    if ((old?.leaseUntil || 0) > Date.now())
      throw new Error("폴더를 조사 중입니다.");
    const state =
      restart || !old || old.rootId !== ws.root
        ? {
            rootId: ws.root,
            generation: randomUUID(),
            queue: [ws.root],
            seen: [ws.root],
            cursor: "",
            count: 0,
            folders: 0,
            startedAt: new Date().toISOString(),
            complete: false,
          }
        : old;
    tx.set(ref, { ...state, claim, leaseUntil: Date.now() + 120000 });
    return state;
  });
  try {
    if (!state.queue.length) {
      await ref.update({ complete: true, leaseUntil: 0 });
      return { ...state, complete: true };
    }
    const page = await ws.list(state.queue[0], state.cursor || undefined);
    const queue: string[] = [...state.queue],
      seen = new Set<string>(state.seen);
    let folderCount = state.folders;
    for (const f of page.files)
      if (f.mimeType === FOLDER && !seen.has(f.id)) {
        seen.add(f.id);
        queue.push(f.id);
        folderCount++;
      }
    if (seen.size > 5000)
      throw new Error(
        "폴더 5,000개 한도에 도달했습니다. 관리 범위를 나눠주세요.",
      );
    if (!page.nextPageToken) queue.shift();
    const next = {
      ...state,
      queue,
      seen: [...seen],
      cursor: page.nextPageToken,
      count: state.count + page.files.length,
      folders: folderCount,
      complete: queue.length === 0,
      updatedAt: new Date().toISOString(),
      leaseUntil: 0,
      claim,
      error: "",
    };
    await ref.firestore.runTransaction(async (tx) => {
      if ((await tx.get(ref)).data()?.claim !== claim)
        throw new Error("조사 작업이 교체되었습니다.");
      for (const f of page.files)
        tx.set(base.collection("driveIndex").doc(f.id), {
          ...f,
          generation: state.generation,
          indexedAt: next.updatedAt,
        });
      tx.set(ref, next);
    });
    return {
      count: next.count,
      folders: next.folders,
      complete: next.complete,
      remainingFolders: queue.length,
    };
  } catch (e) {
    await ref.firestore.runTransaction(async (tx) => {
      if ((await tx.get(ref)).data()?.claim === claim)
        tx.update(ref, {
          leaseUntil: 0,
          error: e instanceof Error ? e.message : "조사 실패",
        });
    });
    throw e;
  }
}
export async function indexStatus(uid: string) {
  const d = (
    await userDoc(uid).collection("private").doc("drive-index").get()
  ).data();
  const config = (
    await userDoc(uid).collection("config").doc("drive").get()
  ).data();
  if (!d || d.rootId !== config?.rootId) return null;
  return {
    count: d.count,
    folders: d.folders,
    complete: d.complete,
    updatedAt: d.updatedAt || d.startedAt,
    remainingFolders: d.queue.length,
    error: d.error || "",
  };
}
export async function searchIndex(uid: string, query: string, cursor?: string) {
  const base = userDoc(uid);
  const state = (
    await base.collection("private").doc("drive-index").get()
  ).data();
  const config = (await base.collection("config").doc("drive").get()).data();
  if (!state || state.rootId !== config?.rootId)
    return { files: [], nextCursor: "", complete: false };
  // Bounded index scan, explicitly paginated. Not advertised as full-text document search.
  let q = base.collection("driveIndex").orderBy("__name__").limit(200);
  if (cursor) q = q.startAfter(cursor);
  const page = await q.get();
  const files = page.docs
    .map((d) => d.data())
    .filter(
      (d) =>
        d.generation === state.generation &&
        d.name
          .normalize("NFC")
          .toLowerCase()
          .includes(query.normalize("NFC").toLowerCase()),
    );
  return {
    files,
    nextCursor: page.size === 200 ? page.docs.at(-1)!.id : "",
    complete: state.complete,
    indexedAt: state.updatedAt,
  };
}
