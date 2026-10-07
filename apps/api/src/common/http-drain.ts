import type { Server } from 'node:http';
import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/** How often a connection that was mid-request when the close began is let go, once it has answered. */
const SWEEP_MS = 250;

/** What a request in flight gets to finish in; well inside the 30s a container is given to stop. */
export const SHUTDOWN_GRACE_MS = 10_000;

/** Ends every connection as it finishes its work while the server closes, and cuts whatever is left when the grace is over. */
export function drainConnections(server: Server, graceMs: number): void {
  // Before the app's own listener, so the header is set while it still can be: this answer is the connection's last.
  server.prependListener('request', (_request, response) => {
    response.setHeader('Connection', 'close');
  });
  // Node lets idle ones go once, as close() is called: one that was busy then would linger a keep-alive after answering.
  const sweep = setInterval(() => server.closeIdleConnections(), SWEEP_MS);
  const cut = setTimeout(() => server.closeAllConnections(), graceMs);
  server.once('close', () => {
    clearInterval(sweep);
    clearTimeout(cut);
  });
}

/** Starts the drain just before Nest closes the listener, so the workers' own shutdown is always reached. */
@Injectable()
export class HttpDrain implements BeforeApplicationShutdown {
  constructor(private readonly host: HttpAdapterHost) {}

  beforeApplicationShutdown(): void {
    drainConnections(this.host.httpAdapter.getHttpServer() as Server, SHUTDOWN_GRACE_MS);
  }
}
