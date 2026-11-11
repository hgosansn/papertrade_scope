// Checked subset of the reconstructed Papertrade interface. See DECODER.md.
import { EXCHANGE, logKey } from './core.js';
export const IMPLEMENTATION = '0x0a44049dbbb6b4762a6ba37aa0f7548c0b4a3723';
export const IMPLEMENTATION_SHA256 = 'fc7374f3969381160732fe98c5e3145e00c3f167f168d61d65bb4972e9a6b268';
export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const WAD = 10n ** 18n;
export const MARKETS = { 0: { symbol: 'BTC', priceScale: 10 }, 1: { symbol: 'ETH', priceScale: 100 } };
export const TOPICS = {
  open: '0x88451ea1189f73b554f0bf39c09868560ed149b3d788fcc933ff66ba926827f3',
  close: '0x87902ed2451849f465fc4d36a01d7f5c67b53af12f63ee85d2814a2d582f89bf',
  liquidation: '0x0c859bc5db091ba3b9dc10c00f8dfc78b1f0b7e2566d107253ae67c069ae5de8',
  summary: '0xa32e4800a59f03b131f5fea90951bdf00d8d505ad98f48ece29d8620a0bf09b0'
};
export function unpack(data, count) {
  if (!new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(data)) throw new Error('Unexpected ABI payload length');
  return Array.from({ length: count }, (_, i) => BigInt('0x' + data.slice(2 + i * 64, 66 + i * 64)));
}
const uint = (n, bits) => { if (n < 0n || n >= 1n << BigInt(bits)) throw new Error(`Invalid uint${bits}`); return n; };
const bool = n => { if (n !== 0n && n !== 1n) throw new Error('Invalid ABI boolean'); return n === 1n; };
const addr = value => '0x' + uint(BigInt(value), 160).toString(16).padStart(40, '0');
const signed = n => n >= 1n << 255n ? n - (1n << 256n) : n;
export function headerFromLog(log){
  if(!/^0x[0-9a-f]+$/i.test(log.blockTimestamp||''))return null;
  const seconds=BigInt(log.blockTimestamp);
  if(seconds<=0n||seconds>BigInt(Number.MAX_SAFE_INTEGER)/1000n)throw new Error('Invalid block timestamp');
  return {hash:log.blockHash,number:log.blockNumber,time:Number(seconds)*1000};
}
export function decodeLog(log, headers = {}) {
  if (!log.canonical || log.removed || log.address?.toLowerCase() !== EXCHANGE.toLowerCase()) return null;
  const kind = Object.keys(TOPICS).find(k => TOPICS[k] === log.topics?.[0]);
  if (!kind || kind === 'summary') return null; // Summary is never a second position exit.
  if (log.topics.length !== 3) throw new Error('Unexpected indexed event layout');
  const event = { id: logKey(log), kind, positionId: BigInt(log.topics[1]).toString(), owner: addr(log.topics[2]), blockHash: log.blockHash, blockNumber: log.blockNumber, transactionHash: log.transactionHash, logIndex: log.logIndex, time: headers[log.blockHash]?.time ?? null };
  const w = unpack(log.data, kind === 'open' ? 6 : 5);
  if (kind === 'open') {
    const marketId = Number(uint(w[0], 32)), market = MARKETS[marketId];
    return { ...event, marketId, symbol: market?.symbol ?? null, isLong: bool(w[1]), useDebt: bool(w[2]), entryRaw: uint(w[3], 64).toString(), entry: market ? Number(w[3]) / market.priceScale : null, marginRaw: uint(w[4], 128).toString(), leverage: Number(uint(w[5], 32)), notionalWad: (w[4] * w[5]).toString() };
  }
  if (kind === 'close') return { ...event, priceRaw: uint(w[0], 64).toString(), rawPnl: signed(w[1]).toString(), adjustedPnl: signed(w[2]).toString(), unverifiedFlag: bool(w[3]), feeRaw: w[4].toString() };
  return { ...event, priceRaw: uint(w[0], 64).toString(), bustPriceRaw: uint(w[1], 64).toString(), unverifiedFlag: bool(w[2]), feeARaw: w[3].toString(), feeBRaw: w[4].toString() };
}
export function decodePosition(data, id) {
  const w = unpack(data, 9), marketId = Number(uint(w[1], 32)), market = MARKETS[marketId];
  const owner = addr(w[0]);
  if (w[0] === 0n) throw new Error('Unknown position ID');
  return { positionId: String(id), owner, marketId, symbol: market?.symbol ?? null, entryRaw: uint(w[2], 64).toString(), entry: market ? Number(w[2]) / market.priceScale : null, marginRaw: uint(w[3], 128).toString(), leverage: Number(uint(w[4], 32)), notionalWad: (w[3] * w[4]).toString(), openedAt: Number(uint(w[5], 64)) * 1000, isLong: bool(w[6]), useDebt: bool(w[7]), activeAtRead: bool(w[8]) };
}
export function deriveProtocol(rawLogs, headers = {}, metadata = {}, unavailableRanges = []) {
  const events = [], errors = [], unknown = new Set();
  const ordered = [...new Map(rawLogs.filter(l => l.canonical && !l.removed).map(l=>[logKey(l),l])).values()].sort((a,b) => Number(BigInt(a.blockNumber)-BigInt(b.blockNumber)) || Number(BigInt(a.transactionIndex)-BigInt(b.transactionIndex)) || Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
  for (const log of ordered) {
    if (unavailableRanges.some(([a,b]) => BigInt(log.blockNumber) >= BigInt(a) && BigInt(log.blockNumber) <= BigInt(b))) continue;
    try { const event=decodeLog(log,headers); if(event)events.push(event);else if(log.topics?.[0]!==TOPICS.summary)unknown.add(log.topics?.[0]); }
    catch(e){errors.push({id:logKey(log),message:e.message});}
  }
  const positions = new Map();
  for (const event of events) {
    if (event.kind === 'open') positions.set(event.positionId, { ...event, openedAt: event.time, openObserved: true, status: 'open', endTime: null });
    else {
      let position = positions.get(event.positionId);
      const meta = metadata[event.positionId];
      if (!position && meta && meta.owner === event.owner) { position={ ...meta, id: `position:${event.positionId}`, openObserved:false, status:'unknown', endTime:null };positions.set(event.positionId,position); }
      if (position && position.owner !== event.owner) { errors.push({id:event.id,message:'Owner mismatch'});continue; }
      const market = position ? MARKETS[position.marketId] : null;
      Object.assign(event, { symbol: position?.symbol ?? null, marketId: position?.marketId ?? null, isLong: position?.isLong ?? null, notionalWad: position?.notionalWad ?? null, entry: position?.entry ?? null, price: market ? Number(event.priceRaw)/market.priceScale : null, metadataKnown:!!position });
      if(position){position.status=event.kind==='liquidation'?'liquidated':'closed';position.endTime=event.time;position.exitEvent=event;}
    }
  }
  return { events, positions:[...positions.values()], liquidations:events.filter(e=>e.kind==='liquidation'), unknownTopics:[...unknown], errors, missingTimes:events.filter(e=>e.time===null).length, unresolvedExits:events.filter(e=>e.kind!=='open'&&!e.metadataKnown).length };
}
export function notionalPass(raw, minimumDollars) {
  if(raw===null||raw===undefined)return false;
  const value=Number(minimumDollars);
  if(!Number.isFinite(value)||value<0)return false;
  // The control uses whole USD; compare exact raw notional, inclusive of threshold.
  return BigInt(raw)>=BigInt(Math.ceil(value))*WAD;
}
export function filterOverlays(model, {symbol='BTC', minimum=100000, side='both', maxPositions=50, maxBubbles=75, from=0, to=Date.now(), showClosed=true, showPositions=true, showLiquidations=true}={}) {
  const match=p=>p.symbol===symbol&&notionalPass(p.notionalWad,minimum)&&(side==='both'||(p.isLong?'long':'short')===side);
  const eligiblePositions=model.positions.filter(p=>match(p)&&p.entry!==null&&p.openedAt!==null&&p.openedAt<=to&&(p.status==='open'||p.endTime!==null)&&(p.endTime===null||p.endTime>=from)&&(showClosed||p.status==='open')).sort((a,b)=>Number(BigInt(b.notionalWad)-BigInt(a.notionalWad))||b.openedAt-a.openedAt);
  const eligibleBubbles=model.liquidations.filter(e=>match(e)&&e.time!==null&&e.time>=from&&e.time<=to&&e.price!==null).sort((a,b)=>Number(BigInt(b.notionalWad)-BigInt(a.notionalWad))||b.time-a.time);
  return { positions:showPositions?eligiblePositions.slice(0,maxPositions):[], bubbles:showLiquidations?eligibleBubbles.slice(0,maxBubbles):[], eligiblePositions:eligiblePositions.length,eligibleBubbles:eligibleBubbles.length };
}
