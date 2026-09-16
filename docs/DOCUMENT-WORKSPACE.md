# 문서를 보면서 편집하는 운영실

파일을 열면 원본 XLSX의 병합·서식·행 높이·열 너비·삽입 그림으로 만든 문서를 먼저 보여준다. 셀 매핑은 접힌 설정으로 이동했다. 보고서 영역/전체 시트, 폭 맞춤/확대·축소, 전체 화면을 지원한다. 선택한 셀의 전체 내용은 편집 패널에 표시하며 수정 즉시 문서에 반영한다. 저장 전 변경 표시, 셀별 되돌리기, 변경 대조와 기존 저장/승인 흐름을 유지한다.

## 참고한 구현과 적용 범위

- [ONLYOFFICE Docs](https://api.onlyoffice.com/docs/docs-api/get-started/basic-concepts/): 애플리케이션 안에 문서 편집 환경을 통합하는 방식을 참고했다. 이번 변경은 ONLYOFFICE 서버를 설치하거나 실시간 공동 편집을 구현한 것이 아니다.
- [PDF.js](https://mozilla.github.io/pdf.js/): 문서 렌더링을 독립된 뷰어로 다루는 방식에서 아이디어를 얻었다. XLSX를 PDF.js로 렌더링하지는 않는다.
- [jkf87/hwpx-skill](https://github.com/jkf87/hwpx-skill): 원본 보존·입력 계약·치환 전 확인·출력 검사와 실제 페이지 검토의 분리를 업무 지침에 반영했다. 로컬 실행 어댑터는 `scripts/hwpx.mjs`다.

## 실제 연결

`workbooks/read`와 `drive/read`에 `preview: true`를 전달하면 인증·사용자/폴더 범위 검사 후 `SheetView`를 반환한다. 일반 MCP 셀 조회에는 그림과 전체 문서 본문을 추가하지 않는다. 로컬 XLSX와 Drive XLSX는 같은 파서를 사용한다. Google Sheets는 Sheets API의 실제 formattedValue/effectiveFormat/merges/행·열 크기를 읽는다.

브라우저에는 원본을 제3자 문서 서비스에 업로드하지 않고 JSON geometry와 인라인 그림만 전달한다. 문서 텍스트는 React 텍스트 노드로 표시한다. 하이퍼링크나 수식을 실행하지 않는다. 변경은 기존 매핑/수식/병합 첫 셀 제한을 따르며 원본 ZIP 패치와 저장 후 재검증을 유지한다. 서버 변경 충돌·승인·백업 규칙도 그대로 적용된다.

## 렌더링의 경계

이 뷰어는 셀과 그림 기반의 읽기·편집 미리보기다. Excel의 인쇄 엔진을 그대로 실행하는 것이 아니다. 설치 글꼴과 브라우저의 글자 폭 차이, 사용자 지정 숫자 표시 형식, 테마 tint, 조건부 서식, 차트·도형·인쇄 페이지 구분까지 완전히 재현하지 않는다. 원본 높이에 비해 긴 내용은 셀에서 잘릴 수 있지만 선택 패널에서 전체를 읽고 편집할 수 있다. 다운로드한 XLSX는 기존 서식과 ZIP 내용을 보존한다.

미리보기는 첫 500행·60열, 삽입 그림 8MB로 제한하며 잘린 범위는 안내한다. 보고서 영역은 매핑된 셀과 병합 범위를 기준으로 결정하고 해당 열의 제목·본문·사진까지 표시한다. 전체 시트 버튼으로 주변 안내 내용도 볼 수 있다. Google Sheets의 떠 있는 그림·차트는 API 미리보기에서 제공하지 않으므로 원본 확인 안내를 표시한다.

## 한글 HWPX 로컬 도구

```sh
npm run hwpx:setup
npm run hwpx -- build --schema
npm run hwpx -- build examples/hwpx-monitor-report.json --report private/hwpx/quality.json
npm run hwpx -- analyze private/hwpx/monitor-report.hwpx
npm run hwpx -- check private/hwpx/monitor-report.hwpx --strict
```

고정 upstream 리비전은 `references/hwpx-source.json`에 기록한다. 해당 리비전에서 저장소 전체 라이선스를 찾지 못했으므로 원본 소스·템플릿을 AXPM 공개 Git에 재배포하지 않고 설치 시 upstream에서 로컬로 받는다. AXPM 어댑터·출처·예시·업무 스킬은 커밋한다. Python 환경과 생성 문서는 `private/`에 둔다.

`convert`는 Windows에서 한컴 COM 스크립트를 우선 실행한다(`input.hwp -OutputDirectory private/converted`). 다른 플랫폼에서는 upstream 대체 변환기를 사용한다. Windows 변환은 이번 macOS 검증에 포함하지 않았다. 실제 한컴 렌더러는 Windows 한컴 환경을 요구한다. macOS에서는 생성·구조·참조·본문·필수 문구 검사를 수행하고 한컴 열림/페이지 렌더/육안 검토를 `not_run`으로 구분한다. 현재 웹 화면의 HWP/HWPX 업로드·페이지 편집과 Hermes용 HWPX 실행 MCP 도구는 아직 제공하지 않는다. Hermes에는 문서 업무 지침을 탑재해 요구·근거·매핑안을 준비하도록 하며, 실행은 FDE CLI에서 한다.

## 확인 명령

```sh
npm test
npm run typecheck
npm run build
npm run check:viewer
# 실제 고객 양식은 private 파일 경로로 지정
npm run check:viewer -- --template '/absolute/path/report.xlsx'
```

브라우저 검사는 새 업로드 사본 하나만 만들고 검사 후 지운다. 자동 렌더링·그림·셀 편집·전체 화면·미저장 시트 전환 경고·저장/다운로드·원본 ZIP 보존·모바일 넘침을 확인한다. 스크린샷은 `private/validation/document-viewer`에 저장한다.
