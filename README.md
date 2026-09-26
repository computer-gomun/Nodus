# Nodus — AI 브레인스토밍 하네스

Nodus는 챗봇이 아닙니다. 여러 AI 에이전트가 하나의 주제를 두고 **자유롭게 토론**하고,
그 논의가 계속 자라나는 **아이디어 지도(Idea Graph)**로 시각화되며, 아무 노드에서나
**새 가지를 갈라내** 다른 방향을 탐색할 수 있습니다.

```
주제 → AI 자유 토론 → N턴마다 스냅샷 → 아이디어 지도
  → 노드 선택 → "여기부터 다시 토론" → 새 가지 → 분기
```

Nodus는 AI가 정답을 내미는 곳이 아니라, **AI와 함께 가능성을 탐색하는** 곳입니다.

## 기능

- 자유 다중 에이전트 토론 (2–5명, 고정 발언 순서 없음, 가중 스케줄러)
- SSE 스트리밍 응답 (`agent_start` / `token` / `agent_message` / …)
- 침묵하는 진행 도우미 (반복·주제 이탈·교착·충돌·결정 사항만 표면화)
- 결론 내기: 언제 끝낼지는 사람이 정합니다. "결론 내리기" 버튼을 누르면 지금까지의 논의를 정리한
  결론이 나옵니다(토론 중이면 현재 발언이 끝난 뒤). 결론은 대화에 남고 아이디어 지도에
  `conclusion` 노드로 고정됩니다.
- 점진적 아이디어 지도 (타입이 있는 노드/엣지, LLM 구조화 출력 + Pydantic 검증 + 재시도)
- 분기: 어떤 그래프 노드에서든 갈라내기, 맥락 + 그래프 상속, 부모는 그대로 유지
- 처음부터 다시 시작: 대화·아이디어 지도를 물려받지 않는 새 토론을 만들어 그쪽으로 이동
  (기존 토론은 그대로 남고, 진행 중이었다면 현재 발언 뒤 멈춥니다)
- 언제든 사용자 개입 가능 (사용자 메시지는 AI 턴으로 세지 않음)
- PostgreSQL 저장, Docker Compose 한 방 실행
- 오프라인 데모 모드: `LLM_API_KEY`가 없어도 내장 mock 프로바이더가
  토론 + 지도 + 분기를 모두 쓸 수 있게 유지
- 라이트/다크 테마: 기본은 OS 설정을 따르고, 상단바에서 전환하며, 브라우저별로 기억
- 프로젝트 폴더 분석 과정 표시: 폴더 스캔 → 중요 파일 선정 → 파일 읽기 → 맥락 생성
  단계와 실시간 진행 상황(파일 수·읽은 양·선정된 파일 목록)을 패널에서 확인
- 노드 상세 패널 탭 전환: "이 아이디어 발언" ↔ "전체 대화"(근거 발언은 강조 표시)

## 구조

```
프론트엔드 (React + React Flow, SSE 클라이언트)
   │  REST + SSE
백엔드 (FastAPI)
   ├── 토론 엔진 → 스케줄러 → LLM 프로바이더 (OpenAI 호환 / mock)
   ├── 진행 도우미 (휴리스틱 + LLM, 조건이 걸릴 때만 발화)
   ├── 그래프 추출기 (구조화 JSON) → 그래프 매니저 (점진적 병합)
   └── 분기 매니저 (+ 맥락 빌더) → PostgreSQL
```

## 기술 스택

프론트엔드: React, TypeScript, Vite, React Flow, 순수 CSS.
백엔드: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), httpx, SSE.
인프라: Docker, Docker Compose, PostgreSQL 16.

## 실행하기

### Docker (권장)

```bash
cp .env.example .env        # 실제 모델을 쓰려면 LLM_API_KEY를 채우세요
docker compose up --build
```

- 프론트엔드: http://localhost:3000
- 백엔드: http://localhost:8000 (`GET /api/health`)
- Postgres: localhost:5432 (user/password/db: `nodus`)

`LLM_API_KEY`가 없으면 백엔드는 mock 모드로 돌아갑니다 — 네트워크 없이 전부 동작합니다.

### Windows 원클릭 (`run.bat`)

백엔드 venv와 `frontend/node_modules`가 준비돼 있으면(아래 참고) `run.bat`을 더블클릭하세요.
백엔드(:8000)와 프론트엔드(:5173)를 콘솔 창 하나에서 띄우고, 둘 다 응답할 때까지 기다린 뒤
http://localhost:5173 을 엽니다. 그 창을 닫으면 둘 다 종료됩니다. 백엔드와 프론트엔드 로그는
같은 창에 함께 출력됩니다.

### 로컬 개발

백엔드:

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install -r requirements.txt
cp .env.example .env                              # 기본 sqlite라 그대로 동작합니다
uvicorn app.main:app --reload
```

프론트엔드:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                                       # http://localhost:5173
```

## 환경 변수

| 변수 | 의미 | 기본값 |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy async URL (postgres `postgresql+asyncpg://…` 또는 sqlite `sqlite+aiosqlite://…`) | sqlite 파일 |
| `LLM_API_KEY` | API 키 (백엔드 전용, 프론트엔드에는 노출되지 않음). 비어 있으면 mock 모드 | "" |
| `LLM_BASE_URL` | OpenAI 호환 base URL | `https://api.openai.com/v1` |
| `LLM_MODEL` | 기본 모델 | `gpt-4o-mini` |
| `LLM_DEBATE_MODEL` / `LLM_GRAPH_MODEL` / `LLM_MODERATOR_MODEL` | 역할별 오버라이드 | `LLM_MODEL`로 폴백 |
| `CORS_ORIGINS` | 허용할 프론트엔드 오리진 | localhost 개발 포트 |

## 토론은 이렇게 돌아갑니다

- 1턴 = AI 메시지 1개. 사용자 메시지와 진행 도우미 메모는 세지 않습니다.
- `POST /api/discussions/{id}/start {"turns": N}` 이 백그라운드에서 N턴을 돌립니다.
- 매 턴: 스케줄러가 발언자를 고르고(연속 발언은 감점, 아직 말하지 않은 쪽은 우대) →
  에이전트가 SSE로 토큰을 스트리밍 → 메시지가 턴 번호와 함께 저장됩니다.
- 에이전트 시스템 프롬프트에는 *성향*(아이디어 제시, 비판, 대안, 실현 가능성, 엉뚱한 발상)과
  말투 규칙(아주 쉬운 한국어, 짧은 문장, 전문용어·영어 약어·비즈니스 유행어 금지,
  건방지고 도발적인 반말 — 욕설·혐오 표현은 금지)만 담깁니다 — 대본이나 순서는 결코 넣지 않습니다.
- 토론을 언제 끝낼지는 자동으로 판단하지 않습니다. 사람이 "결론 내리기"를 누르면 진행 중인 토론은
  현재 발언이 끝나는 즉시, 멈춰 있는 토론은 바로 결론을 냅니다.

## 결론은 이렇게 쓰입니다

- 결론은 사람이 "결론 내리기"를 누를 때만 나옵니다 — 자동으로 판단해 끝내지 않습니다.
- 두 단계로 씁니다: 먼저 대화 전체를 `합의 / 반박됨 / 미해결 / 제안`으로 분류하고,
  그 분석을 근거로 최종 결론을 작성합니다(분석은 화면에 나오지 않고 결론에만 반영됩니다).
- 출력 형식은 항상 `결론` → `남은 쟁점` → `제안 / 다음 행동` 3단입니다.
- 원래 주제의 질문에 직접 답합니다. 토론이 다른 기준으로 새더라도 원래 질문을 기준으로 쓰고,
  판단이 나오지 않았으면 "명확한 결론에 도달하지 못했다"고 적습니다.
- 마지막 발언은 결론이 아닙니다. 여러 번 지지되고 끝까지 반박되지 않은 주장만 결론이 됩니다.
- 반박당한 주장은 결론 근거로 쓰지 않고, 충돌하는 주장은 "의견이 갈렸다"로 남깁니다.
  토론에서 나온 제안은 합의가 아니면 결론이 아니라 제안으로 남습니다.

## 아이디어 지도는 이렇게 만들어집니다

- `graph_interval` AI 턴마다(사용자 설정: 5/10/20/30/50/직접 입력) 백엔드가 최근 메시지와
  기존 노드를 그래프 모델에 구조화 출력으로 보냅니다.
- 출력은 Pydantic(`GraphSnapshot`)으로 검증하고, 실패하면 재시도한 뒤 복구 파싱합니다.
- 병합은 점진적입니다: 일치하는 노드(id로 먼저, 그다음 label로)는 갱신하고 엣지는 추가하며,
  무엇도 삭제하지 않습니다 — 뒤처진 아이디어는 `refined`/`merged`/`dropped`가 됩니다.
- 노드 타입: `idea question objection problem decision conclusion`.
  엣지 타입: `supports contradicts refines derives_from related_to duplicates`.

## 분기는 이렇게 동작합니다

- 노드를 클릭 → 상세 패널(설명, 연관 노드, 근거 발언) → **"여기부터 다시 토론"** →
  `POST /api/discussions/{id}/branches`.
- 자식 가지는 설정, 분기 지점까지의 대화, 그래프 전체 상태(새 id로)를 복사합니다.
  부모는 절대 수정되지 않습니다.
- 가지는 임의로 중첩됩니다(`Main → A → A-1 …`). 각 가지는 자체 턴 카운터와 스냅샷으로
  독립적으로 토론하며, 가지 칩으로 전환합니다.

## API (요약)

```
POST /api/projects                        프로젝트 생성 (+ 루트 가지)
GET  /api/projects                        목록
GET  /api/projects/{id}                   상세 + 가지 목록
POST /api/projects/{id}/discussions       루트 토론 추가
GET  /api/discussions/{id}                가지 상세 (메시지 + 그래프)
POST /api/discussions/{id}/start          N턴 실행 (SSE로 진행 상황 스트리밍)
POST /api/discussions/{id}/stop           중지 요청
POST /api/discussions/{id}/message        사용자 개입
POST /api/discussions/{id}/conclude       결론 내기 (사용자 요청)
GET  /api/discussions/{id}/stream         SSE 이벤트 스트림
GET  /api/discussions/{id}/graph          현재 그래프
POST /api/discussions/{id}/branches       노드에서 분기
POST /api/discussions/{id}/restart        처음부터 다시 시작 (새 토론)
GET  /api/branches/{id}                   가지 상세
GET  /api/health                          헬스 + LLM 상태
```

## 프로젝트 구조

`frontend/src`(`components/ graph/ chat/ settings/ api/ hooks/ types/`)와
`backend/app`(`api/ agents/ graph/ branching/ llm/ models/`)를 참고하세요.
