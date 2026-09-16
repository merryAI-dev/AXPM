import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const commands = {
  build: "one_shot.py",
  analyze: "fill_hwpx.py",
  fill: "fill_hwpx.py",
  check: "fill_hwpx.py",
  map: "map_preflight.py",
  extract: "text_extract.py",
  render: "render_hwpx.py",
  convert: "convert_hwp.py",
};
const [command, ...args] = process.argv.slice(2);
if (!Object.hasOwn(commands, command))
  throw new Error(
    `Usage: npm run hwpx -- <${Object.keys(commands).join("|")}> [arguments]`,
  );
const python = resolve(
    "private/hwpx-venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  ),
  script = resolve("private/tools/hwpx-skill/scripts", commands[command]);
if (!existsSync(python) || !existsSync(script))
  throw new Error("npm run hwpx:setup을 먼저 실행하세요.");
const nativeConversion = command === "convert" && process.platform === "win32";
const parameters = nativeConversion
  ? [
      "-NoProfile",
      "-File",
      resolve("private/tools/hwpx-skill/scripts/convert_hwp_hancom.ps1"),
      ...args,
    ]
  : [
      script,
      ...(["analyze", "fill", "check"].includes(command) ? [command] : []),
      ...args,
    ];
// Argument arrays preserve paths; no shell or model-selected executable is used.
const child = spawn(nativeConversion ? "powershell.exe" : python, parameters, {
  stdio: "inherit",
  env: { ...process.env, PYTHONUTF8: "1" },
});
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
