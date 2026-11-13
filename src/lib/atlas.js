import { PRICE_HISTORY_MS } from "./price-history.js";
import { readChartTheme } from "./chart-theme.js";

// Marker footprint scales with entry notional; radius grows as sqrt(value), with readability floors and hard caps.
const markerRadius = (raw, base, cap) =>
  Math.max(base, Math.min(cap, base * Math.sqrt(Number(raw) / 1e18 / 100000)));
export const shortMoney = (n) =>
  n >= 1e6
    ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "m"
    : n >= 1000
      ? "$" + (n / 1000).toFixed(0) + "k"
      : "$" + n.toFixed(0);
export const priceText = (n) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const timeText = (t) =>
  new Date(t).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export function aggregateCandles(candles, minutes = 1) {
  const groups = new Map(),
    duration = minutes * 60000;
  const native = candles.filter((c) => c.i === `${minutes}m`);
  const source = native.length
    ? native
    : candles.filter((c) => !c.i || c.i === "1m");
  for (const c of [...source].sort((a, b) => a.t - b.t)) {
    const t = Math.floor(c.t / duration) * duration,
      old = groups.get(t);
    if (!old)
      groups.set(t, {
        ...c,
        t,
        T: t + duration - 1,
        o: Number(c.o),
        h: Number(c.h),
        l: Number(c.l),
        c: Number(c.c),
        v: Number(c.v) || 0,
        observations: native.length ? minutes : 1,
      });
    else {
      old.h = Math.max(old.h, Number(c.h));
      old.l = Math.min(old.l, Number(c.l));
      old.c = Number(c.c);
      old.v += Number(c.v) || 0;
      old.observations++;
    }
  }
  return [...groups.values()];
}
export const SMA_PERIODS = [9, 21, 50, 200];
export function simpleMovingAverage(
  rows,
  period,
  minutes = 1,
  now = Date.now(),
) {
  const points = [],
    window = [],
    duration = minutes * 60000;
  let sum = 0,
    previous = null;
  for (const bar of rows) {
    const close = Number(bar.c),
      complete =
        bar.observations == null || bar.observations >= minutes || bar.T >= now;
    if (previous !== null && bar.t - previous !== duration) {
      window.length = 0;
      sum = 0;
    }
    previous = bar.t;
    if (!Number.isFinite(close) || !complete) {
      window.length = 0;
      sum = 0;
      continue;
    }
    window.push(close);
    sum += close;
    if (window.length > period) sum -= window.shift();
    if (window.length === period)
      points.push({ t: bar.t, T: bar.T, value: sum / period });
  }
  return points;
}
export class AtlasChart {
  constructor(canvas, { onHover, onInspect, onView = undefined, onStats }) {
    Object.assign(this, {
      canvas,
      onHover,
      onInspect,
      onView,
      onStats,
      data: null,
      interval: 1,
      view: null,
      priceView: null,
      follow: true,
      mouse: null,
      drag: null,
      includeOverlays: false,
    });
    this.events = new AbortController();
    this.theme = readChartTheme(canvas);
    this.themeObserver = new MutationObserver(() => {
      this.theme = readChartTheme(canvas);
      this.draw();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    this.ctx = canvas.getContext("2d");
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.down(e), {
      signal: this.events.signal,
    });
    canvas.addEventListener("pointermove", (e) => this.move(e), {
      signal: this.events.signal,
    });
    canvas.addEventListener("pointerup", (e) => this.up(e), {
      signal: this.events.signal,
    });
    canvas.addEventListener(
      "pointercancel",
      () => {
        this.drag = null;
      },
      { signal: this.events.signal },
    );
    canvas.addEventListener(
      "pointerleave",
      () => {
        if (!this.drag) {
          this.mouse = null;
          this.onHover(null);
          this.draw();
        }
      },
      { signal: this.events.signal },
    );
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const point = this.coords(e),
          factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
        if (this.onPriceAxis(point)) this.zoomPrice(factor, point.y);
        else this.zoom(factor, point.x);
      },
      { passive: false, signal: this.events.signal },
    );
    canvas.addEventListener(
      "dblclick",
      (e) => {
        if (this.onPriceAxis(this.coords(e))) {
          this.priceView = null;
          this.draw();
        } else this.fit();
      },
      { signal: this.events.signal },
    );
  }
  destroy() {
    this.events.abort();
    this.themeObserver.disconnect();
    this.resizeObserver.disconnect();
  }
  setData(data) {
    this.data = data;
    if (!this.view) this.fit(false);
    else if (this.follow) {
      const span = this.view.to - this.view.from;
      this.view = { from: data.now - span * 0.93, to: data.now + span * 0.07 };
    }
    this.draw();
  }
  setInterval(minutes) {
    this.interval = minutes;
    this.draw();
  }
  fit(includeOverlays = true) {
    if (!this.data) return;
    this.priceView = null;
    this.includeOverlays = includeOverlays;
    const span = this.data.priceHistory ?? PRICE_HISTORY_MS;
    this.view = { from: this.data.now - span, to: this.data.now + span * 0.04 };
    this.follow = false;
    this.onView?.();
    this.draw();
  }
  live() {
    if (!this.data) return;
    this.priceView = null;
    const span = Math.min(
      this.data.priceHistory ?? PRICE_HISTORY_MS,
      Math.max(900000, this.view ? this.view.to - this.view.from : 900000),
    );
    this.view = {
      from: this.data.now - span * 0.93,
      to: this.data.now + span * 0.07,
    };
    this.follow = true;
    this.includeOverlays = false;
    this.onView?.();
    this.draw();
  }
  zoom(factor, anchor) {
    if (!this.view || !this.plot) return;
    const p = this.plot,
      ratio = Math.max(
        0,
        Math.min(
          1,
          ((anchor ?? (p.left + p.right) / 2) - p.left) / (p.right - p.left),
        ),
      ),
      span = this.view.to - this.view.from,
      next = Math.max(180000, Math.min(86400000, span * factor)),
      t = this.view.from + span * ratio;
    this.view = { from: t - next * ratio, to: t + next * (1 - ratio) };
    this.follow = false;
    this.onView?.();
    this.draw();
  }
  resetPriceScale() {
    this.priceView = null;
    this.draw();
  }
  onPriceAxis(point) {
    return (
      this.plot &&
      point.x >= this.plot.right &&
      point.y >= this.plot.top &&
      point.y <= this.plot.bottom
    );
  }
  zoomPrice(factor, anchor) {
    if (!this.plot || !Number.isFinite(this.low) || !Number.isFinite(this.high))
      return;
    const range = this.priceView || { low: this.low, high: this.high },
      span = range.high - range.low,
      ratio = Math.max(
        0,
        Math.min(
          1,
          (this.plot.bottom -
            (anchor ?? (this.plot.top + this.plot.bottom) / 2)) /
            (this.plot.bottom - this.plot.top),
        ),
      ),
      price = range.low + span * ratio,
      next = Math.max(
        Math.max(Math.abs(price), 1) * 1e-9,
        Math.min(Math.max(Math.abs(price), 1) * 1e6, span * factor),
      );
    this.priceView = {
      low: price - next * ratio,
      high: price + next * (1 - ratio),
    };
    this.draw();
  }
  coords(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (
      !this.plot ||
      !this.view ||
      !Number.isFinite(this.low) ||
      !Number.isFinite(this.high)
    )
      return;
    const point = this.coords(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (this.onPriceAxis(point)) {
      this.drag = {
        ...point,
        axis: true,
        range: { low: this.low, high: this.high },
        moved: false,
      };
      this.mouse = null;
      this.onHover(null);
      this.canvas.style.cursor = "ns-resize";
      return;
    }
    if (
      point.x < this.plot.left ||
      point.x > this.plot.right ||
      point.y < this.plot.top ||
      point.y > this.plot.bottom
    )
      return;
    this.drag = {
      ...point,
      view: { ...this.view },
      range: { low: this.low, high: this.high },
      moved: false,
    };
    this.canvas.style.cursor = "grabbing";
  }
  move(e) {
    if (!this.plot) return;
    const point = this.coords(e);
    this.mouse = point;
    this.canvas.style.cursor = this.onPriceAxis(point)
      ? "ns-resize"
      : this.drag
        ? "grabbing"
        : "crosshair";
    if (this.drag?.axis) {
      const dy = point.y - this.drag.y;
      if (Math.abs(dy) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        const { low, high } = this.drag.range,
          center = (low + high) / 2,
          span =
            (high - low) * Math.exp(Math.max(-12, Math.min(12, dy * 0.008)));
        this.priceView = { low: center - span / 2, high: center + span / 2 };
        this.draw();
      }
      this.canvas.style.cursor = "ns-resize";
      return;
    }
    if (this.drag) {
      const dx = point.x - this.drag.x,
        dy = point.y - this.drag.y;
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        const shift =
          (-dx / (this.plot.right - this.plot.left)) *
          (this.drag.view.to - this.drag.view.from);
        this.view = {
          from: this.drag.view.from + shift,
          to: this.drag.view.to + shift,
        };
        if (Math.abs(dy) > 4 || this.drag.vertical) {
          this.drag.vertical = true;
          const priceShift =
            (dy / (this.plot.bottom - this.plot.top)) *
            (this.drag.range.high - this.drag.range.low);
          this.priceView = {
            low: this.drag.range.low + priceShift,
            high: this.drag.range.high + priceShift,
          };
        }
        this.follow = false;
        this.onView?.();
      }
    }
    const hit = this.hit(point);
    this.onHover(hit ? { item: hit.item, x: point.x, y: point.y } : null);
    this.draw();
  }
  up(e) {
    if (this.drag && !this.drag.axis && !this.drag.moved) {
      const hit = this.hit(this.coords(e));
      if (hit)
        this.onInspect(
          hit.item,
          this.hitAll(this.coords(e)).map((h) => h.item),
        );
    }
    this.drag = null;
    this.canvas.style.cursor = this.onPriceAxis(this.coords(e))
      ? "ns-resize"
      : "crosshair";
  }
  timeAt(x) {
    return (
      this.view.from +
      ((x - this.plot.left) / (this.plot.right - this.plot.left)) *
        (this.view.to - this.view.from)
    );
  }
  priceAt(y) {
    return (
      this.high -
      ((y - this.plot.top) / (this.plot.bottom - this.plot.top)) *
        (this.high - this.low)
    );
  }
  hitAll(p) {
    return [...(this.hits || [])]
      .reverse()
      .filter((hit) =>
        hit.type !== "line"
          ? Math.hypot(p.x - hit.x, p.y - hit.y) <= hit.r + 4
          : p.x >= hit.x1 - 4 && p.x <= hit.x2 + 4 && Math.abs(p.y - hit.y) < 6,
      );
  }
  hit(p) {
    return this.hitAll(p)[0] ?? null;
  }
  draw() {
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const dpr = window.devicePixelRatio || 1,
      w = box.width,
      h = box.height;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const c = this.ctx,
      theme = this.theme;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.font = "11px Consolas, monospace";
    const p = (this.plot = {
      left: w < 720 ? 8 : 12,
      right: w - (w < 720 ? 76 : 94),
      top: 12,
      bottom: h - 28,
    });
    if (p.bottom <= p.top) return;
    if (!this.data || !this.view) {
      this.onHover(null);
      return;
    }
    this.canvas.dataset.viewFrom = String(Math.round(this.view.from));
    this.canvas.dataset.viewTo = String(Math.round(this.view.to));
    const allRows = aggregateCandles(this.data.candles, this.interval),
      rows = allRows.filter(
        (r) => r.T >= this.view.from && r.t <= this.view.to,
      ),
      overlays = this.data.overlays;
    const averages = SMA_PERIODS.filter(
      (period) => this.data.movingAverages?.[period],
    ).map((period) => ({
      period,
      points: simpleMovingAverage(
        allRows,
        period,
        this.interval,
        this.data.now,
      ).filter(
        (point) =>
          point.T >= this.view.from - this.interval * 60000 &&
          point.t <= this.view.to,
      ),
    }));
    const values = rows.flatMap((r) => [Number(r.h), Number(r.l)]);
    for (const average of averages)
      values.push(...average.points.map((point) => point.value));
    if (this.includeOverlays) {
      values.push(
        ...overlays.positions
          .filter(
            (v) =>
              v.openedAt <= this.view.to &&
              (v.endTime ?? this.data.now) >= this.view.from,
          )
          .map((v) => v.entry),
      );
      values.push(
        ...(overlays.closes || [])
          .filter((v) => v.time >= this.view.from && v.time <= this.view.to)
          .map((v) => v.price),
      );
      values.push(
        ...overlays.bubbles
          .filter((v) => v.time >= this.view.from && v.time <= this.view.to)
          .map((v) => v.price),
      );
    }
    if (!values.length && this.data.reference) values.push(this.data.reference);
    if (!values.length) {
      this.onHover(null);
      this.onStats?.({ lines: 0, bubbles: 0 });
      return;
    }
    let low = Math.min(...values),
      high = Math.max(...values),
      pad = Math.max((high - low) * 0.25, high * 0.0007);
    this.low = this.priceView?.low ?? low - pad;
    this.high = this.priceView?.high ?? high + pad;
    this.canvas.dataset.priceLow = String(this.low);
    this.canvas.dataset.priceHigh = String(this.high);
    this.canvas.dataset.priceScale = this.priceView ? "manual" : "auto";
    const x = (t) =>
        p.left +
        ((t - this.view.from) / (this.view.to - this.view.from)) *
          (p.right - p.left),
      y = (n) =>
        p.bottom -
        ((Number(n) - this.low) / (this.high - this.low)) * (p.bottom - p.top);
    this.hits = [];
    // Sparse exchange data stays sparse: no interpolated/fabricated candles.
    c.lineWidth = 0.6;
    for (let i = 0; i <= 7; i++) {
      const yy = p.top + ((p.bottom - p.top) * i) / 7;
      c.strokeStyle = theme.grid;
      c.beginPath();
      c.moveTo(p.left, yy);
      c.lineTo(p.right, yy);
      c.stroke();
      c.fillStyle = theme.axisText;
      c.fillText(
        priceText(this.high - ((this.high - this.low) * i) / 7),
        p.right + 13,
        yy + 3,
      );
    }
    const showDate = this.view.to - this.view.from >= 24 * 3600000;
    const ticks = Math.max(
      2,
      Math.floor((p.right - p.left) / (showDate ? 125 : 75)),
    );
    for (let i = 0; i <= ticks; i++) {
      const xx = p.left + ((p.right - p.left) * i) / ticks;
      c.strokeStyle = theme.gridVertical;
      c.beginPath();
      c.moveTo(xx, p.top);
      c.lineTo(xx, p.bottom);
      c.stroke();
      c.fillStyle = theme.axisText;
      const timestamp =
        this.view.from + ((this.view.to - this.view.from) * i) / ticks;
      const label = showDate
        ? new Date(timestamp)
            .toLocaleString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
            .replace(",", "")
        : timeText(timestamp);
      c.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
      c.fillText(label, xx, p.bottom + 25);
      c.textAlign = "left";
    }
    c.save();
    c.beginPath();
    c.rect(p.left, p.top, p.right - p.left, p.bottom - p.top);
    c.clip();
    for (const average of averages) {
      c.strokeStyle = theme[`sma${average.period}`];
      c.lineWidth = 1;
      c.globalAlpha = 0.8;
      c.setLineDash([]);
      c.beginPath();
      let last = null;
      for (const point of average.points) {
        const xx = x(point.t + this.interval * 30000),
          yy = y(point.value);
        if (last === null || point.t - last !== this.interval * 60000)
          c.moveTo(xx, yy);
        else c.lineTo(xx, yy);
        last = point.t;
      }
      c.stroke();
    }
    c.globalAlpha = 1;
    let lines = 0,
      bubbles = 0,
      closes = 0;
    for (const position of overlays.positions) {
      if (
        position.status !== "open" ||
        position.entry === null ||
        position.openedAt === null
      )
        continue;
      const yy = y(position.entry),
        begin = Math.max(position.openedAt, this.data.start),
        x1 = Math.max(p.left, x(begin)),
        x2 = p.right;
      if (yy < p.top || yy > p.bottom || x2 < x1) continue;
      const color = position.isLong ? theme.long : theme.short,
        notional = Number(position.notionalWad) / 1e18;
      c.globalAlpha = 0.95;
      c.strokeStyle = color;
      c.lineWidth = Math.min(
        2.6,
        1 + Math.log10(Math.max(1, notional / 100000)) * 0.6,
      );
      c.setLineDash(position.openObserved ? [] : [4, 5]);
      c.beginPath();
      c.moveTo(x1, yy);
      c.lineTo(x2, yy);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = color;
      c.beginPath();
      c.arc(x1, yy, 2.8, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      this.hits.push({ type: "line", item: position, x1, x2, y: yy });
      lines++;
    }
    const barWidth = Math.min(
      13,
      ((p.right - p.left) / (this.view.to - this.view.from)) *
        (this.interval * 60000) *
        0.62,
    );
    for (const bar of rows) {
      const xx = x(bar.t + this.interval * 30000),
        color = bar.c >= bar.o ? theme.candleUp : theme.candleDown;
      c.globalAlpha = bar.observations < this.interval ? 0.55 : 0.92;
      c.strokeStyle = c.fillStyle = color;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(xx, y(bar.h));
      c.lineTo(xx, y(bar.l));
      c.stroke();
      c.fillRect(
        xx - Math.max(2, barWidth) / 2,
        Math.min(y(bar.o), y(bar.c)),
        Math.max(2, barWidth),
        Math.max(1, Math.abs(y(bar.o) - y(bar.c))),
      );
    }
    c.globalAlpha = 1;
    for (const event of overlays.closes || []) {
      const xx = x(event.time),
        yy = y(event.price);
      if (xx < p.left || xx > p.right || yy < p.top || yy > p.bottom) continue;
      const r = markerRadius(event.notionalWad, 3.5, 14);
      c.strokeStyle = event.isLong ? theme.long : theme.short;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(xx - r, yy - r);
      c.lineTo(xx + r, yy + r);
      c.moveTo(xx - r, yy + r);
      c.lineTo(xx + r, yy - r);
      c.stroke();
      this.hits.push({
        type: "close",
        item: event,
        x: xx,
        y: yy,
        r: Math.SQRT2 * r,
      });
      closes++;
    }
    for (const event of overlays.bubbles) {
      const xx = x(event.time),
        yy = y(event.price);
      if (xx < p.left || xx > p.right || yy < p.top || yy > p.bottom) continue;
      const r = markerRadius(event.notionalWad, 5, 30),
        color = event.isLong ? theme.short : theme.long;
      const glowRadius = Math.min(30, r * 1.9),
        glow = c.createRadialGradient(xx, yy, 0, xx, yy, glowRadius);
      glow.addColorStop(0, color);
      glow.addColorStop(0.55, color);
      glow.addColorStop(1, theme.transparent);
      c.globalAlpha = 0.13;
      c.fillStyle = glow;
      c.beginPath();
      c.arc(xx, yy, glowRadius, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.12;
      c.fillStyle = color;
      c.strokeStyle = color;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(xx, yy, r, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.9;
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = color;
      c.beginPath();
      c.arc(xx, yy, 2, 0, Math.PI * 2);
      c.fill();
      this.hits.push({ type: "bubble", item: event, x: xx, y: yy, r });
      bubbles++;
    }
    c.restore();
    const last = rows.at(-1);
    if (last) {
      const yy = y(last.c);
      if (yy > p.top && yy < p.bottom) {
        c.strokeStyle = theme.priceLine;
        c.lineWidth = 0.7;
        c.setLineDash([3, 5]);
        c.beginPath();
        c.moveTo(p.left, yy);
        c.lineTo(p.right, yy);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = theme.priceLabel;
        c.fillRect(p.right, yy - 10, w - p.right - 3, 21);
        c.fillStyle = theme.priceLabelText;
        c.font = "11px Consolas, monospace";
        c.fillText(priceText(last.c), p.right + 9, yy + 4);
      }
    }
    if (
      this.mouse &&
      this.mouse.x >= p.left &&
      this.mouse.x <= p.right &&
      this.mouse.y >= p.top &&
      this.mouse.y <= p.bottom
    ) {
      const m = this.mouse;
      c.strokeStyle = theme.crosshair;
      c.lineWidth = 0.8;
      c.setLineDash([3, 5]);
      c.beginPath();
      c.moveTo(m.x, p.top);
      c.lineTo(m.x, p.bottom);
      c.moveTo(p.left, m.y);
      c.lineTo(p.right, m.y);
      c.stroke();
      c.setLineDash([]);
      const bar = rows.reduce(
        (a, b) =>
          Math.abs(b.t - this.timeAt(m.x)) <
          Math.abs((a?.t ?? Infinity) - this.timeAt(m.x))
            ? b
            : a,
        null,
      );
      this.onHover?.({
        item: this.hit(m)?.item ?? null,
        x: m.x,
        y: m.y,
        crosshair: { time: this.timeAt(m.x), price: this.priceAt(m.y), bar },
      });
    }
    this.canvas.dataset.lines = String(lines);
    this.canvas.dataset.bubbles = String(bubbles);
    this.canvas.dataset.closes = String(closes);
    this.onStats?.({ lines, bubbles, closes });
  }
}
