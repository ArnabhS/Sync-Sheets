import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { env } from './config/env';
import { createApp } from './app';

const clients = new Set<WebSocket>();

function broadcast(payload: object): void {
  const msg = JSON.stringify(payload);
  clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

(async () => {
  try {
    const { app } = await createApp(broadcast);
    const server = createServer(app);

    const wss = new WebSocketServer({ server, path: env.wsPath });

    wss.on('connection', (ws: WebSocket) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'connected', payload: { at: new Date().toISOString() } }));
    });

    server.listen(env.port, () => {
      console.log(`Server listening on http://localhost:${env.port}`);
      console.log(`WebSocket on ws://localhost:${env.port}${env.wsPath}`);
    });
  } catch (e) {
    console.error('Failed to start server:', e);
    process.exit(1);
  }
})();
