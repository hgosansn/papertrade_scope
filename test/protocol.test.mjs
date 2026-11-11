import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeLog,decodePosition,deriveProtocol,filterOverlays,notionalPass,TOPICS,WAD,headerFromLog} from '../public/protocol.js';
import {aggregateCandles} from '../public/atlas.js';
import {ProtocolCollector} from '../public/collector.js';
import {IMPLEMENTATION,IMPLEMENTATION_SHA256} from '../public/protocol.js';
const sample=JSON.parse(readFileSync(new URL('../public/sample-session.json',import.meta.url)));
const metadata=Object.fromEntries(Object.entries(sample.metadataResponses).map(([id,data])=>[id,decodePosition(data,id)]));
const derive=(logs=sample.raw.logs,headers=sample.headers,meta=metadata)=>deriveProtocol(logs,headers,meta);

test('settled positions leave no line: individual closes are X events and liquidations stay bubbles',()=>{
 const m=derive(),options={symbol:'BTC',minimum:0,from:0,to:sample.lastSeen,maxPositions:200,maxBubbles:200};
 const f=filterOverlays(m,options);
 assert.ok(f.positions.length>0&&f.closes.length>0&&f.bubbles.length>0);
 assert.ok(f.positions.every(p=>p.status==='open'));
 for(const p of m.positions.filter(p=>p.status!=='open'))assert.ok(!f.positions.some(v=>v.positionId===p.positionId));
 assert.ok(f.closes.every(e=>e.kind==='close'&&e.price!==null&&e.time!==null));
 assert.ok(f.bubbles.every(e=>e.kind==='liquidation'));
 assert.equal(f.closes.length,m.events.filter(e=>e.kind==='close'&&e.symbol==='BTC'&&e.metadataKnown).length);
 assert.equal(filterOverlays(m,{...options,showPositions:false}).closes.length,f.closes.length);
 assert.equal(filterOverlays(m,{...options,showCloses:false}).closes.length,0);
 assert.equal(filterOverlays(m,{...options,showClosed:true}).positions.length,f.positions.length);
});
test('real captured event families decode exact counts without counting close summaries as exits',()=>{
 const m=derive();assert.equal(m.errors.length,0);assert.equal(m.events.filter(e=>e.kind==='open').length,58);assert.equal(m.events.filter(e=>e.kind==='close').length,42);assert.equal(m.liquidations.length,24);assert.equal(m.events.length,124);assert.equal(m.missingTimes,0);
});
test('exact 100k notional cutoff includes equality and excludes one wei below and unknown',()=>{
 assert.equal(notionalPass(String(100000n*WAD),100000),true);assert.equal(notionalPass(String(100000n*WAD-1n),100000),false);assert.equal(notionalPass(null,0),false);assert.equal(notionalPass('100',NaN),false);
});
test('real open data matches the separately fetched live position getter',()=>{
 const evidence=JSON.parse(readFileSync(new URL('../evidence/chart-upgrade/getter-check.json',import.meta.url)));
 const row=decodePosition(evidence[1].response.result,'2203400'),open=derive().events.find(e=>e.kind==='open'&&e.positionId==='2203400');
 for(const key of ['owner','marketId','entryRaw','marginRaw','leverage','isLong','useDebt','notionalWad'])assert.equal(row[key],open[key]);assert.equal(row.activeAtRead,false);assert.equal(row.openedAt,open.time);
});
test('pre-session liquidation getter recovers known notional and side without fabricating an observed open',()=>{
 const m=derive(),pre=m.positions.find(p=>p.openObserved===false&&p.status==='liquidated');assert.ok(pre);assert.equal(pre.notionalWad,(BigInt(pre.marginRaw)*BigInt(pre.leverage)).toString());assert.ok(m.liquidations.find(l=>l.positionId===pre.positionId).metadataKnown);
 const unknown=derive(undefined,undefined,{}).liquidations.filter(e=>!e.metadataKnown);assert.ok(unknown.length>0);assert.equal(unknown[0].notionalWad,null);assert.equal(unknown[0].price,null);
});
test('caps, side, minimum, toggles and largest-first ordering consistently restrict overlays',()=>{
 const m=derive(),f=filterOverlays(m,{symbol:'BTC',minimum:100000,maxPositions:3,maxBubbles:2,from:sample.start-86400000,to:sample.lastSeen});assert.ok(f.positions.length<=3&&f.bubbles.length<=2);assert.ok(f.positions.every(p=>BigInt(p.notionalWad)>=100000n*WAD));
 for(let i=1;i<f.positions.length;i++)assert.ok(BigInt(f.positions[i-1].notionalWad)>=BigInt(f.positions[i].notionalWad));
 const longs=filterOverlays(m,{symbol:'BTC',side:'long',minimum:0,from:0,to:sample.lastSeen});assert.ok(longs.positions.every(p=>p.isLong));assert.ok(longs.bubbles.every(p=>p.isLong));
 const hidden=filterOverlays(m,{showPositions:false,showLiquidations:false});assert.equal(hidden.positions.length+hidden.bubbles.length,0);
});
test('canonical replay is duplicate-safe and orphaned liquidations disappear',()=>{
 const m=derive(),duplicated=derive([...sample.raw.logs,...sample.raw.logs]);assert.equal(m.events.length,duplicated.events.length);
 const target=m.liquidations[0];const changed=derive(sample.raw.logs.map(l=>l.transactionHash===target.transactionHash&&l.logIndex===target.logIndex?{...l,canonical:false}:l));assert.equal(changed.liquidations.length,m.liquidations.length-1);
});
test('wrong owner metadata cannot create a liquidation side or notional',()=>{
 const id=Object.keys(metadata)[0],bad={...metadata,[id]:{...metadata[id],owner:'0x'+'1'.repeat(40)}},m=derive(undefined,undefined,bad);assert.equal(m.liquidations.find(e=>e.positionId===id).metadataKnown,false);
});
test('missing block timestamps are unknown and never rendered at receipt time',()=>{
 const m=derive(undefined,{});assert.equal(m.missingTimes,m.events.length);assert.equal(filterOverlays(m,{minimum:0,from:0,to:sample.lastSeen}).bubbles.length,0);
});
test('malformed booleans and indexed layout do not silently produce overlays',()=>{
 const open=sample.raw.logs.find(l=>l.topics[0]===TOPICS.open),data=open.data.slice(0,66)+'2'.padStart(64,'0')+open.data.slice(130);
 assert.throws(()=>decodeLog({...open,data},sample.headers),/boolean/);assert.throws(()=>decodeLog({...open,topics:open.topics.slice(0,2)},sample.headers),/indexed/);
});
test('signed PnL words decode two-complement negatives',()=>{
 const close=sample.raw.logs.find(l=>l.topics[0]===TOPICS.close),negative='f'.repeat(64);const data=close.data.slice(0,66)+negative+close.data.slice(130);assert.equal(decodeLog({...close,data},sample.headers).rawPnl,'-1');
});
test('aggregated reference candles preserve extrema and leave missing intervals unfilled',()=>{
 const c=(t,o,h,l,v)=>({t,T:t+59999,s:'BTC',i:'1m',o,h,l,c:v,v:'1'});
 const rows=aggregateCandles([c(0,10,12,9,11),c(60000,11,14,10,13),c(600000,20,22,19,21)],5);
 assert.equal(rows.length,2);assert.equal(rows[0].o,10);assert.equal(rows[0].c,13);assert.equal(rows[0].h,14);assert.equal(rows[0].l,9);assert.equal(rows[0].observations,2);assert.equal(rows[1].t,600000);
});
test('provider log timestamps match all independently fetched sample block headers',()=>{
 for(const log of sample.raw.logs)assert.deepEqual(headerFromLog(log),sample.headers[log.blockHash]);
 assert.equal(headerFromLog({...sample.raw.logs[0],blockTimestamp:undefined}),null);
 assert.throws(()=>headerFromLog({...sample.raw.logs[0],blockTimestamp:'0x0'}),/timestamp/);
});
test('runtime approval requires matching implementation at both range boundaries and exact code bytes',async()=>{
  const code=readFileSync(new URL('../evidence/open-source-abi/papertrade-recomp-post-upgrade-runtime.hex',import.meta.url),'utf8').trim();
  const c=new ProtocolCollector(()=>({}),async()=>{},()=>{}),reads=[];
  c.request=async(_url,method,params)=>{reads.push({method,params});return method==='eth_getStorageAt'?'0x'+IMPLEMENTATION.slice(2).padStart(64,'0'):code;};
  const result=await c.identity({rangeFrom:'100',cursor:'200'});assert.equal(result.sha256,IMPLEMENTATION_SHA256);assert.equal(reads.filter(r=>r.method==='eth_getStorageAt').length,2);assert.equal(reads[0].params[2],'0x64');assert.equal(reads[1].params[2],'0xc8');
  const wrong=new ProtocolCollector(()=>({}),async()=>{},()=>{});wrong.request=async(_u,method)=>method==='eth_getStorageAt'?'0x'+IMPLEMENTATION.slice(2).padStart(64,'0'):'0x6000';await assert.rejects(wrong.identity({rangeFrom:'100',cursor:'200'}),/bytecode/);
});
test('a changed proxy implementation is rejected even after code was previously approved',async()=>{
 const c=new ProtocolCollector(()=>({}),async()=>{},()=>{});c.verifiedCode=true;c.request=async()=> '0x'+'1'.repeat(64);await assert.rejects(c.identity({rangeFrom:'100',cursor:'200'}),/implementation/);
});
