import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeTrades,
  summarize,
  windowCoverage,
  reconcileLogs,
  EXCHANGE,
  mergeCandles,
} from "../src/lib/core.js";
import { collectRange, verifyLogReceipt } from "../src/lib/rpc.js";
import { HyperliquidFeed } from "../src/lib/feed.js";
const trade = (time, tid, side = "B", px = "10", sz = "2") => ({
  coin: "BTC",
  time,
  tid,
  side,
  px,
  sz,
});
test("duplicate, out-of-order and pre-session trade delivery", () => {
  const rows = mergeTrades(
    [],
    [trade(1100, 2), trade(1000, 1), trade(900, 0), trade(1100, 2)],
    1000,
    2000,
  );
  assert.deepEqual(
    rows.map((t) => t.tid),
    [1, 2],
  );
  assert.equal(mergeTrades(rows, [trade(1100, 2)], 1000, 2000).length, 2);
});
test("exact rolling boundary expires without further incoming trades; zero activity is undefined", () => {
  const rows = [trade(1000, 1), trade(1100, 2, "A")];
  const s = summarize(rows, "BTC", 2000, 1000);
  assert.equal(s.rows.length, 1);
  assert.equal(s.bias, -1);
  assert.equal(summarize(rows, "BTC", 3000, 1000).bias, null);
});
test("same filters drive tape and aggregate; opposite side is not an opening/close classification", () => {
  const s = summarize(
    [trade(1000, 1), trade(1100, 2, "A", "100", "2")],
    "BTC",
    2000,
    2000,
    30,
    "A",
  );
  assert.equal(s.total, 200);
  assert.equal(s.rows.length, 1);
  assert.equal(s.buy, 0);
});
test("retention and sample caps are deterministic and do not accept invalid values", () => {
  assert.deepEqual(
    mergeTrades(
      [],
      [
        trade(10, 1),
        trade(90, 2),
        trade(95, 3),
        trade(96, 4),
        trade(97, 5, "B", "NaN"),
      ],
      0,
      100,
      50,
      2,
    ).map((t) => t.tid),
    [3, 4],
  );
});
test("coverage distinguishes warmup, gaps and complete observed windows", () => {
  assert.equal(windowCoverage(0, 500, 1000, []), "Warming up");
  assert.equal(
    windowCoverage(0, 2000, 1000, [{ from: 1100, to: 1300 }]),
    "Gap / incomplete",
  );
  assert.equal(windowCoverage(0, 2000, 1000, [], 1200), "Warming up");
  assert.equal(
    windowCoverage(0, 2000, 1000, [{ from: 10, to: 20 }]),
    "Observed window",
  );
});
const log = (hash, block = "0xa") => ({
  address: EXCHANGE,
  blockHash: hash,
  transactionHash: "0xtx",
  blockNumber: block,
  transactionIndex: "0x0",
  logIndex: "0x0",
  topics: ["0xsignature"],
  data: "0x",
});
test("raw log replacement preserves orphan evidence, deduplicates, and handles removed logs", () => {
  let logs = reconcileLogs([], [log("old"), log("old")], 10n, 10n);
  assert.equal(logs.length, 1);
  logs = reconcileLogs(logs, [log("new")], 10n, 10n);
  assert.equal(logs.filter((l) => l.canonical).length, 1);
  assert.equal(logs.find((l) => l.blockHash === "old").canonical, false);
  logs = reconcileLogs(logs, [{ ...log("new"), removed: true }], 10n, 10n);
  assert.equal(logs.filter((l) => l.canonical).length, 0);
});
test("successful empty authoritative range removes old membership; other ranges unchanged", () => {
  const logs = reconcileLogs(
    [log("a"), { ...log("b", "0xb"), canonical: true }],
    [],
    10n,
    10n,
  );
  assert.equal(logs[0].canonical, false);
  assert.equal(logs[1].canonical, true);
});
test("RPC collector starts at head and never advances caller cursor after a failed range", async () => {
  const original = globalThis.fetch,
    requests = [];
  globalThis.fetch = async (_url, options) => {
    const r = JSON.parse(options.body);
    requests.push(r);
    return {
      ok: true,
      json: async () => ({
        result:
          r.method === "eth_chainId"
            ? "0x3e7"
            : r.method === "eth_blockNumber"
              ? "0x64"
              : [],
      }),
    };
  };
  try {
    const originalState = { logs: [] };
    const result = await collectRange(originalState, "https://example.com");
    assert.equal(result.startBlock, "100");
    assert.equal(result.cursor, "100");
    assert.equal(requests[2].params[0].fromBlock, "0x64");
    assert.equal(originalState.cursor, undefined);
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ error: { code: -32005, message: "quota" } }),
    });
    await assert.rejects(collectRange(result, "https://example.com"), /quota/);
    assert.equal(result.cursor, "100");
  } finally {
    globalThis.fetch = original;
  }
});
test("RPC resumes saved start with overlap and bounded batches", async () => {
  const original = globalThis.fetch,
    requests = [];
  globalThis.fetch = async (_url, options) => {
    const r = JSON.parse(options.body);
    requests.push(r);
    return {
      ok: true,
      json: async () => ({
        result:
          r.method === "eth_chainId"
            ? "0x3e7"
            : r.method === "eth_blockNumber"
              ? "0x3e8"
              : [],
      }),
    };
  };
  try {
    const r = await collectRange(
      { startBlock: "100", cursor: "200", logs: [] },
      "https://example.com",
    );
    assert.equal(requests[2].params[0].fromBlock, "0xc1");
    assert.equal(r.cursor, "392");
    assert.equal(r.head, "1000");
  } finally {
    globalThis.fetch = original;
  }
});
test("wrong chain and backwards provider do not produce a new state", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ result: "0x1" }),
    });
    await assert.rejects(
      collectRange({ logs: [] }, "https://example.com"),
      /Wrong chain/,
    );
    globalThis.fetch = async (_u, o) => ({
      ok: true,
      json: async () => ({
        result: JSON.parse(o.body).method === "eth_chainId" ? "0x3e7" : "0x10",
      }),
    });
    await assert.rejects(
      collectRange(
        { startBlock: "1", cursor: "20", logs: [] },
        "https://example.com",
      ),
      /behind/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("repeated candle updates replace the current candle; no pre-session completed candles", () => {
  const c = {
    s: "BTC",
    i: "1m",
    t: 1000,
    T: 2000,
    o: "10",
    h: "12",
    l: "9",
    c: "11",
  };
  const result = mergeCandles(
    [],
    [c, { ...c, c: "12" }, { ...c, t: 0, T: 999 }],
    1500,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].c, "12");
});
test("first-launch boundary is checkpointed before a failed logs request", async () => {
  const original = globalThis.fetch;
  let checkpoint;
  globalThis.fetch = async (_u, o) => {
    const method = JSON.parse(o.body).method;
    return {
      ok: true,
      json: async () =>
        method === "eth_getLogs"
          ? { error: { code: -1, message: "limited" } }
          : { result: method === "eth_chainId" ? "0x3e7" : "0x64" },
    };
  };
  try {
    await assert.rejects(
      collectRange({ logs: [] }, "https://example.com", async (s) => {
        checkpoint = s;
      }),
      /limited/,
    );
    assert.equal(checkpoint.startBlock, "100");
    assert.equal(checkpoint.cursor, "99");
  } finally {
    globalThis.fetch = original;
  }
});
test("raw receipt proof checks payload identity and refuses mismatches", async () => {
  const original = globalThis.fetch,
    l = log("hash");
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ result: { blockHash: "hash", logs: [l] } }),
    });
    assert.equal(
      (await verifyLogReceipt(l, "https://example.com")).match,
      true,
    );
    await assert.rejects(
      verifyLogReceipt({ ...l, data: "0xchanged" }, "https://example.com"),
      /mismatch/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("WebSocket restart ignores late old-socket callbacks and posts read-only info requests", async () => {
  const Original = globalThis.WebSocket,
    sockets = [],
    received = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() {
      sockets.push(this);
    }
    send(s) {
      this.sent.push(JSON.parse(s));
    }
    close() {}
  }
  globalThis.WebSocket = Socket;
  const f = new HyperliquidFeed(
    (m) => received.push(m),
    () => {},
    () => {},
  );
  try {
    f.start();
    const old = sockets[0];
    old.onopen();
    assert.equal(old.sent.length, 18);
    assert.deepEqual(
      old.sent
        .filter(
          (m) =>
            m.subscription.type === "candle" && m.subscription.coin === "BTC",
        )
        .map((m) => m.subscription.interval),
      ["1m", "5m", "15m"],
    );
    f.stop();
    f.start();
    const current = sockets[1];
    current.onopen();
    old.onclose();
    old.onmessage({ data: '{"channel":"trades","data":[]}' });
    assert.equal(received.length, 0);
    assert.equal(f.socket, current);
    assert.equal(f.retry, undefined);
    const pending = f.postInfo({ type: "l2Book", coin: "BTC" }),
      request = current.sent.at(-1);
    assert.equal(request.method, "post");
    assert.equal(request.request.type, "info");
    current.onmessage({
      data: JSON.stringify({
        channel: "post",
        data: {
          id: request.id,
          response: { type: "info", payload: { data: { levels: [[], []] } } },
        },
      }),
    });
    assert.deepEqual(await pending, { data: { levels: [[], []] } });
  } finally {
    f.stop();
    globalThis.WebSocket = Original;
    for (const s of sockets) s.onclose?.();
  }
});
