export function trackServerConnections(server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return { server, sockets };
}

export async function closeTrackedServers(trackedServers, { graceMs = 15_000 } = {}) {
  const closings = trackedServers.map(({ server }) => new Promise((resolve, reject) => {
    if (!server?.listening) { resolve(); return; }
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  }));
  let forcedSockets = 0;
  const timer = setTimeout(() => {
    for (const { sockets } of trackedServers) {
      for (const socket of sockets) {
        forcedSockets += 1;
        socket.destroy();
      }
    }
  }, graceMs);
  timer.unref();
  await Promise.all(closings);
  clearTimeout(timer);
  return { forcedSockets };
}
