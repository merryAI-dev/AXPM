import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedEmail, workspaceUidFor } from "../src/lib/access-policy";

test("authorization accepts exact emails and every account in an allowed domain", () => {
  assert.equal(
    isAuthorizedEmail("operator@example.com", "operator@example.com", ""),
    true,
  );
  assert.equal(isAuthorizedEmail("Person@MYSC.CO.KR", "", "mysc.co.kr"), true);
  assert.equal(
    isAuthorizedEmail("person@other.co.kr", "", "mysc.co.kr"),
    false,
  );
});

test("domain authorization requires an exact domain boundary", () => {
  assert.equal(
    isAuthorizedEmail("person@evil-mysc.co.kr", "", "mysc.co.kr"),
    false,
  );
  assert.equal(
    isAuthorizedEmail("person@sub.mysc.co.kr", "", "mysc.co.kr"),
    false,
  );
  assert.equal(
    isAuthorizedEmail("person@mysc.co.kr.evil.com", "", "mysc.co.kr"),
    false,
  );
});

test("authorized accounts share the configured operational workspace", () => {
  assert.equal(workspaceUidFor("person-uid", "operator-uid"), "operator-uid");
  assert.equal(workspaceUidFor("person-uid", ""), "person-uid");
});
