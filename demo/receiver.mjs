import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const WEBHOOK_HOST = '127.0.0.1';
const CONTROL_HOST = '127.0.0.1';
const WEBHOOK_PORT = 4000;
const CONTROL_PORT = 4001;
const MAX_BODY_BYTES = 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;

let mode = 'succeed';
let signingSecret;

const readBody = async (request) => {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

const sendJson = (response, statusCode, body) => {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const isValidSignature = (body, deliveryId, timestamp, signature) => {
  if (!signingSecret || !deliveryId || !timestamp || !signature) {
    return false;
  }

  const timestampSeconds = Number(timestamp);

  if (
    !Number.isInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', signingSecret)
    .update(`${timestamp}.${deliveryId}.`)
    .update(body)
    .digest('hex')}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

const webhookServer = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://demo.local').pathname;

  if (request.method !== 'POST' || pathname !== '/webhooks') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  try {
    const body = await readBody(request);
    const deliveryId = request.headers['x-delivery-id'];
    const timestamp = request.headers['x-webhook-timestamp'];
    const signature = request.headers['x-webhook-signature'];

    if (
      typeof deliveryId !== 'string' ||
      typeof timestamp !== 'string' ||
      typeof signature !== 'string' ||
      !isValidSignature(body, deliveryId, timestamp, signature)
    ) {
      console.log('[receiver] rejected a request with an invalid signature or timestamp');
      sendJson(response, 401, { error: 'Invalid webhook signature.' });
      return;
    }

    const payload = JSON.parse(body.toString('utf8'));
    console.log(
      `[receiver] delivery=${deliveryId} signature=valid mode=${mode} payload=${JSON.stringify(payload)}`,
    );

    if (mode === 'fail') {
      sendJson(response, 503, { error: 'Intentional demo failure.' });
      return;
    }

    response.writeHead(204);
    response.end();
  } catch (error) {
    console.error('[receiver] request failed', error);
    sendJson(response, 400, { error: 'Invalid request body.' });
  }
});

const controlServer = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://demo-control.local').pathname;

  try {
    if (request.method === 'GET' && pathname === '/state') {
      sendJson(response, 200, { mode, secretConfigured: signingSecret !== undefined });
      return;
    }

    if (request.method === 'POST' && pathname === '/secret') {
      const secret = (await readBody(request)).toString('utf8').trim();

      if (!secret) {
        sendJson(response, 400, { error: 'A signing secret is required.' });
        return;
      }

      signingSecret = secret;
      console.log('[receiver] signing secret configured');
      sendJson(response, 200, { secretConfigured: true });
      return;
    }

    if (request.method === 'POST' && pathname === '/mode/succeed') {
      mode = 'succeed';
      console.log('[receiver] mode changed to succeed');
      sendJson(response, 200, { mode });
      return;
    }

    if (request.method === 'POST' && pathname === '/mode/fail') {
      mode = 'fail';
      console.log('[receiver] mode changed to fail');
      sendJson(response, 200, { mode });
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    console.error('[receiver] control request failed', error);
    sendJson(response, 400, { error: 'Invalid control request.' });
  }
});

webhookServer.listen(WEBHOOK_PORT, WEBHOOK_HOST, () => {
  console.log(`[receiver] webhook endpoint: http://${WEBHOOK_HOST}:${WEBHOOK_PORT}/webhooks`);
});

controlServer.listen(CONTROL_PORT, CONTROL_HOST, () => {
  console.log(`[receiver] local controls: http://${CONTROL_HOST}:${CONTROL_PORT}`);
  console.log('[receiver] waiting for the demo runner');
});

let isShuttingDown = false;

const shutdown = () => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  Promise.all([
    new Promise((resolve) => webhookServer.close(resolve)),
    new Promise((resolve) => controlServer.close(resolve)),
  ]).catch((error) => {
    console.error('[receiver] shutdown failed', error);
    process.exitCode = 1;
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
