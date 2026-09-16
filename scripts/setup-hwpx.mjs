import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const repo = resolve("private/tools/hwpx-skill");
const ref = JSON.parse(readFileSync("references/hwpx-source.json", "utf8"));
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} failed (${r.status})`);
}
mkdirSync(resolve("private/tools"), { recursive: true });
if (!existsSync(repo)) run("git", ["clone", ref.repository, repo]);
const dirty = spawnSync("git", ["-C", repo, "status", "--porcelain"], {
  encoding: "utf8",
});
if (dirty.status !== 0 || dirty.stdout.trim())
  throw new Error("HWPX 소스에 로컬 변경이 있습니다. 보존 후 다시 설치하세요.");
run("git", ["-C", repo, "fetch", "origin", ref.revision]);
run("git", ["-C", repo, "checkout", "--detach", ref.revision]);
const venv = resolve("private/hwpx-venv");
if (!existsSync(venv)) run("uv", ["venv", "--python", "3.13", venv]);
run("uv", [
  "pip",
  "install",
  "--python",
  resolve(
    venv,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  ),
  "-r",
  resolve(repo, "requirements-one-shot.txt"),
  "python-hwpx==6.4.0",
]);
console.log(
  "HWPX 설치 완료. npm run hwpx -- build --schema 로 입력 계약을 확인하세요.",
);
