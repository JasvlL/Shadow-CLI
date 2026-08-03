/**
 * The approval endpoint grants permission to run tools, so its refusals matter more
 * than its successes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startApprovalServer, type ApprovalServer } from '../src/approval-server.js';

let server: ApprovalServer | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function post(
  s: ApprovalServer,
  body: unknown,
  opts: { token?: string; path?: string; method?: string } = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${s.port}${opts.path ?? '/approve'}`, {
    method: opts.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token === undefined ? { 'x-shadow-token': s.token } : { 'x-shadow-token': opts.token }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('approval endpoint', () => {
  it('asks the IDE and returns its answer', async () => {
    const asked: string[] = [];
    server = await startApprovalServer(async (tool) => {
      asked.push(tool);
      return tool === 'view_file';
    });

    const yes = await post(server, { tool: 'view_file', detail: 'a.ts' });
    expect(await yes.json()).toEqual({ approved: true });

    const no = await post(server, { tool: 'run_command', detail: 'rm x' });
    expect(await no.json()).toEqual({ approved: false });
    expect(asked).toEqual(['view_file', 'run_command']);
  });

  it('rejects a bad token without ever asking the user', async () => {
    let asked = false;
    server = await startApprovalServer(async () => {
      asked = true;
      return true;
    });

    const response = await post(server, { tool: 'x', detail: 'y' }, { token: 'wrong' });
    expect(response.status).toBe(403);
    expect(asked).toBe(false);
  });

  it('rejects a missing token', async () => {
    server = await startApprovalServer(async () => true);
    const response = await fetch(`http://127.0.0.1:${server.port}/approve`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(403);
  });

  it('serves only POST /approve', async () => {
    server = await startApprovalServer(async () => true);
    expect((await post(server, {}, { path: '/other' })).status).toBe(404);

    // fetch refuses a body on GET, so this one is sent without one.
    const get = await fetch(`http://127.0.0.1:${server.port}/approve`, {
      method: 'GET',
      headers: { 'x-shadow-token': server.token },
    });
    expect(get.status).toBe(404);
  });

  it('rejects a body that is not an approval request', async () => {
    let asked = false;
    server = await startApprovalServer(async () => {
      asked = true;
      return true;
    });

    expect((await post(server, 'not json')).status).toBe(400);
    expect((await post(server, { tool: 'x' })).status).toBe(400);
    expect((await post(server, { tool: 1, detail: 2 })).status).toBe(400);
    expect(asked).toBe(false);
  });

  it('binds to loopback only', async () => {
    server = await startApprovalServer(async () => true);
    expect(server.port).toBeGreaterThan(0);
    // A fresh token per session; nothing derived from anything guessable.
    expect(server.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it('stops listening once closed', async () => {
    server = await startApprovalServer(async () => true);
    const { port, token } = server;
    server.close();
    server = null;

    await expect(
      fetch(`http://127.0.0.1:${port}/approve`, {
        method: 'POST',
        headers: { 'x-shadow-token': token },
        body: '{}',
      }),
    ).rejects.toThrow();
  });
});
