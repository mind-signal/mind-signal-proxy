import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIoServer } from 'socket.io';
import { AddressInfo } from 'net';
import { createStatusRouter } from '../routes/status';
import type { StatusAck } from '../routes/status';
import { createApp } from '../index';
import { BeForwarder } from '../services/be-forwarder';

const TEST_SECRET = 'test-secret';

const validBody = { group_id: 'g1', subject_idx: 1, status: 'no_data', silent_seconds: 31 };

function makeApp(engineSecret: string = TEST_SECRET, ack: StatusAck = { ok: true }) {
  const statusForwarder = { forwardStatus: vi.fn(async () => ack) };
  const app = express();
  app.use(express.json());
  app.use('/status', createStatusRouter({ statusForwarder, engineSecret }));
  return { app, statusForwarder };
}

describe('POST /status — headset status router', () => {
  it('valid body + correct secret → 200 {ok:true}, forwards the four fields unchanged', async () => {
    const { app, statusForwarder } = makeApp();

    const res = await request(app)
      .post('/status')
      .set('x-engine-secret', TEST_SECRET)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(statusForwarder.forwardStatus).toHaveBeenCalledTimes(1);
    expect(statusForwarder.forwardStatus).toHaveBeenCalledWith(validBody);
  });

  it('silent_seconds omitted (disconnected) → 200, payload has no silent_seconds', async () => {
    const { app, statusForwarder } = makeApp();
    const body = { group_id: 'g1', subject_idx: 2, status: 'disconnected' };

    const res = await request(app).post('/status').set('x-engine-secret', TEST_SECRET).send(body);

    expect(res.status).toBe(200);
    expect(statusForwarder.forwardStatus).toHaveBeenCalledWith(body);
  });

  it('unknown extra fields are stripped before forwarding', async () => {
    const { app, statusForwarder } = makeApp();

    await request(app)
      .post('/status')
      .set('x-engine-secret', TEST_SECRET)
      .send({ ...validBody, extra: 'x' });

    expect(statusForwarder.forwardStatus).toHaveBeenCalledWith(validBody);
  });

  it.each([
    ['missing group_id', { ...validBody, group_id: undefined }],
    ['non-integer subject_idx', { ...validBody, subject_idx: 1.5 }],
    ['missing status', { ...validBody, status: undefined }],
    ['non-numeric silent_seconds', { ...validBody, silent_seconds: 'long' }],
  ])('%s → 400 {error:"bad_request"}, not forwarded', async (_name, body) => {
    const { app, statusForwarder } = makeApp();

    const res = await request(app).post('/status').set('x-engine-secret', TEST_SECRET).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
    expect(statusForwarder.forwardStatus).not.toHaveBeenCalled();
  });

  it('missing x-engine-secret → 401, not forwarded', async () => {
    const { app, statusForwarder } = makeApp();

    const res = await request(app).post('/status').send(validBody);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(statusForwarder.forwardStatus).not.toHaveBeenCalled();
  });

  it('wrong x-engine-secret → 401', async () => {
    const { app, statusForwarder } = makeApp();

    const res = await request(app).post('/status').set('x-engine-secret', 'WRONG').send(validBody);

    expect(res.status).toBe(401);
    expect(statusForwarder.forwardStatus).not.toHaveBeenCalled();
  });

  it('empty configured secret → 401 even with matching empty header', async () => {
    const { app } = makeApp('');

    const res = await request(app).post('/status').set('x-engine-secret', '').send(validBody);

    expect(res.status).toBe(401);
  });

  it('retryable backend failure → 503 with the ack error', async () => {
    const { app } = makeApp(TEST_SECRET, { ok: false, retryable: true, error: 'ack_timeout' });

    const res = await request(app)
      .post('/status')
      .set('x-engine-secret', TEST_SECRET)
      .send(validBody);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'ack_timeout', retryable: true });
  });

  it('non-retryable backend failure → 502', async () => {
    const { app } = makeApp(TEST_SECRET, { ok: false, error: 'invalid_frame' });

    const res = await request(app)
      .post('/status')
      .set('x-engine-secret', TEST_SECRET)
      .send(validBody);

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ ok: false, error: 'invalid_frame', retryable: false });
  });

  it('createApp mounts /status (401 fail-closed without a configured secret)', async () => {
    const res = await request(createApp()).post('/status').send(validBody);

    expect(res.status).toBe(401);
  });
});

describe('BeForwarder.forwardStatus — mock backend', () => {
  let forwarder: BeForwarder | undefined;
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    forwarder?.disconnect();
    if (shutdown) await shutdown();
    forwarder = undefined;
    shutdown = undefined;
  });

  it('not connected → {ok:false, retryable:true, error:"backend_not_connected"}', async () => {
    forwarder = new BeForwarder();

    await expect(forwarder.forwardStatus(validBody)).resolves.toEqual({
      ok: false,
      retryable: true,
      error: 'backend_not_connected',
    });
  });

  it('emits proxy:status with the same four fields and returns the backend ack', async () => {
    const httpServer = createServer();
    const ioServer = new SocketIoServer(httpServer);
    const received: unknown[] = [];
    ioServer.of('/proxy').on('connection', (socket) => {
      socket.on('proxy:status', (payload: unknown, ackFn: (ack: StatusAck) => void) => {
        received.push(payload);
        ackFn({ ok: true });
      });
    });
    shutdown = () =>
      new Promise((resolve) => {
        ioServer.close(() => httpServer.close(() => resolve()));
      });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;

    forwarder = new BeForwarder();
    await forwarder.connect(`http://localhost:${port}`, TEST_SECRET);

    await expect(forwarder.forwardStatus(validBody)).resolves.toEqual({ ok: true });
    expect(received).toEqual([validBody]);
  });
});
