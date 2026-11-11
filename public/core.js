export const COINS = ['BTC', 'ETH', 'SOL'];
export const EXCHANGE = '0x6cd5661646289FB6E65EA5C032310fDEd797D0a2';
export const tradeKey = t => `${t.time}:${t.coin}:${t.tid}`;
export const logKey = l => `999:${l.blockHash}:${l.transactionHash}:${l.logIndex}`;
export const hex = n => '0x' + BigInt(n).toString(16);
export function validTrade(t) {
  return COINS.includes(t?.coin) && Number.isSafeInteger(t.time) && Number.isSafeInteger(t.tid) && ['B', 'A'].includes(t.side) && Number.isFinite(Number(t.px)) && Number(t.px) > 0 && Number.isFinite(Number(t.sz)) && Number(t.sz) > 0;
}
export function mergeTrades(previous, incoming, start, now, retention = 86400000, cap = 40000) {
  const map = new Map(previous.filter(t => t.time >= now - retention).map(t => [tradeKey(t), t]));
  for (const t of incoming) if (validTrade(t) && t.time >= start && t.time <= now + 5000 && t.time >= now - retention) map.set(tradeKey(t), { ...t, id: tradeKey(t) });
  return [...map.values()].sort((a,b) => a.time - b.time || a.tid - b.tid).slice(-cap);
}
export function summarize(trades, coin, now, windowMs, minNotional = 0, side = '') {
  const rows = trades.filter(t => t.coin === coin && t.time > now - windowMs && t.time <= now && Number(t.px) * Number(t.sz) >= minNotional && (!side || side === t.side));
  let buy = 0, sell = 0;
  for (const t of rows) { const n = Number(t.px) * Number(t.sz); if(t.side === 'B') buy += n; else sell += n; }
  return { rows, buy, sell, total: buy + sell, bias: buy + sell > 0 ? (buy - sell) / (buy + sell) : null };
}
export function reconcileLogs(previous, incoming, from, to) {
  // An authoritative successful range replaces canonical membership in that range.
  // Preserve replaced logs as evidence; no decoding or assumed event meaning.
  const map = new Map(previous.map(l => [logKey(l), { ...l }]));
  for (const l of map.values()) if (BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to) l.canonical = false;
  for (const l of incoming) {
    if (l.address?.toLowerCase() !== EXCHANGE.toLowerCase() || BigInt(l.blockNumber) < from || BigInt(l.blockNumber) > to || !l.blockHash || !l.transactionHash || !Array.isArray(l.topics)) throw new Error('Invalid Exchange log');
    map.set(logKey(l), { ...l, id: logKey(l), canonical: !l.removed });
  }
  return [...map.values()].sort((a,b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.transactionIndex) - BigInt(b.transactionIndex)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
}
export function windowCoverage(start, now, ms, gaps, retainedFrom = start) {
  const from = now - ms;
  if (gaps.some(g => g.from < now && (g.to ?? now) > from)) return 'Gap / incomplete';
  if (Math.max(start, retainedFrom) > from) return 'Warming up';
  return 'Observed window';
}
export function mergeCandles(previous, incoming, start) {
  const map = new Map(previous.map(c => [`${c.s}:${c.i}:${c.t}`, c]));
  for (const c of incoming) if (COINS.includes(c?.s) && c.i === '1m' && Number.isFinite(c.t) && c.T >= start && ['o','h','l','c'].every(k => Number.isFinite(Number(c[k])))) map.set(`${c.s}:${c.i}:${c.t}`, { ...c, id: `${c.s}:${c.i}:${c.t}` });
  return [...map.values()].sort((a,b) => a.t - b.t).slice(-4500);
}
