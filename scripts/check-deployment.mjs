// Read-only production prerequisites. Never prints credentials or enables APIs.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const requiredApis = [
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com",
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "iamcredentials.googleapis.com",
  "gmail.googleapis.com",
];

export async function checkDeployment(config, dependencies = {}) {
  const command =
    dependencies.command ||
    ((args) => {
      const result = spawnSync(
        "gcloud",
        [...args, "--quiet", "--format=json"],
        {
          encoding: "utf8",
          timeout: 60000,
        },
      );
      if (result.status !== 0) throw new Error("조회 실패 또는 권한 없음");
      return JSON.parse(result.stdout);
    });
  const request = dependencies.request || fetch;
  const checks = [];
  const project = `--project=${config.project}`;
  async function check(name, work) {
    try {
      const detail = await work();
      checks.push({ name, ok: true, detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: error.message });
    }
  }
  function requireValue(value, message) {
    if (!value) throw new Error(message);
  }
  await check("결제 연결", () => {
    const info = command(["billing", "projects", "describe", config.project]);
    requireValue(info.billingEnabled, "결제 계정 지정·연결 필요");
    return "연결됨";
  });
  let enabled = new Set();
  await check("필수 API", () => {
    enabled = new Set(
      command(["services", "list", "--enabled", project]).map(
        (s) => s.config.name,
      ),
    );
    const missing = requiredApis.filter((name) => !enabled.has(name));
    requireValue(!missing.length, `활성화 필요: ${missing.join(", ")}`);
    return "활성화됨";
  });
  await check("실행 서비스 계정", () => {
    command([
      "iam",
      "service-accounts",
      "describe",
      `${config.serviceAccount}@${config.project}.iam.gserviceaccount.com`,
      project,
    ]);
    return "존재함";
  });
  await check("Firestore", () => {
    command([
      "firestore",
      "databases",
      "describe",
      "--database=(default)",
      project,
    ]);
    return "기본 데이터베이스 존재";
  });
  await check("비공개 파일 버킷", () => {
    const bucket = command([
      "storage",
      "buckets",
      "describe",
      `gs://${config.storageBucket}`,
      project,
    ]);
    requireValue(
      bucket.uniform_bucket_level_access,
      "균일한 버킷 수준 접근 설정 필요",
    );
    requireValue(
      bucket.public_access_prevention === "enforced",
      "공개 액세스 방지 설정 필요",
    );
    return "버킷 존재·공개 액세스 차단";
  });
  await check("컨테이너 저장소", () => {
    requireValue(
      enabled.has("artifactregistry.googleapis.com"),
      "Artifact Registry API 활성화 필요",
    );
    command([
      "artifacts",
      "repositories",
      "describe",
      "axpm",
      `--location=${config.region}`,
      project,
    ]);
    return "존재함";
  });
  await check("런타임 비밀", () => {
    requireValue(
      enabled.has("secretmanager.googleapis.com"),
      "Secret Manager API 활성화 필요",
    );
    for (const name of Object.values(config.secrets || {})) {
      const version = command([
        "secrets",
        "versions",
        "describe",
        "latest",
        `--secret=${name}`,
        project,
      ]);
      requireValue(
        version.state === "ENABLED",
        `${name}: 사용 가능한 버전 필요`,
      );
    }
    return "참조하는 비밀의 최신 버전 활성화됨";
  });
  await check("Google 로그인", async () => {
    const { token } = command(["auth", "print-access-token"]);
    requireValue(token, "GCP 액세스 토큰 발급 실패");
    const response = await request(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${config.project}/defaultSupportedIdpConfigs/google.com`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-goog-user-project": config.project,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    requireValue(
      response.ok,
      `Firebase Auth 초기화·Google 로그인 설정 확인 필요 (HTTP ${response.status})`,
    );
    requireValue(
      (await response.json()).enabled,
      "Google 로그인 사용 설정 필요",
    );
    return "활성화됨; 배포 URL의 승인 도메인은 배포 후 확인";
  });
  return checks;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const configPath = process.argv[2];
  if (!configPath)
    throw new Error(
      "Usage: node scripts/check-deployment.mjs private/deploy.json",
    );
  const checks = await checkDeployment(
    JSON.parse(readFileSync(configPath, "utf8")),
  );
  for (const result of checks)
    console.log(
      `${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`,
    );
  process.exitCode = checks.every((result) => result.ok) ? 0 : 1;
}
