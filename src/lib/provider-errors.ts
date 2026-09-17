export function isQuotaError(error: unknown) {
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  return (
    e?.code === 8 ||
    e?.code === "RESOURCE_EXHAUSTED" ||
    /RESOURCE_EXHAUSTED|quota exceeded|할당량/i.test(
      String(e?.message || "") + String(e?.details || ""),
    )
  );
}
export const QUOTA_RETRY_SECONDS = 15 * 60;
export const QUOTA_MESSAGE =
  "데이터베이스/API 할당량 초과로 조회·자동 반영이 일시 중단되었습니다. 15분 후 다시 확인합니다. 현재 화면의 이전 값을 최신 반영 결과로 보지 마세요.";
