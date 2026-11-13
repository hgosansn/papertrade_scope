export const PRICE_HISTORY_MS = 2 * 24 * 60 * 60000;
export const PRICE_INTERVALS = [1, 5, 15];

// Native intervals keep 48h plus SMA-200 warmup below the 5,000-bar API limit.
export function candleRequest(coin, minutes, now, candles = []) {
  const duration = minutes * 60000;
  const earliest =
    Math.floor((now - PRICE_HISTORY_MS) / duration) * duration - 200 * duration;
  const rows = candles.filter(
    (c) => c.s === coin && c.i === `${minutes}m` && c.t >= earliest,
  );
  const complete =
    rows.length &&
    rows[0].t === earliest &&
    rows.every((c, i) => !i || c.t - rows[i - 1].t === duration);
  const startTime = complete
    ? Math.max(earliest, rows.at(-1).t - duration)
    : earliest;
  return {
    type: "candleSnapshot",
    req: { coin, interval: `${minutes}m`, startTime, endTime: now },
  };
}

export function historyComplete(candles, coin, minutes, now) {
  const duration = minutes * 60000;
  const first =
    Math.floor((now - PRICE_HISTORY_MS) / duration) * duration - 199 * duration;
  const last = Math.floor(now / duration) * duration - duration;
  const times = new Set(
    candles
      .filter((c) => c.s === coin && c.i === `${minutes}m`)
      .map((c) => c.t),
  );
  for (let t = first; t <= last; t += duration) if (!times.has(t)) return false;
  return true;
}
