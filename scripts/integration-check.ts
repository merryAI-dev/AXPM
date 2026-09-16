import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { userDoc, isEmulator, db } from "../src/lib/firebase";
import type { Snapshot } from "../src/lib/types";
process.loadEnvFile(".env.local");
if (!isEmulator())
  throw new Error("이 검증은 로컬 에뮬레이터에서만 실행합니다.");
const suffix = randomUUID();
async function account(label: string) {
  const r = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${label}-${suffix}@example.com`,
        password: "test-only-password",
        returnSecureToken: true,
      }),
    },
  );
  assert.equal(r.status, 200);
  return r.json();
}
const [a, b] = await Promise.all([account("a"), account("b")]);
async function request(token: string, path: string, body?: unknown) {
  return fetch(`http://127.0.0.1:3000/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const sample: Snapshot = {
  id: "snapshot-test",
  importedAt: new Date().toISOString(),
  companies: [
    {
      id: "c1",
      name: "합성테스트기업",
      email: "synthetic@example.com",
      campus: "가상",
      mentor: "테스트",
      category: "기존신청",
      active: true,
      regular: 0,
      specialty: false,
      specialtyCount: 0,
      requested: false,
      assigned: false,
      rounds: [],
      specialtyReport: "",
      evidenceId: "ev1",
    },
  ],
  appointments: [],
  evidence: [
    {
      id: "ev1",
      source: "synthetic",
      sheet: "test",
      cell: "C6",
      detail: "가상 기업",
    },
  ],
  findings: [],
  sources: [],
  policy: { targetPerCompany: 3, targetBasis: "test", excludedCategories: [] },
};
let client: Client | undefined;
try {
  await userDoc(a.localId).collection("snapshots").doc("current").set(sample);
  await userDoc(a.localId).collection("tickets").doc("c1-dedicated").set({
    companyId: "c1",
    kind: "dedicated",
    remainingTickets: 0,
    remainingHours: 0,
    revision: 0,
    snapshotId: sample.id,
  });
  assert.equal((await fetch("http://127.0.0.1:3000/api/state")).status, 401);
  const stateB = await (await request(b.idToken, "state")).json();
  assert.equal(stateB.snapshot, null);
  const issued = await (await request(a.idToken, "bridge/key", {})).json();
  assert.ok(issued.key.startsWith("axpm_"));
  const transport = new StdioClientTransport({
    command: resolve("node_modules/.bin/tsx"),
    args: [resolve("scripts/mcp-server.ts")],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (x): x is [string, string] => typeof x[1] === "string",
        ),
      ),
      AXPM_BASE_URL: "http://127.0.0.1:3000",
      AXPM_BRIDGE_KEY: issued.key,
    },
  });
  client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 13);
  assert.ok(!tools.tools.some((t) => /approve|send|execute/.test(t.name)));
  const state = await client.callTool({ name: "axpm_overview", arguments: {} });
  assert.equal(state.isError, false);
  assert.ok(JSON.stringify(state).includes("합성테스트기업"));
  const proposal = await client.callTool({
    name: "axpm_propose",
    arguments: {
      userRequest: "합성테스트기업 전담 티켓 1회 추가",
      proposal: {
        kind: "ticket",
        title: "전담 1회 추가",
        reason: "통합 검증",
        evidenceIds: ["ev1"],
        companyId: "c1",
        ticketKind: "dedicated",
        ticketMode: "adjust",
        ticketDelta: 1,
      },
    },
  });
  assert.equal(proposal.isError, false);
  const p = JSON.parse(
    (proposal.content as { type: string; text: string }[])[0].text,
  );
  assert.equal(p.status, "pending");
  assert.equal(
    (await request(issued.key, "proposal", { id: p.id, approve: true })).status,
    401,
  );
  assert.equal(
    (await request(b.idToken, "proposal", { id: p.id, approve: true })).status,
    409,
  );
  const statuses = await Promise.all([
    request(a.idToken, "proposal", { id: p.id, approve: true }),
    request(a.idToken, "proposal", { id: p.id, approve: true }),
  ]);
  assert.deepEqual(statuses.map((x) => x.status).sort(), [200, 409]);
  const ticket = (
    await userDoc(a.localId).collection("tickets").doc("c1-dedicated").get()
  ).data();
  assert.equal(ticket!.remainingTickets, 1);
  const direct = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-axpm/databases/(default)/documents/users/${a.localId}/snapshots/current`,
    { headers: { Authorization: `Bearer ${a.idToken}` } },
  );
  assert.equal(direct.status, 403);
  const unsafe = await request(a.idToken, "settings", { targetPerCompany: -1 });
  assert.equal(unsafe.status, 400);
  await request(a.idToken, "bridge/revoke", {});
  const revoked = await client.callTool({
    name: "axpm_overview",
    arguments: {},
  });
  assert.equal(revoked.isError, true);
  console.log(
    "PASS: Firebase Auth isolation, deny-by-default rules, 13 MCP tools, proposal-only keys, cross-user rejection, concurrent approval once, revocation. No live email sent.",
  );
} finally {
  await client?.close();
  for (const account of [a, b])
    await db().recursiveDelete(userDoc(account.localId));
}
