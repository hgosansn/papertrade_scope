import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AtlasChart,
  aggregateCandles,
  simpleMovingAverage,
} from "../src/lib/atlas.js";

function chart() {
  const c = Object.create(AtlasChart.prototype);
  Object.assign(c, {
    plot: { left: 0, right: 800, top: 0, bottom: 400 },
    low: 100,
    high: 200,
    priceView: null,
    view: { from: 0, to: 1000 },
    tool: "crosshair",
    follow: true,
    onHover() {},
    onView() {},
    canvas: {
      style: {},
      setPointerCapture() {},
      getBoundingClientRect() {
        return { left: 0, top: 0 };
      },
    },
    draw() {
      if (this.priceView) {
        this.low = this.priceView.low;
        this.high = this.priceView.high;
      }
    },
  });
  return c;
}
test("SMAs use interval closes, require warmup and restart after missing candles", () => {
  const bars = Array.from({ length: 300 }, (_, i) => ({
    t: i * 60000,
    T: (i + 1) * 60000 - 1,
    o: i + 1,
    h: i + 1,
    l: i + 1,
    c: i + 1,
  }));
  const sma200 = simpleMovingAverage(
    aggregateCandles(bars),
    200,
    1,
    300 * 60000,
  );
  assert.equal(sma200.length, 101);
  assert.equal(sma200[0].value, 100.5);
  assert.equal(sma200.at(-1).value, 200.5);
  const fiveMinute = aggregateCandles(bars, 5),
    sma9 = simpleMovingAverage(fiveMinute, 9, 5, 300 * 60000);
  assert.equal(sma9[0].value, 25);
  assert.equal(sma9[0].t, 40 * 60000);
  const gapped = aggregateCandles(bars.filter((b) => b.t !== 150 * 60000));
  assert.equal(simpleMovingAverage(gapped, 200, 1, 300 * 60000).length, 0);
  const incomplete = aggregateCandles(
    bars.filter((b) => b.t !== 140 * 60000),
    5,
  );
  assert.equal(
    simpleMovingAverage(incomplete, 9, 5, 300 * 60000).some(
      (p) => p.t >= 140 * 60000 && p.t < 185 * 60000,
    ),
    false,
  );
});
test("price zoom preserves cursor price and time range; axis drag changes only the price span", () => {
  const c = chart(),
    before = c.priceAt(100);
  c.zoomPrice(0.5, 100);
  assert.equal(c.high - c.low, 50);
  assert.equal(c.priceAt(100), before);
  assert.deepEqual(c.view, { from: 0, to: 1000 });
  c.down({ clientX: 850, clientY: 200, pointerId: 1 });
  c.move({ clientX: 850, clientY: 250 });
  assert.ok(c.high - c.low > 50);
  assert.deepEqual(c.view, { from: 0, to: 1000 });
  assert.equal(c.follow, true);
});
test("vertical chart pan preserves price span, shifts price and does not trigger inspection", () => {
  const c = chart();
  let inspected = false;
  c.onInspect = () => {
    inspected = true;
  };
  c.down({ clientX: 400, clientY: 200, pointerId: 1 });
  c.move({ clientX: 400, clientY: 240 });
  c.up({ clientX: 400, clientY: 240 });
  assert.equal(c.low, 110);
  assert.equal(c.high, 210);
  assert.deepEqual(c.view, { from: 0, to: 1000 });
  assert.equal(inspected, false);
  assert.equal(c.follow, false);
});

test("right-click leaves the view untouched and cannot start a chart drag or inspect", () => {
  const c = chart();
  let inspected = false;
  c.onInspect = () => {
    inspected = true;
  };
  c.down({ button: 2, clientX: 400, clientY: 200, pointerId: 1 });
  c.up({ button: 2, clientX: 400, clientY: 200 });
  assert.equal(inspected, false);
  assert.deepEqual(c.view, { from: 0, to: 1000 });
  assert.equal(c.priceView, null);
  assert.equal(c.drag, null);
});
