import { mkdirSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
if (process.platform !== "darwin")
  throw new Error("macOS LaunchAgent 설치용입니다.");
const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+$/.test(email))
  throw new Error("운영자 이메일을 지정해주세요.");
const root = process.cwd(),
  name = "kr.co.mysc.axpm.report-monitor";
const escape = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const logs = join(root, "private", "monitor");
mkdirSync(logs, { recursive: true, mode: 0o700 });
const dir = join(homedir(), "Library", "LaunchAgents");
mkdirSync(dir, { recursive: true });
const plist = join(dir, `${name}.plist`);
if (existsSync(plist)) throw new Error(`이미 설치되어 있습니다: ${plist}`);
const args = [
  realpathSync(process.execPath),
  "--import",
  resolve("node_modules/tsx/dist/loader.mjs"),
  resolve("scripts/report-monitor.ts"),
];
writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${name}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${escape(a)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer>
<key>EnvironmentVariables</key><dict><key>AXPM_MONITOR_EMAIL</key><string>${escape(email)}</string><key>HOME</key><string>${escape(homedir())}</string></dict>
<key>StandardOutPath</key><string>${escape(join(logs, "stdout.log"))}</string><key>StandardErrorPath</key><string>${escape(join(logs, "stderr.log"))}</string>
</dict></plist>`,
  { mode: 0o600 },
);
execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plist], {
  stdio: "inherit",
});
console.log(`보고서 자동 반영 서비스 설치 완료: ${name}`);
