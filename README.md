# mind-signal-proxy

EEG 데이터 프록시 서버 (Node 20+, TypeScript, Express, Zod, socket.io-client).

`/register`, `/heartbeat`, `/ingest`, `/status`, `/control/assign-group` 엔드포인트가 배선돼 실제 서비스 로직을 수행합니다(`src/tests/index.wiring.test.ts`가 501이 아님을 단언). 현행 계약은 `../docs/architecture/api-contract.md`의 프록시 경유 계약 절, 4레포 공통 제품 문서는 `../docs/`, 작업 상태 정본은 `../.plans/DASHBOARD.md`입니다.

### POST /status (헤드셋 상태 경보)

데이터 엔진이 `MESSAGE_BUS=memory`일 때 Redis 대신 이 엔드포인트로 헤드셋 상태 경보를 보냅니다.

- 인증: `/ingest/sample`과 같은 `X-Engine-Secret` 헤더. 불일치하거나 프록시에 키가 없으면 401 `{ "error": "unauthorized" }`.
- 본문: `{ "group_id": string(1자 이상), "subject_idx": number(정수 1 또는 2), "status": string, "silent_seconds"?: number }`. 검증 실패 시 400 `{ "error": "bad_request", "details": [...] }`.
- 전달: 같은 네 필드를 백엔드 `/proxy` 네임스페이스에 `proxy:status` 이벤트로 1회 보냅니다. 백엔드 ack는 `proxy:sample`과 같은 `{ ok, retryable?, error? }`입니다.
- 응답: ack가 `ok: true`이면 200 `{ "ok": true }`. 실패하면 `{ "ok": false, "error", "retryable" }`를 돌려주며, 백엔드 미연결(`backend_not_connected`)과 ack 1초 초과(`ack_timeout`)와 재시도 가능 거부는 503, 그 밖의 거부는 502입니다.
- 샘플과 달리 재시도 큐에 쌓지 않습니다. 실패는 로그(`[status] backend delivery failed`)로만 남습니다.

---

## Operator-PC 설치 가이드

### 전제 조건

- Node.js 20 이상 설치
- npm 10 이상

### 설치 및 실행

```bash
# 의존성 설치 (lockfile 기준 재현 설치)
npm ci

# 전체 검증 (format:check → lint → typecheck → test → build)
npm run verify

# 개발 서버 기동 (ts-node 방식, hot-reload 없음)
npm run dev
```

### 환경 변수 설정

`.env.example`을 복사해 `.env` 파일 생성 후 값 입력:

```bash
cp .env.example .env
```

| 변수                | 기본값 | 설명                              |
| ------------------- | ------ | --------------------------------- |
| `PROXY_PORT`        | `5050` | 프록시 리스닝 포트                |
| `BACKEND_URL`       | (필수) | mind-signal-backend WebSocket URL |
| `ENGINE_SECRET_KEY` | (필수) | DE↔Proxy 인증 키                  |

---

## 필수 환경 조건 (RULE-1 ~ RULE-7)

- **RULE-1**: wired Ethernet — 노트북 B → 운영자 PC만 (DE_A↔Proxy는 loopback = 네트워크 jitter 0)
- **RULE-2**: dedicated LAN segment — 운영자 PC와 노트북 B 간 1개 wired link만 (스위치 또는 직접 LAN 케이블)
- **RULE-3**: fixed IP + KnownPeers 박제 — 노트북 B IP 고정 (discovery jitter 회피)
- **RULE-4**: WiFi 5-GHz 사용 시 Bluetooth 간섭 회피 (Cortex BT 신뢰성)
- **RULE-5**: effective_srate ≤ 0.01% 편차 모니터 (Mongo schema 의무 + alert)
- **RULE-6**: 5–30ms chunk size sweet spot, 100ms 초과 금지 (LSL 권고)
- **RULE-7**: stimulus broadcast = LAN-internal fan-out (프록시가 DE_A=loopback / DE_B=wired LAN 동시 송신 → jitter 최소화)

---

## 스크립트 목록

| 명령                   | 설명                        |
| ---------------------- | --------------------------- |
| `npm run build`        | TypeScript 컴파일 (`dist/`) |
| `npm start`            | 컴파일 결과 실행            |
| `npm run dev`          | tsx로 직접 실행 (개발용)    |
| `npm run typecheck`    | 타입 체크 (emit 없음)       |
| `npm run lint`         | ESLint 검사                 |
| `npm run format`       | Prettier 포맷 적용          |
| `npm run format:check` | Prettier 포맷 검사          |
| `npm test`             | Vitest 테스트 실행          |
| `npm run verify`       | 전체 검증 파이프라인        |

## 브랜치 이름

이 저장소의 기본 브랜치는 `main` 하나입니다. 작업 브랜치를 만들어 `main`으로 PR을 보냅니다.

브랜치 이름은 MindSignal 제품 공통 규칙을 따릅니다.

- 등록된 Work에 속한 작업: `{타입}/{work-id}-{작업명}`. 작업이 등록된 Work의 범위와 완료 조건에 들어가면 타입과 관계없이 Work ID 전체를 소문자로 바꿔 넣습니다. 실제 병합 이력의 예: `feat/ops-w013-proxy-status`
- Work에 속하지 않는 작업: `{타입}/{작업명}` 또는 `{타입}/{이슈번호}-{작업명}`. 형식 예: `fix/readme-link`, `fix/123-readme-link`
- Work에 속한 브랜치에는 이슈 번호를 Work ID 대신 쓰지 않습니다. 이슈는 PR 본문에서 연결합니다.
- 작업명은 영문 소문자, 숫자, 하이픈으로 씁니다.
- `{타입}`은 작업의 최종 목적에 따라 `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `revert`, `perf`, `style` 중 하나를 선택합니다.
- 운영 긴급 수정에는 브랜치 접두사 `hotfix`도 사용할 수 있습니다. `hotfix`는 커밋 유형이 아닙니다.
- 계획판에 접근할 수 없으면 전달받은 Work ID와 작업 범위로 판단합니다. Work ID를 전달받지 못했으면 Work에 속하지 않는 작업의 형식을 사용합니다.
- 이미 만든 브랜치는 이 규칙을 이유로 개명하지 않습니다.

Work ID는 제품 계획판의 작업 번호입니다(`{DOMAIN}-W{NNN}`, 예: `OPS-W015`). 규칙의 정본은 저장소 밖 `mind-signal/.plans/README.md`의 「브랜치 이름」 절입니다.
