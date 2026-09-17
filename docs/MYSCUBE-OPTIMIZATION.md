# MYSCube 동기화 최적화 조사 및 AXPM 적용

조사일: 2026-09-17. MYSCube `main` 참조 커밋: `c9c0ebebac1e0cd5f65f4d014c87fef6b781fce0`.

## 확인한 구현과 검증 과정

- [revision cache / single-flight](https://github.com/merryAI-dev/MYSCube/blob/c9c0ebebac1e0cd5f65f4d014c87fef6b781fce0/server/bff/cashflow-template-index.mjs): 저장된 revision을 캐시 키로 사용하고 동일한 동시 조회는 하나의 Promise를 공유한다. 캐시는 항목 수를 제한한다.
- [Sheets preview / freshness](https://github.com/merryAI-dev/MYSCube/blob/c9c0ebebac1e0cd5f65f4d014c87fef6b781fce0/server/bff/routes/cashflow-sheet-lab.mjs): 저렴한 메타데이터로 변경 여부를 확인하고 미리보기에는 15초 캐시와 in-flight 공유를 쓴다. 쓰기 경로에 그대로 적용할 캐시 정책은 아니다.
- [work queue](https://github.com/merryAI-dev/MYSCube/blob/c9c0ebebac1e0cd5f65f4d014c87fef6b781fce0/server/bff/work-queue.mjs): Firestore 트랜잭션으로 작업을 점유하고 nextAttemptAt, 시도 횟수, 지수 백오프, 실패 격리 상태를 저장한다. 해당 구현의 제한 조회는 완료 작업이 누적될 때 누락 가능성이 있어 그대로 복제하지 않는다.
- [multi-month apply contract](https://github.com/merryAI-dev/MYSCube/blob/c9c0ebebac1e0cd5f65f4d014c87fef6b781fce0/docs/architecture/contracts/2026-07-21-cashflow-multi-month-apply.md): 하나의 원본 revision, 일괄 조회/명령, 멱등 결과와 감사 이벤트를 사용한다. 호출 횟수 테스트 → 저장 결과 검증 → 회귀 테스트 → 실제 배포 환경 시간 측정 순서다. 시간 제한을 늘리는 것을 최적화로 인정하지 않는다.

## AXPM 병목과 적용

기존 감시는 81개 파일을 ID 순서로 최대 15개씩 읽었다. 실제 로그의 한 순환은 약 20분이다. 120초는 편집 종료 후 보장 시간이 아니라 동일 내용을 두 번 읽는 최소 간격이므로, 새 탭이 후순위이면 오래 대기한다.

현재 적용(시간 기반 판정은 후속 사용자 요청으로 제거):

1. 파일 version과 설정 hash를 Firestore에 보관하고 변경 없는 완료/미완성 파일은 본문 읽기를 생략한다. 6시간마다 전체 대조하며 설정 변경과 원본 버전 변경은 즉시 무효화한다.
2. 최근 수정 신규 파일과 버전 변경 파일을 먼저 처리하고 실패 재시도 대상을 뒤이어 처리한다. 대량 편집 시 즉시 반영이나 정확한 2분 완료를 보장하지 않는다.
3. 완료 후보가 있을 때만 마스터를 읽고 같은 실행에서 회사 매핑을 공유한다. 보고서 감시에서 쓰지 않는 홈 요약 범위 조회를 생략한다. 각 실제 쓰기는 여전히 새 원본 조회·계획 검증·잠금·반영 후 검증을 거친다.
4. 조회 오류와 일시적 마스터 버전 충돌은 재시도 시각을 저장하고 1분부터 최대 15분까지 간격을 늘린다. 원본 버전 변경은 대기를 해제한다. 회사 불일치와 불확실한 쓰기는 즉시 반복 실행하지 않는다.
5. 실행별 durationMs, eligibleFiles, skippedFiles를 최신 상태 및 에이전트 활동 원장에 남긴다.

기존 파일 체크포인트는 실패 상태에 따라 다음 전체 대조까지 남을 수 있다. 처리 규칙 변경 시 버전을 포함한 설정 hash로 재검증한다.

## 다음 적용 후보

- Drive 변경 목록 커서를 사용해 폴더 재귀 목록 조회도 줄이기. 이동·삭제·접근 권한 변경과 커서 만료 시 전체 재조사를 함께 설계해야 한다.
- 홈·관리자 화면의 동일 읽기에 사용자와 권한 범위를 포함한 single-flight 적용. 쓰기 검증에 오래된 캐시를 사용하지 않는다.
- 파일별 소요 시간과 실제 Google 호출 수, 편집→첫 감지→필드 검증→쓰기 완료 시간을 기록하고 p50/p95 비교. 현재 durationMs는 실행 전체 시간이며 API 호출 수 계측은 아직 없다.
- 클라우드 상시 워커는 별도 배포 작업이다. 현재 Mac 로그인 서비스의 절전·로그아웃 제한은 이 최적화로 해결되지 않는다.

## QA 상태

새 큐 테스트는 변경 파일 우선순위, 변경 없는 파일 제외, 재시도 기한, 설정 변경, 6시간 전체 대조, 재시도 상한을 검증한다. 처리량 개선 비율은 아직 실측하지 않았다.

디자인워커스 4회차의 원본 파싱은 통과했으나 2026-09-17 01:55 UTC 점검에서 마스터 버전 변경으로 보류됐다. 큐 테스트 통과를 실제 시트 쓰기 완료로 간주하지 않는다. 후속 사용자 요청에 따라 명시된 작성일 필드 또는 회차 탭 날짜를 작성일로 쓰도록 변경했다.
