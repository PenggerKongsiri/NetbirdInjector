import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { closeTrackedServers, trackServerConnections } from '../src/lib/shutdown.mjs';

test('graceful close drains ordinary requests and bounds upgraded sockets', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  server.on('upgrade', (_req, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
  const tracked = trackServerConnections(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const socket = net.connect(server.address().port, '127.0.0.1');
  socket.write('GET /socket HTTP/1.1\r\nHost: test.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  await once(socket, 'data');
  const socketClosed = once(socket, 'close');
  const started = Date.now();
  const result = await closeTrackedServers([tracked], { graceMs: 25 });
  await socketClosed;
  assert.ok(Date.now() - started >= 20);
  assert.equal(result.forcedSockets, 1);
  assert.equal(socket.destroyed, true);
  assert.equal(server.listening, false);
});
