import { useEffect, useRef, useState } from 'react';

type Message = { type: string; payload?: unknown };

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000];

export function useWebSocket(url: string) {
  const [lastMessage, setLastMessage] = useState<Message | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}${url}`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        const attempt = reconnectAttemptRef.current;
        const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
        reconnectAttemptRef.current = attempt + 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after; no need to set state here
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as Message;
          setLastMessage(msg);
        } catch {
          // ignore
        }
      };
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [url]);

  return { lastMessage, connected };
}
