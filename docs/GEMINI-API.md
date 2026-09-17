# Gemini API 운영

AXPM은 기본적으로 앱 서버에서 Gemini API를 직접 호출한다. 별도 에이전트 서버는 필요하지 않다.

```dotenv
AGENT_ENGINE=builtin
AGENT_PROVIDER=gemini
AGENT_MODEL=사용할_모델_ID
GEMINI_API_KEY=비공개_API_키
```

`GEMINI_API_KEY`는 Secret Manager 또는 호스팅 플랫폼의 서버 전용 비밀로 주입한다. 브라우저 환경변수, 소스 코드, Git, 공개 설정 API에 넣지 않는다. 로그인한 허용 사용자는 서버를 통해 같은 운영 키를 사용한다.

사용자 요청은 인증 API, Gemini 함수 호출, 허용된 AXPM 도구, 최종 응답 순서로 처리된다. 제공되는 도구는 마스터 조회·기록, Drive 조사, 보고서 감시·파일명 정리로 제한된다. 모델 응답만으로 완료를 확정하지 않으며 쓰기 결과를 다시 읽어 검증한다.

Hermes 실행기가 필요한 환경에서는 `AGENT_ENGINE=hermes`와 `HERMES_BIN`을 추가하고 [HERMES.md](HERMES.md)를 따른다.

공식 자료: [API 키 보관](https://ai.google.dev/gemini-api/docs/api-key), [함수 호출](https://ai.google.dev/gemini-api/docs/function-calling).
