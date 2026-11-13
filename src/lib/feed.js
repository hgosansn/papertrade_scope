import { PRICE_INTERVALS } from "./price-history.js";
import { COINS } from "./core.js";
export class HyperliquidFeed {
  constructor(
    onMessage,
    onStatus,
    onGap,
    coins = COINS,
    types = ["trades", "candle", "activeAssetCtx", "bbo"],
  ) {
    Object.assign(this, {
      onMessage,
      onStatus,
      onGap,
      coins,
      types,
      attempts: 0,
      stopped: true,
      socket: null,
      pending: new Map(),
      nextId: 1,
    });
  }
  postInfo(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN || this.stopped)
      return Promise.reject(new Error("Connect the exchange feed first"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("WebSocket info request timed out"));
      }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(
        JSON.stringify({
          method: "post",
          id,
          request: { type: "info", payload },
        }),
      );
    });
  }
  rejectPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error("Exchange connection closed"));
    }
    this.pending.clear();
  }
  start() {
    this.stopped = false;
    this.connect();
  }
  connect() {
    if (this.stopped) return;
    this.onStatus("Connecting");
    const ws = (this.socket = new WebSocket("wss://api.hyperliquid.xyz/ws"));
    this.lastReceived = Date.now();
    const deadline = setTimeout(() => ws.close(), 15000);
    ws.onopen = () => {
      clearTimeout(deadline);
      if (this.socket !== ws || this.stopped) {
        ws.close();
        return;
      }
      this.attempts = 0;
      this.onStatus("Connected");
      for (const coin of this.coins)
        for (const type of this.types)
          for (const interval of type === "candle" ? PRICE_INTERVALS : [null])
            ws.send(
              JSON.stringify({
                method: "subscribe",
                subscription: {
                  type,
                  coin,
                  ...(type === "candle" ? { interval: `${interval}m` } : {}),
                },
              }),
            );
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 45000) {
          this.onStatus("Stale");
          ws.close();
        } else if (ws.readyState === WebSocket.OPEN)
          ws.send('{"method":"ping"}');
      }, 20000);
    };
    ws.onmessage = (event) => {
      if (this.socket !== ws || this.stopped) return;
      this.lastReceived = Date.now();
      try {
        const message = JSON.parse(event.data);
        if (message.channel === "post") {
          const p = this.pending.get(message.data?.id);
          if (p) {
            clearTimeout(p.timeout);
            this.pending.delete(message.data.id);
            const r = message.data.response;
            if (r?.type === "error")
              p.reject(new Error("WebSocket info request rejected"));
            else p.resolve(r?.payload);
          }
        }
        this.onMessage(message);
      } catch (e) {
        this.onStatus(`Message error: ${e.message}`);
      }
    };
    ws.onerror = () => {
      if (this.socket === ws && !this.stopped)
        this.onStatus("Connection error");
    };
    ws.onclose = () => {
      clearTimeout(deadline);
      if (this.socket !== ws) return;
      clearInterval(this.heartbeat);
      this.rejectPending();
      this.onGap(this.lastReceived);
      if (this.stopped) return;
      const delay =
        Math.min(30000, 1000 * 2 ** this.attempts++) + Math.random() * 500;
      this.onStatus("Reconnecting");
      this.retry = setTimeout(() => this.connect(), delay);
    };
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.rejectPending();
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.onStatus("Paused");
  }
}
