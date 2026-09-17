import type { DriveFile } from "../workspace/schema";
export type ReportCheckpoint = {
  version: string;
  configHash: string;
  checkedAt: number;
  revisit: boolean;
  modifiedTime?: string;
  failures?: number;
  retryAt?: number;
};
export function reportQueue(
  files: DriveFile[],
  checkpoints: Map<string, ReportCheckpoint>,
  configHash: string,
  retrySeconds: number,
  now: number,
) {
  return files
    .filter((file) => {
      const p = checkpoints.get(file.id);
      return (
        !p ||
        p.configHash !== configHash ||
        p.version !== file.version ||
        (p.revisit &&
          now >= (p.retryAt ?? p.checkedAt + retrySeconds * 1000)) ||
        now - p.checkedAt >= 6 * 60 * 60_000
      );
    })
    .sort((a, b) => {
      const rank = (f: DriveFile) => {
        const p = checkpoints.get(f.id);
        if (p && p.version !== f.version) return 0;
        if (
          (!p || p.configHash !== configHash) &&
          now - Date.parse(f.modifiedTime) < 24 * 60 * 60_000
        )
          return 0;
        if (
          p?.revisit &&
          now >= (p.retryAt ?? p.checkedAt + retrySeconds * 1000)
        )
          return 1;
        return 2;
      };
      return (
        rank(a) - rank(b) ||
        Date.parse(b.modifiedTime || "1970-01-01") -
          Date.parse(a.modifiedTime || "1970-01-01") ||
        a.id.localeCompare(b.id)
      );
    });
}

export function reportRetryDelay(failures: number) {
  return Math.min(
    15 * 60_000,
    60_000 * 2 ** Math.min(Math.max(failures - 1, 0), 4),
  );
}
