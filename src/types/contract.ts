import { z } from 'zod';

/**
 * 엔진과 백엔드 사이에서 프록시가 지키는 계약을 한곳에 모은 모듈임.
 * 본문 형식, 백엔드 이벤트 이름, 네임스페이스, ack 형태를 여기서 정의함.
 */

export { SampleEnvelopeSchema, type SampleEnvelope } from './envelope';

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

/** Shape of the backend ack payload on event `proxy:sample`. */
export interface BeAck {
  ok: boolean;
  duplicate?: boolean;
  error?: string;
  retryable?: boolean;
}

/** BE ack 형태 — `proxy:sample`과 같은 계약임. */
export interface StatusAck {
  ok: boolean;
  retryable?: boolean;
  error?: string;
}

/** 백엔드 Socket.io 네임스페이스임. */
export const PROXY_NAMESPACE = '/proxy';

/** 프록시가 백엔드로 보내는 이벤트 이름임. */
export const PROXY_EVENT = {
  sample: 'proxy:sample',
  status: 'proxy:status',
} as const;
