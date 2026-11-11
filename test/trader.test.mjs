import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pricePnl,traderSummary,layoutBadges,walletAddress} from '../public/trader.js';
import {deriveProtocol,decodePosition} from '../public/protocol.js';
test('gross price estimates respect direction, settlement and unknown inputs',()=>{
 const p={status:'open',entry:100,notionalWad:'100000000000000000000000',isLong:true};
 assert.ok(Math.abs(pricePnl(p,110)-10000)<1e-8);assert.ok(Math.abs(pricePnl({...p,isLong:false},110)+10000)<1e-8);
 assert.equal(pricePnl(p,null),null);assert.equal(pricePnl({...p,entry:0},100),null);assert.equal(pricePnl({...p,notionalWad:null},100),null);
 assert.ok(Math.abs(pricePnl({...p,status:'closed',exitEvent:{price:90}},200)+10000)<1e-8);
});
test('trader summary uses all observed sizes and markets, never duplicates close summaries',()=>{
 const sample=JSON.parse(readFileSync(new URL('../public/sample-session.json',import.meta.url)));
 const meta=Object.fromEntries(Object.entries(sample.metadataResponses).map(([id,data])=>[id,decodePosition(data,id)]));
 const model=deriveProtocol(sample.raw.logs,sample.headers,meta),owner=model.positions.find(p=>p.status!=='open').owner;
 const result=traderSummary(model,owner.toUpperCase().replace('0X','0x'));
 const all=model.positions.filter(p=>p.owner===owner);
 assert.equal(result.open.length+result.history.length,all.length);assert.equal(result.wins+result.losses+result.flat+result.unknown,result.history.length);
 assert.ok(result.history.length>0);assert.equal(new Set([...result.open,...result.history].map(p=>p.positionId)).size,all.length);
 assert.equal(traderSummary(model,'0x'+'f'.repeat(40)).open.length,0);assert.equal(walletAddress('bad'),null);
});
test('crowded labels do not merge positions, leave price anchors intact and stay within bounds',()=>{
 const plot={left:0,right:600,top:0,bottom:350},items=Array.from({length:20},(_,i)=>({y:i?340:0,item:{positionId:String(i)}}));
 const {labels,overflow}=layoutBadges(items,plot,230);assert.equal(labels.length,20);assert.equal(overflow,0);assert.equal(new Set(labels.map(l=>l.item.positionId)).size,20);
 for(const label of labels){assert.ok(label.top>=plot.top);assert.ok(label.top+label.height<=plot.bottom);assert.equal(label.y,label.item.positionId==='0'?0:340);}
 for(const a of labels)for(const b of labels)if(a!==b&&a.left===b.left)assert.ok(a.top+a.height<=b.top||b.top+b.height<=a.top);
 const small=layoutBadges(items,{left:0,right:200,top:0,bottom:100},180);assert.equal(small.labels.length+small.overflow,20);assert.ok(small.overflow>0);
});
