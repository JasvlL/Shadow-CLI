/**
 * The approval channel.
 *
 * agy runs in its own process, so its PreToolUse hook cannot reach the running IDE
 * directly. This opens a tiny loopback endpoint the hook can ask through, which is what
 * lets a Gemini lead's tool call surface as the same approval banner a Claude lead's
 * does.
 *
 * ⚠️ This endpoint grants permission to run tools. Its whole security model is:
 *   - bound to 127.0.0.1, never a routable interface
 *   - a random per-session token, required on every request
 *   - one accepted shape, on one path; anything else is rejected unread
 *   - lifetime tied to the IDE — it stops listening when the session ends
 * A wrong token gets 403 without the user ever being asked, so a local process that
 * guessed the port still cannot make the IDE prompt for it.
 */

import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface ApprovalRequest {
  tool: string;
  detail: string;
}

export interface ApprovalServer {
  port: number;
  token: string;
  close: () => void;
}

const MAX_BODY_BYTES = 16_384;

/**
 * Start the endpoint. `ask` is the IDE's own approval prompt, so the hook and the
 * in-process gate ask the user in exactly the same way.
 */
export async function startApprovalServer(
  ask: (tool: string, detail: string) => Promise<boolean>,
): Promise<ApprovalServer> {
  const token = randomBytes(24).toString('hex');

  const server: Server = createServer((req, res) => {
    const reject = (code: number, message: string) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };

    if (req.method !== 'POST' || req.url !== '/approve') return reject(404, 'not found');
    // Constant-ish comparison is overkill for a loopback token, but rejecting before
    // reading the body means a bad caller never reaches the user.
    if (req.headers['x-shadow-token'] !== token) return reject(403, 'bad token');

    let body = '';
    let tooBig = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > MAX_BODY_BYTES) {
        tooBig = true;
        req.destroy();
      }
    });

    req.on('end', () => {
      if (tooBig) return;
      let parsed: Partial<ApprovalRequest>;
      try {
        parsed = JSON.parse(body);
      } catch {
        return reject(400, 'bad json');
      }
      if (typeof parsed.tool !== 'string' || typeof parsed.detail !== 'string') {
        return reject(400, 'bad shape');
      }

      void ask(parsed.tool, parsed.detail)
        .then((approved) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ approved }));
        })
        .catch(() => reject(500, 'ask failed'));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port 0 asks the OS for a free port; loopback only.
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  // Do not hold the process open: if the IDE exits, so does this.
  server.unref();

  return {
    port,
    token,
    close: () => server.close(),
  };
}
