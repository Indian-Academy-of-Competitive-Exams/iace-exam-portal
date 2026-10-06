import assert from 'node:assert/strict';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { drainConnections } from '../src/common/http-drain';

/** Far past any test: without the drain, a busy connection holds the close open this long after it answers. */
const KEEP_ALIVE_MS = 60_000;

const agents: http.Agent[] = [];
afterEach(() => {
  for (const agent of agents.splice(0)) agent.destroy();
});

async function serving(handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const { port } = server.address() as AddressInfo;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  agents.push(agent);

  const ask = () =>
    new Promise<number | string>((answered) => {
      http
        .get({ host: '127.0.0.1', port, agent }, (response) => {
          response.resume();
          response.on('end', () => answered(response.statusCode ?? 0));
        })
        .on('error', (error: NodeJS.ErrnoException) => answered(error.code ?? 'ERROR'));
    });
  const closed = () => new Promise<void>((done) => server.close(() => done()));
  return { server, ask, closed };
}

const within = async (limitMs: number, work: Promise<unknown>): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((over) => {
    timer = setTimeout(() => over(false), limitMs);
  });
  const done = await Promise.race([work.then(() => true), late]);
  clearTimeout(timer);
  return done;
};

describe('a server told to stop while a connection is busy', () => {
  /** The failure this prevents: one request in flight at SIGTERM holding the process open past its stop grace. */
  it('answers the request in flight, then closes without waiting out the keep-alive', async () => {
    const { server, ask, closed } = await serving((_request, response) => {
      setTimeout(() => response.end('ok'), 150);
    });
    const inFlight = ask();
    await new Promise((sent) => setTimeout(sent, 50));

    drainConnections(server, KEEP_ALIVE_MS);
    const finished = within(3_000, closed());

    assert.equal(await inFlight, 200);
    assert.equal(await finished, true);
  });

  /** The failure this prevents: a client that keeps asking on its open connection keeping the old process alive for good. */
  it('closes even while the client keeps using the connection', async () => {
    const { server, ask, closed } = await serving((_request, response) => {
      setTimeout(() => response.end('ok'), 100);
    });
    let asking = true;
    const client = (async () => {
      while (asking && (await ask()) === 200);
    })();
    await new Promise((sent) => setTimeout(sent, 150));

    drainConnections(server, KEEP_ALIVE_MS);
    const finished = await within(3_000, closed());
    asking = false;
    await client;

    assert.equal(finished, true);
  });

  it('cuts a request that never answers once the grace is over', async () => {
    const { server, ask, closed } = await serving(() => undefined);
    const stuck = ask();
    await new Promise((sent) => setTimeout(sent, 50));

    drainConnections(server, 300);

    assert.equal(await within(3_000, closed()), true);
    assert.notEqual(await stuck, 200);
  });
});
