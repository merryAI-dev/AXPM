import {
  serviceAccountMode,
  driveServiceAccountClient,
} from "./google-service-account";

export async function googleClient(
  uid: string,
  _capability: "drive" | "sheets" = "drive",
) {
  if (!serviceAccountMode())
    throw new Error("Google Drive 서비스 계정 설정이 필요합니다.");
  return driveServiceAccountClient(uid);
}
