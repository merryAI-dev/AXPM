---
name: hwpx-documents
description: 한글 HWPX 문서의 읽기, 양식 매핑, 생성과 품질 검증. 한글 문서나 공문을 요청할 때 사용한다.
---

# 한글 문서 업무

기준 구현: https://github.com/jkf87/hwpx-skill (고정 리비전은 `references/hwpx-source.json`). 이 워크플로우는 AXPM용으로 작성했다. upstream 본문과 템플릿을 재배포하지 않는다.

1. 기존 XLSX 보고서는 원본 XLSX의 셀을 채운다. 한글 요청이 있다는 이유로 지정 양식을 임의 변환하지 않는다.
2. 한글 양식이 제공되면 파일·대상 구역·수정할 값·출처를 먼저 대조한다. 없는 기업명·일정·금액을 만들지 않는다.
3. 로컬 FDE/Claude 실행 환경에서는 `npm run hwpx:setup`으로 준비하고 아래 어댑터를 사용한다. 명령은 AXPM 저장소 루트 기준이다.
4. 기존 양식은 `analyze`로 구조를 읽고 `map`으로 치환 대상을 확인한 뒤 `fill`한다. 새 문서는 `build --schema`의 입력 계약을 따르는 JSON을 작성한다.
5. 출력·품질 리포트는 `private/`에 저장한다. 고객 원본을 덮어쓰지 않는다. 검증 실패나 남은 플레이스홀더를 완성본으로 전달하지 않는다.
6. `check --strict`의 정적 통과와 실제 한컴 페이지 렌더링·육안 검토는 별도 상태로 보고한다. `render`는 Windows 한컴 환경이 필요하며 macOS에서 성공했다고 표시하지 않는다.
7. HWP 바이너리와 HWPX는 다르다. Windows 한컴 환경에서는 upstream의 COM 변환을 우선 사용한다. 대체 변환 결과는 실제 한컴 열림 검증 없이 호환성을 단정하지 않는다.
8. 현재 Hermes 웹 실행은 AXPM MCP 도구로 제한된다. HWPX CLI가 설치되어 있어도 웹 에이전트가 이를 실행할 수 있다고 주장하지 않는다. HWPX 작업 도구가 제공되지 않았다면 명세·매핑안을 준비하고 FDE 실행 단계로 전달한다.

```sh
npm run hwpx -- analyze private/input.hwpx
npm run hwpx -- map dump private/input.hwpx
npm run hwpx -- map check private/input.hwpx --map private/map.json
npm run hwpx -- fill private/input.hwpx private/filled.hwpx --values private/values.json
npm run hwpx -- check private/filled.hwpx --strict
npm run hwpx -- build private/spec.json --report private/quality.json
npm run hwpx -- render private/filled.hwpx --output-dir private/hwpx-review
```

웹 뷰어도 같은 원칙을 따른다: 원본 구조에서 화면을 만들고, 편집 대상만 바꾸며, 미지원 그림·도형·페이지 기능을 숨기지 않는다. 미리보기와 원본 파일 검증을 따로 수행한다.
