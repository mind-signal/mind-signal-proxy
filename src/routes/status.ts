import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';

/**
 * DE→Proxy 헤드셋 상태 경보 본문. BE로 전달하는 `proxy:status` payload와 같은 네 필드임.
 * group_id 최소 길이와 subject_idx 범위는 BE 검증과 같게 둠 — BE가 거부할 입력을
 * 프록시가 통과시키면 엔진은 400이 아닌 502를 받아 원인을 알 수 없음.
 */
export const HeadsetStatusSchema = z.object({
  group_id: z.string().min(1),
  subject_idx: z.number().int().min(1).max(2),
  status: z.string(),
  silent_seconds: z.number().optional(),
});

export type HeadsetStatus = z.infer<typeof HeadsetStatusSchema>;

/** BE ack 형태 — `proxy:sample`과 같은 계약임. */
export interface StatusAck {
  ok: boolean;
  retryable?: boolean;
  error?: string;
}

/** ingest.ts의 port 관례와 같은 narrow structural port임 (vi mock 직접 할당 가능). */
export interface StatusForwarderPort {
  forwardStatus(status: HeadsetStatus): Promise<StatusAck>;
}

export interface StatusRouterDeps {
  statusForwarder: StatusForwarderPort;
  engineSecret?: string; // 기본 config.ENGINE_SECRET_KEY
}

/**
 * DE→Proxy 헤드셋 상태 경보 라우터 생성함.
 * route: POST / (mount /status). 인증과 검증은 /ingest/sample과 같은 방식임.
 * 경보는 샘플과 달리 큐에 쌓지 않음 — BE 전달 1회 시도 후 결과를 그대로 응답함.
 * @param deps statusForwarder(port, 의무) + engineSecret(옵션 DI)
 * @returns Express Router
 */
export function createStatusRouter(deps: StatusRouterDeps): Router {
  const { statusForwarder } = deps;
  const engineSecret = deps.engineSecret ?? config.ENGINE_SECRET_KEY;
  const router = Router();

  router.post('/', async (req, res) => {
    // 1. X-Engine-Secret 인증 — 빈 시크릿/불일치 fail-closed deny (ingest.ts와 동일)
    const inbound = req.headers['x-engine-secret'];
    if (engineSecret === '' || inbound !== engineSecret) {
      console.warn('[status] rejected unauthorized');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // 2. 본문 검증
    const parsed = HeadsetStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn(
        '[status] rejected bad_request:',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
      res.status(400).json({ error: 'bad_request', details: parsed.error.issues });
      return;
    }
    // 3. BE 전달 1회 시도. 실패는 재시도하지 않고 오류 응답과 로그로 남김
    const ack = await statusForwarder.forwardStatus(parsed.data);
    if (ack.ok) {
      res.status(200).json({ ok: true });
      return;
    }
    console.warn('[status] backend delivery failed:', { ...parsed.data, error: ack.error });
    res.status(ack.retryable ? 503 : 502).json({
      ok: false,
      error: ack.error ?? 'backend_rejected',
      retryable: ack.retryable === true,
    });
  });

  return router;
}
