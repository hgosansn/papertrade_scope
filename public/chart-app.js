import { mergeCandles } from './core.js';
import { openStore,readStore,saveStore } from './store.js';
import { HyperliquidFeed } from './feed.js';
import { ProtocolCollector } from './collector.js';
import { deriveProtocol,decodePosition,filterOverlays,notionalPass,IMPLEMENTATION,IMPLEMENTATION_SHA256 } from './protocol.js?v=0.3.2';
import { AtlasChart,shortMoney,priceText,aggregateCandles } from './atlas.js?v=0.3.2';
import {pricePnl,signedMoney,traderSummary,walletAddress} from './trader.js';
const $=id=>document.getElementById(id);
const defaults={minimum:100000,side:'both',maxPositions:50,maxBubbles:75,lookback:3600000,showPositions:true,showCloses:true,showLiquidations:true};
let settings={...defaults};
try{const saved=JSON.parse(localStorage.getItem('papertrade-atlas-prefs-v2')||'null');if(saved)settings={...settings,...saved};}catch{}
let db,state,liveState,leader=false,readOnly=false,mode='live',referenceStatus='Connecting',protocolStatus='Starting',collector,feed,saveQueue=Promise.resolve(),saveVersion=0,modelCache=null,modelKey='',selected='BTC',replayNow=0,releaseLock,paused=false;
let inspectedItem=null,traderOwner=null,traderSignature='';
let watched=[];try{watched=JSON.parse(localStorage.getItem('papertrade-watched-wallets')||'[]').filter(a=>typeof a==='string'&&walletAddress(a)).map(a=>a.toLowerCase());}catch{}
let hoverTimer,hoverItem=null;
const chart=new AtlasChart($('atlas'),{onHover:showHover,onInspect:inspect,onView:()=>render(),onStats:stats=>{$('lines-shown').textContent=stats.lines;$('bubbles-shown').textContent=stats.bubbles;$('closes-shown').textContent=stats.closes||0;$('overlay-count').textContent=stats.lines+(stats.closes||0)+stats.bubbles;}});
const fresh=()=>({schema:2,start:Date.now(),lastSeen:Date.now(),candles:[],trades:[],gaps:[],raw:{logs:[]},headers:{},positionMetadata:{},contexts:{},bbos:{}});
function normalize(s){return {...fresh(),...s,headers:s.headers||{},positionMetadata:s.positionMetadata||{},contexts:s.contexts||{},bbos:s.bbos||{}};}
function gap(from,to){if(!state||mode!=='live'||to<=from)return;state.gaps??=[];const last=state.gaps.at(-1);if(last&&from<=last.to)last.to=Math.max(last.to,to);else state.gaps.push({from,to,reason:'Reference feed continuity unverified'});}
async function commit(){
  if(!leader||mode!=='live')return;
  const target=state,version=++saveVersion;
  saveQueue=saveQueue.catch(()=>{}).then(()=>saveStore(db,target));
  try{await saveQueue;if(version===saveVersion)$('storage-state').textContent='Saved locally · IndexedDB';}catch{$('storage-state').textContent='Save failed · export the journal';}
  modelKey='';render();
}
async function preloadCandles(){
  for(const coin of ['BTC','ETH']){
    try{
      const end=Date.now(),payload=await feed.postInfo({type:'candleSnapshot',req:{coin,interval:'1m',startTime:end-7200000,endTime:end}});
      if(mode!=='live')return;
      const rows=Array.isArray(payload)?payload:payload?.data;
      if(Array.isArray(rows)){state.candles=mergeCandles(state.candles,rows,0);render();}
    }catch{/* Live candles continue when historical reference context is unavailable. */}
  }
}
function receive(message){
  if(mode!=='live'||!leader)return;const now=Date.now();
  state.lastSeen=now;
  if(message.channel==='candle')state.candles=mergeCandles(state.candles,Array.isArray(message.data)?message.data:[message.data],0);
  if(message.channel==='activeAssetCtx')state.contexts[message.data.coin]={...message.data.ctx,receivedAt:now};
  if(message.channel==='bbo')state.bbos[message.data.coin]={...message.data,receivedAt:now};
  render();
}
function model(){
  if(!state)return {events:[],positions:[],liquidations:[],missingTimes:0,unresolvedExits:0,errors:[],unknownTopics:[]};
  const key=[mode,state.raw.verifiedAt,Object.keys(state.headers).length,Object.keys(state.positionMetadata).length,state.decoder?.block].join(':');
  if(key!==modelKey){modelKey=key;modelCache=state.decoder?deriveProtocol(state.raw.logs,state.headers,state.positionMetadata):{events:[],positions:[],liquidations:[],missingTimes:0,unresolvedExits:0,errors:[],unknownTopics:[]};}
  return modelCache;
}
function render(){
  if(!state)return;const now=mode==='replay'?replayNow:Date.now(),m=model(),ctx=state.contexts[selected];
  const candles=state.candles.filter(c=>c.s===selected),last=candles.at(-1),reference=mode==='replay'?Number(last?.c):ctx&&Date.now()-ctx.receivedAt<15000?Number(ctx.markPx):Number(last?.c);
  $('mark-price').textContent=Number.isFinite(reference)?'$'+priceText(reference):'—';
  const change=ctx&&Number(ctx.prevDayPx)>0?(Number(ctx.markPx)/Number(ctx.prevDayPx)-1)*100:null;
  $('day-change').textContent=mode==='replay'?'Captured session · 11 Nov':change!==null?(change>=0?'+':'')+change.toFixed(2)+'% 24H':'Live trade-price reference';
  $('day-change').className=change!==null&&change<0?'negative':'positive';
  $('mode-badge').textContent=mode==='replay'?'CAPTURED REPLAY':paused?'PAUSED':'LIVE';$('mode-badge').classList.toggle('replay',mode==='replay');
  $('watermark-symbol').textContent=selected;
  const overlays=filterOverlays(m,{...settings,symbol:selected,from:now-settings.lookback,to:now});
  const observedThrough=Math.max(state.start,...state.raw.logs.filter(l=>l.canonical&&!l.removed).map(l=>state.headers[l.blockHash]?.time||0));
  chart.setData({candles,overlays,now,reference,start:state.start,observedThrough,lookback:settings.lookback,gaps:state.gaps||[]});
  $('chart-empty').hidden=candles.length>0;
  $('tracking-since').textContent=new Date(state.start).toLocaleString();
  $('synced-block').textContent=state.raw.cursor?'#'+Number(state.raw.cursor).toLocaleString():'First range pending';
  $('decoded-count').textContent=`${m.events.length} / ${m.unresolvedExits}`;
  $('timestamp-count').textContent=String(m.missingTimes);
  $('reference-status').textContent=mode==='replay'?'Captured reference candles':readOnly?'Collector tab reference snapshots':referenceStatus;
  $('protocol-status').textContent=mode==='replay'?'Captured raw logs + RPC metadata':readOnly?'Read-only · another tab collects':protocolStatus;
  $('connection-dot').classList.toggle('warning',mode==='replay'||referenceStatus!=='Connected'||!state.decoder);
  $('footer-status').textContent=mode==='replay'?'Captured on-chain session · not live':readOnly?'Another tab is collecting':protocolStatus;
  const matches=overlays.eligiblePositions+overlays.eligibleCloses+overlays.eligibleBubbles;
  $('coverage-status').textContent=`${matches} matching overlays · ${m.unresolvedExits} exit details pending${m.errors.length?' · '+m.errors.length+' decoder warnings':''}`;
  renderTrader();
  $('clock').textContent=new Date(now).toLocaleTimeString('en-GB',{hour12:false})+' LOCAL';
  for(const id of ['apply-endpoint','pause-collection','new-observation'])$(id).disabled=!leader||mode!=='live';
  if(!chart.mouse){const c=aggregateCandles(candles,chart.interval).at(-1);$('ohlc').textContent=c?`O ${priceText(c.o)}   H ${priceText(c.h)}   L ${priceText(c.l)}   C ${priceText(c.c)}   · ${selected} · ${chart.interval}m · current candle provisional`:'Waiting for a live reference candle…';}
  const rows=m.events.filter(e=>e.symbol===selected&&e.time!==null&&e.time>=now-settings.lookback&&e.time<=now&&notionalPass(e.notionalWad,settings.minimum)&&(settings.side==='both'||(e.isLong?'long':'short')===settings.side)).sort((a,b)=>b.time-a.time);
  $('activity-count').textContent=rows.length;
  if(!$('activity-panel').hidden){
    const signature=rows.slice(0,60).map(e=>e.id).join();
    if($('activity-list').dataset.signature!==signature){
      $('activity-list').dataset.signature=signature;
      $('activity-list').replaceChildren(...(rows.length?rows.slice(0,60).map(event=>{
        const button=document.createElement('button');button.className='activity-event';
        const icon=document.createElement('span');icon.className=event.isLong?'positive':'negative';icon.textContent=event.kind==='liquidation'?'◉':event.kind==='open'?'↗':'×';
        const label=document.createElement('span');label.textContent=`${event.kind==='liquidation'?'Liquidated':event.kind==='open'?'Opened':'Closed'} ${event.isLong?'long':'short'}`;
        const meta=document.createElement('small');meta.textContent=`#${event.positionId} · ${new Date(event.time).toLocaleTimeString('en-GB')} · ${event.owner.slice(0,8)}…`;label.append(meta);
        const size=document.createElement('b');size.textContent=shortMoney(Number(event.notionalWad)/1e18);button.append(icon,label,size);button.onclick=()=>inspect(event);return button;
      }):[Object.assign(document.createElement('p'),{className:'empty-activity',textContent:'No observed events match these filters yet.'})]));
    }
  }
}
function hidePositionHover(){
  clearTimeout(hoverTimer);hoverItem=null;$('position-hover').hidden=true;
}
function showHover(hit){
  const card=$('position-hover'),cross=$('crosshair-label');
  if(hit?.crosshair){const h=hit.crosshair;cross.hidden=false;cross.textContent=`${new Date(h.time).toLocaleString()} · ${priceText(h.price)}`;if(h.bar)$('ohlc').textContent=`O ${priceText(h.bar.o)}   H ${priceText(h.bar.h)}   L ${priceText(h.bar.l)}   C ${priceText(h.bar.c)}`;}
  else cross.hidden=true;
  clearTimeout(hoverTimer);
  if(!hit?.item){if(!card.matches(':hover')&&!card.contains(document.activeElement))hoverTimer=setTimeout(hidePositionHover,120);return;}
  hoverItem=hit.item;const e=hoverItem,p=e.status?e:model().positions.find(p=>p.positionId===e.positionId),pnl=p?pricePnl(p,referenceFor(p.symbol)):null;
  const side=e.isLong?'L':'S',notional=e.notionalWad==null?'Size —':shortMoney(Number(e.notionalWad)/1e18);
  $('hover-notional').textContent=`${side} ${notional}`;$('hover-leverage').textContent=p?.leverage!=null?p.leverage+'×':'Lev —';$('hover-pnl').textContent=pnl===null?'P&L —':'≈'+signedMoney(pnl);
  const color=e.isLong?'#72d7be':'#f58ca5';card.style.setProperty('--position-color',color);card.classList.toggle('settled',p?.status!=='open');
  card.setAttribute('aria-label',`${e.symbol||selected} position ${e.positionId}. ${p?.status||e.kind}. Estimated gross P&L excludes fees and funding.`);
  for(const id of ['hover-notional','hover-leverage','hover-pnl'])$(id).title=`Position #${e.positionId} · ${p?.status||e.kind} · Click for evidence. P&L is a gross price estimate excluding fees/funding.`;
  $('hover-trader').setAttribute('aria-label','Inspect trader for position '+e.positionId);card.hidden=false;
  const stage=$('atlas').getBoundingClientRect(),width=card.getBoundingClientRect().width;
  card.style.left=Math.max(8,Math.min(hit.x+12,stage.width-width-8))+'px';card.style.top=Math.max(88,Math.min(hit.y-15,stage.height-75))+'px';
}
for(const id of ['hover-notional','hover-leverage','hover-pnl'])$(id).onclick=()=>{if(hoverItem)inspect(hoverItem);};
$('hover-trader').onclick=()=>{if(hoverItem){const owner=hoverItem.owner;hidePositionHover();openTrader(owner);}};
$('position-hover').onpointerenter=()=>clearTimeout(hoverTimer);
$('position-hover').onpointerleave=()=>{if(!$('position-hover').contains(document.activeElement))hidePositionHover();};
$('position-hover').onfocusin=()=>clearTimeout(hoverTimer);
$('position-hover').onfocusout=e=>{if(!$('position-hover').contains(e.relatedTarget))hidePositionHover();};
function referenceFor(symbol){
  const ctx=state?.contexts[symbol];
  if(mode==='live'&&ctx&&Date.now()-ctx.receivedAt<15000)return Number(ctx.markPx);
  const last=state?.candles.filter(c=>c.s===symbol).at(-1);
  return last&&(mode==='replay'||Date.now()-Number(last.T)<120000)?Number(last.c):null;
}
function inspect(item,overlaps=[]){
  hidePositionHover();inspectedItem=item;$('event-json').textContent=JSON.stringify(item,null,2);const tx=item.transactionHash||item.exitEvent?.transactionHash;$('event-explorer').hidden=!tx;if(tx)$('event-explorer').href='https://hyperevmscan.io/tx/'+tx;
  const choices=[...new Map(overlaps.map(p=>[p.positionId,p])).values()];
  $('overlap-choices').replaceChildren();
  if(choices.length>1){const title=document.createElement('p');title.textContent=`${choices.length} overlapping positions — choose one`; $('overlap-choices').append(title);for(const p of choices){const b=document.createElement('button');b.textContent=`#${p.positionId} · ${p.isLong?'Long':'Short'} ${shortMoney(Number(p.notionalWad)/1e18)} · ${p.owner.slice(0,8)}…`;b.classList.toggle('chosen',p.positionId===item.positionId);b.onclick=()=>inspect(p,choices);$('overlap-choices').append(b);}}
  if(!$('event-inspector').open)$('event-inspector').showModal();
}
function openTrader(owner){
  if($('event-inspector').open)$('event-inspector').close();
  traderOwner=walletAddress(owner||'');traderSignature='';$('trader-panel').hidden=false;$('wallet-address').value=traderOwner||'';$('wallet-error').textContent='';
  panel('filters-panel',false);panel('data-panel',false);renderTrader();
}
function renderTrader(){
  if($('trader-panel').hidden)return;
  const m=model(),key=JSON.stringify([traderOwner,watched,mode,state.raw.verifiedAt,state.decoder?.block,m.events.length,state.start]);if(key===traderSignature)return;traderSignature=key;
  $('watched-wallets').replaceChildren(...watched.map(owner=>{const b=document.createElement('button');b.textContent='★ '+owner.slice(0,8)+'…'+owner.slice(-4);b.title=owner;b.onclick=()=>openTrader(owner);return b;}));
  const content=$('trader-content');content.replaceChildren();
  const note=document.createElement('p');note.className='trader-note';note.textContent=`${mode==='replay'?'CAPTURED REPLAY. ':''}Observed journal since ${new Date(state.start).toLocaleString()}. All markets and sizes; chart filters do not apply. Opens have no observed exit in this journal; current contract state and full wallet history are not verified. Outcomes and P&L below are based on entry/exit price, before fees/funding.`;content.append(note);
  if(!traderOwner){const hint=document.createElement('p');hint.className='trader-note';hint.textContent='Inspect a chart handle or enter a wallet. Follow saves it on this browser for quick access to future collected observations. Historical backfill and alerts are not yet available.';content.append(hint);return;}
  const summary=traderSummary(m,traderOwner),follow=document.createElement('button');follow.className='follow-wallet';follow.textContent=watched.includes(traderOwner)?'★ Following · Unfollow':'☆ Follow wallet locally';follow.onclick=()=>{watched=watched.includes(traderOwner)?watched.filter(a=>a!==traderOwner):[...watched,traderOwner];localStorage.setItem('papertrade-watched-wallets',JSON.stringify(watched));traderSignature='';renderTrader();};content.append(follow);
  const address=document.createElement('a');address.className='trader-address';address.textContent=traderOwner;address.href='https://hyperevmscan.io/address/'+traderOwner;address.target='_blank';address.rel='noreferrer';content.append(address);
  const stats=document.createElement('div');stats.className='trader-stats';for(const [label,count]of [['Open observed',summary.open.length],['Wins*',summary.wins],['Losses*',summary.losses],['Flat / unknown',summary.flat+' / '+summary.unknown]]){const box=document.createElement('div'),n=document.createElement('b'),t=document.createElement('span');n.textContent=count;t.textContent=label;box.append(n,t);stats.append(box);}content.append(stats);
  for(const [name,rows]of [['Open observed positions',summary.open],['Closed / liquidated history',summary.history]]){
    const section=document.createElement('section'),h=document.createElement('h3');h.textContent=name+' · '+rows.length;section.append(h);
    if(!rows.length){const empty=document.createElement('p');empty.className='trader-note';empty.textContent='No positions observed in this journal.';section.append(empty);}
    for(const p of rows){const button=document.createElement('button');button.className='trader-position';const title=document.createElement('strong'),detail=document.createElement('span'),outcome=document.createElement('b'),pnl=pricePnl(p,p.status==='open'?null:undefined);title.textContent=`${p.symbol||'Unknown market'} ${p.isLong?'Long':'Short'} · ${p.notionalWad==null?'Size unknown':shortMoney(Number(p.notionalWad)/1e18)} · #${p.positionId}`;detail.textContent=`${p.status} · Entry ${p.entry==null?'unknown':priceText(p.entry)}${p.exitEvent?.price!=null?' → '+priceText(p.exitEvent.price):''} · ${p.endTime?new Date(p.endTime).toLocaleString():p.openedAt?new Date(p.openedAt).toLocaleString():'time unavailable'}`;outcome.textContent=p.status==='open'?'No exit observed':pnl===null?'Outcome unknown':(pnl>0?'Win*':pnl<0?'Loss*':'Flat*')+' · ≈'+signedMoney(pnl);outcome.className=pnl>0?'positive':pnl<0?'negative':'';button.append(title,detail,outcome);button.onclick=()=>inspect(p);section.append(button);}content.append(section);
  }
}
$('inspect-trader').onclick=()=>openTrader(inspectedItem?.owner);
$('wallets-button').onclick=()=>openTrader(traderOwner);
$('close-trader').onclick=()=>$('trader-panel').hidden=true;
$('wallet-form').onsubmit=e=>{e.preventDefault();const owner=walletAddress($('wallet-address').value);if(!owner){$('wallet-error').textContent='Enter a valid 0x address (40 hexadecimal characters).';return;}openTrader(owner);};
function syncControls(){
  $('minimum-notional').value=settings.minimum;$('max-positions').value=settings.maxPositions;$('max-bubbles').value=settings.maxBubbles;$('max-positions-value').textContent=settings.maxPositions;$('max-bubbles-value').textContent=settings.maxBubbles;$('display-window').value=settings.lookback;
  for(const [id,key]of [['show-positions','showPositions'],['show-closes','showCloses'],['show-liquidations','showLiquidations']])$(id).checked=settings[key];
  document.querySelectorAll('[data-min]').forEach(b=>b.classList.toggle('chosen',Number(b.dataset.min)===settings.minimum));document.querySelectorAll('[data-side]').forEach(b=>b.classList.toggle('chosen',b.dataset.side===settings.side));
}
function changeSettings(){localStorage.setItem('papertrade-atlas-prefs-v2',JSON.stringify(settings));syncControls();render();}
function panel(id,show){$(id).hidden=!show;const button={ 'filters-panel':'filters-button','data-panel':'data-button','activity-panel':'activity-button'}[id];$(button).setAttribute('aria-expanded',String(show));if(show&&id!=='activity-panel'){for(const other of ['filters-panel','data-panel'])if(other!==id)panel(other,false);}render();}
$('filters-button').onclick=()=>panel('filters-panel',$('filters-panel').hidden);$('data-button').onclick=()=>panel('data-panel',$('data-panel').hidden);$('activity-button').onclick=()=>panel('activity-panel',$('activity-panel').hidden);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>panel(b.dataset.close,false));
document.querySelectorAll('[data-min]').forEach(b=>b.onclick=()=>{settings.minimum=Number(b.dataset.min);changeSettings();});
document.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>{settings.side=b.dataset.side;changeSettings();});
$('minimum-notional').oninput=()=>{settings.minimum=Math.max(0,Math.ceil(Number($('minimum-notional').value)||0));changeSettings();};
for(const [id,key]of [['max-positions','maxPositions'],['max-bubbles','maxBubbles']])$(id).oninput=()=>{settings[key]=Number($(id).value);changeSettings();};
for(const [id,key]of [['show-positions','showPositions'],['show-closes','showCloses'],['show-liquidations','showLiquidations']])$(id).onchange=()=>{settings[key]=$(id).checked;changeSettings();};
$('display-window').onchange=()=>{settings.lookback=Number($('display-window').value);changeSettings();chart.live();};
$('reset-filters').onclick=()=>{settings={...defaults};changeSettings();};
$('market').onchange=()=>{selected=$('market').value;chart.view=null;render();chart.fit(false);};
document.querySelectorAll('[data-interval]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-interval]').forEach(v=>v.classList.toggle('chosen',v===b));chart.setInterval(Number(b.dataset.interval));render();});
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tool]').forEach(v=>v.classList.toggle('chosen',v===b));chart.setTool(b.dataset.tool);});
$('clear-measure').onclick=()=>{chart.measurement=null;chart.draw();};$('fit-chart').onclick=()=>chart.fit(true);$('reset-view').onclick=()=>chart.fit(true);$('live-chart').onclick=()=>chart.live();$('zoom-in').onclick=()=>chart.zoom(1/1.4);$('zoom-out').onclick=()=>chart.zoom(1.4);$('close-event').onclick=()=>$('event-inspector').close();
document.addEventListener('keydown',e=>{if(e.key==='Escape'){for(const id of ['filters-panel','data-panel','activity-panel'])panel(id,false);hidePositionHover();$('trader-panel').hidden=true;}});
$('apply-endpoint').onclick=()=>{if(!leader||mode!=='live')return;try{if(new URL($('rpc-endpoint').value).protocol!=='https:')throw new Error();}catch{$('protocol-status').textContent='Enter an HTTPS RPC endpoint.';return;}collector.stop();collector.verifiedCode=false;collector.start($('rpc-endpoint').value.trim());};
$('pause-collection').onclick=()=>{if(!leader||mode!=='live')return;paused=!paused;if(paused){collector.stop();feed.stop();gap(state.lastSeen,Date.now());}else{gap(state.lastSeen,Date.now());feed.start();collector.start($('rpc-endpoint').value.trim());}$('pause-collection').textContent=paused?'Resume collection':'Pause collection';render();};
$('replay-sample').onclick=async()=>{
  if(mode==='replay')return;const response=await fetch('sample-session.json');if(!response.ok){$('protocol-status').textContent='Captured sample unavailable';return;}
  const sample=await response.json();if(leader){collector.stop();feed.stop();await commit();}liveState=state;mode='replay';state=normalize(sample);replayNow=sample.lastSeen;
  for(const [id,data]of Object.entries(sample.metadataResponses||{}))state.positionMetadata[id]=decodePosition(data,id);
  state.decoder={implementation:IMPLEMENTATION,sha256:IMPLEMENTATION_SHA256,block:state.raw.cursor,replay:true};modelKey='';chart.view=null;settings.lookback=900000;syncControls();panel('data-panel',false);panel('filters-panel',true);$('return-live').hidden=false;render();chart.fit(true);
};
$('return-live').onclick=()=>{if(mode!=='replay')return;state=liveState;mode='live';modelKey='';chart.view=null;$('return-live').hidden=true;if(leader&&!paused){gap(state.lastSeen,Date.now());feed.start();collector.start($('rpc-endpoint').value.trim());}render();chart.live();};
$('export-journal').onclick=()=>{const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString(),mode},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='papertrade-atlas-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('new-observation').onclick=()=>{if(leader&&mode==='live')$('new-observation-dialog').showModal();};
$('cancel-observation').onclick=()=>$('new-observation-dialog').close();
$('confirm-observation').onclick=async()=>{
  if(!leader||mode!=='live')return;collector.stop();feed.stop();await commit();state=fresh();paused=false;modelKey='';chart.view=null;await commit();$('new-observation-dialog').close();$('pause-collection').textContent='Pause collection';collector.verifiedCode=false;feed.start();collector.start($('rpc-endpoint').value.trim());render();
};
async function becomeLeader(){
  leader=true;state=normalize(await readStore(db)||state);if(state.lastSeen)gap(state.lastSeen,Date.now());
  feed=new HyperliquidFeed(receive,value=>{referenceStatus=value;if(value==='Connected')queueMicrotask(preloadCandles);render();},from=>{gap(from,Date.now());},['BTC','ETH'],['candle','activeAssetCtx']);
  collector=new ProtocolCollector(()=>state,commit,value=>{protocolStatus=value;render();});
  feed.start();collector.start($('rpc-endpoint').value.trim());await commit();
}
syncControls();
try{
  db=await openStore();state=normalize(await readStore(db)||fresh());
  if(!navigator.locks)throw new Error('Current Chrome or Edge is required for collection coordination.');
  navigator.locks.request('papertrade-observer-collector',{ifAvailable:true},async lock=>{if(!lock){readOnly=true;protocolStatus='Another tab is collecting';$('pause-collection').disabled=true;$('apply-endpoint').disabled=true;render();return;}await becomeLeader();await new Promise(resolve=>{releaseLock=resolve;});}).catch(e=>{protocolStatus=e.message;render();});
  setInterval(async()=>{if(!leader&&mode==='live')state=normalize(await readStore(db)||state);render();},1000);
  setInterval(()=>{if(mode==='live')commit();},5000);
  document.addEventListener('visibilitychange',()=>{if(mode==='live'&&!document.hidden&&leader&&Date.now()-state.lastSeen>45000){gap(state.lastSeen,Date.now());if(!paused){feed.stop();feed.start();}}});
  window.addEventListener('pagehide',()=>{collector?.stop();feed?.stop();commit();releaseLock?.();});render();
}catch(e){protocolStatus=e.message;$('footer-status').textContent=e.message;$('storage-state').textContent='Unavailable';}
