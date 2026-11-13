import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candleRequest,
  historyComplete,
  PRICE_HISTORY_MS,
  PRICE_INTERVALS,
} from "../src/lib/price-history.js";
import { mergeCandles } from "../src/lib/core.js";
import {
  aggregateCandles,
  simpleMovingAverage,
  AtlasChart,
} from "../src/lib/atlas.js";
import { DeskController } from "../src/lib/desk-controller.js";
const now = 1800000000000;
function rows(coin, minutes, start, end = now) {
  const duration = minutes * 60000;
  return Array.from(
    { length: Math.floor((end - start) / duration) + 1 },
    (_, j) => ({
      s: coin,
      i: `${minutes}m`,
      t: start + j * duration,
      T: start + (j + 1) * duration - 1,
      o: "10",
      h: "12",
      l: "9",
      c: "11",
      v: "1",
      n: 1,
    }),
  );
}
test("48h plus full SMA200 warmup fits documented native interval limit", () => {
  for (const minutes of PRICE_INTERVALS) {
    const request = candleRequest("BTC", minutes, now),
      bars = rows("BTC", minutes, request.req.startTime);
    assert.ok(bars.length < 5000);
    assert.ok(now - bars[200].t >= PRICE_HISTORY_MS);
    const average = simpleMovingAverage(
      aggregateCandles(bars, minutes),
      200,
      minutes,
      now,
    );
    assert.ok(average[0].t <= now - PRICE_HISTORY_MS);
    assert.ok(historyComplete(bars, "BTC", minutes, now));
    assert.equal(
      historyComplete(
        bars.filter((_, i) => i !== 250),
        "BTC",
        minutes,
        now,
      ),
      false,
    );
    assert.ok(
      candleRequest("BTC", minutes, now, bars).req.startTime >=
        now - 2 * minutes * 60000,
    );
  }
});
test("retention is per market and interval; stale snapshot cannot regress live candle", () => {
  const btc = rows("BTC", 1, now - 5200 * 60000),
    eth = rows("ETH", 1, now - 5200 * 60000);
  const all = mergeCandles([], [...btc, ...eth], 0);
  assert.equal(all.filter((c) => c.s === "BTC").length, 5000);
  assert.equal(all.filter((c) => c.s === "ETH").length, 5000);
  const latest = { ...btc.at(-1), n: 20, c: "13" };
  const merged = mergeCandles([latest], [btc.at(-1)], 0);
  assert.equal(merged[0].c, "13");
  const native = rows("BTC", 5, now - 10 * 60000);
  assert.equal(aggregateCandles([...btc, ...native], 5).length, native.length);
});
test("startup backfill deduplicates calls and cannot write into a replacement journal", async () => {
  const controller = new DeskController();
  let resolve,
    calls = 0;
  controller.feed = {
    postInfo: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
  };
  const pending = controller.preloadCandles();
  await controller.preloadCandles();
  assert.equal(calls, 1);
  controller.state = { ...controller.state, candles: [] };
  resolve(rows("BTC", 1, now - 60000));
  await pending;
  assert.equal(controller.state.candles.length, 0);
  assert.equal(calls, 1);
});
test("opening viewport shows two days independently of the event filter", () => {
  const chart = Object.create(AtlasChart.prototype);
  chart.draw = () => {};
  chart.data = { now, lookback: 3600000, candles: [] };
  chart.fit(false);
  assert.equal(chart.view.from, now - PRICE_HISTORY_MS);
  const view = { ...chart.view };
  chart.setData({
    ...chart.data,
    candles: rows("BTC", 1, now - PRICE_HISTORY_MS),
  });
  assert.deepEqual(chart.view, view);
});
