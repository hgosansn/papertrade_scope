import {layoutBadges} from './trader.js';
export const shortMoney=n=>n>=1e6?'$'+(n/1e6).toFixed(n>=1e7?1:2)+'m':n>=1000?'$'+(n/1000).toFixed(0)+'k':'$'+n.toFixed(0);
export const priceText=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const timeText=t=>new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});
export function aggregateCandles(candles,minutes=1){
  const groups=new Map(),duration=minutes*60000;
  for(const c of [...candles].sort((a,b)=>a.t-b.t)){
    const t=Math.floor(c.t/duration)*duration,old=groups.get(t);
    if(!old)groups.set(t,{...c,t,T:t+duration-1,o:Number(c.o),h:Number(c.h),l:Number(c.l),c:Number(c.c),v:Number(c.v)||0,observations:1});
    else{old.h=Math.max(old.h,Number(c.h));old.l=Math.min(old.l,Number(c.l));old.c=Number(c.c);old.v+=Number(c.v)||0;old.observations++;}
  }
  return [...groups.values()];
}
export class AtlasChart{
  constructor(canvas,{onHover,onInspect,onLabels,onView,onStats}){
    Object.assign(this,{canvas,onHover,onInspect,onLabels,onView,onStats,data:null,tool:'crosshair',interval:1,view:null,follow:true,mouse:null,drag:null,measurement:null,includeOverlays:false});
    this.ctx=canvas.getContext('2d');this.resizeObserver=new ResizeObserver(()=>this.draw());this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown',e=>this.down(e));canvas.addEventListener('pointermove',e=>this.move(e));
    canvas.addEventListener('pointerup',e=>this.up(e));canvas.addEventListener('pointercancel',()=>{this.drag=null;});
    canvas.addEventListener('pointerleave',()=>{if(!this.drag){this.mouse=null;this.onHover(null);this.draw();}});
    canvas.addEventListener('wheel',e=>{e.preventDefault();const r=canvas.getBoundingClientRect();this.zoom(e.deltaY>0?1.18:1/1.18,e.clientX-r.left);},{passive:false});
    canvas.addEventListener('dblclick',()=>this.fit());
  }
  setData(data){this.data=data;if(!this.view)this.fit(false);else if(this.follow){const span=this.view.to-this.view.from;this.view={from:data.now-span*.93,to:data.now+span*.07};}this.draw();}
  setTool(tool){this.tool=tool;this.canvas.style.cursor=tool==='pan'?'grab':'crosshair';this.draw();}
  setInterval(minutes){this.interval=minutes;this.draw();}
  fit(includeOverlays=true){
    if(!this.data)return;this.includeOverlays=includeOverlays;
    const rows=this.data.candles.filter(c=>c.t>=this.data.now-this.data.lookback),last=rows.at(-1);
    const start=rows.length?rows[Math.max(0,rows.length-80)].t:this.data.now-900000;
    const span=Math.max(600000,(last?.T||this.data.now)-start);
    this.view={from:start-span*.04,to:Math.max(last?.T||this.data.now,this.data.now)+span*.1};this.follow=false;this.onView?.();this.draw();
  }
  live(){if(!this.data)return;const span=Math.min(this.data.lookback,Math.max(900000,this.view?this.view.to-this.view.from:900000));this.view={from:this.data.now-span*.93,to:this.data.now+span*.07};this.follow=true;this.includeOverlays=false;this.onView?.();this.draw();}
  zoom(factor,anchor){if(!this.view||!this.plot)return;const p=this.plot,ratio=Math.max(0,Math.min(1,((anchor??(p.left+p.right)/2)-p.left)/(p.right-p.left))),span=this.view.to-this.view.from,next=Math.max(180000,Math.min(86400000,span*factor)),t=this.view.from+span*ratio;this.view={from:t-next*ratio,to:t+next*(1-ratio)};this.follow=false;this.onView?.();this.draw();}
  coords(e){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  down(e){if(!this.plot)return;const point=this.coords(e);this.canvas.setPointerCapture(e.pointerId);
    if(this.tool==='measure'){const sample={time:this.timeAt(point.x),price:this.priceAt(point.y)};if(this.measurement?.complete)this.measurement=null;if(!this.measurement)this.measurement={a:sample,b:sample,complete:false};else{this.measurement.b=sample;this.measurement.complete=true;}this.draw();return;}
    this.drag={...point,view:{...this.view},moved:false};if(this.tool==='pan')this.canvas.style.cursor='grabbing';
  }
  move(e){if(!this.plot)return;const point=this.coords(e);this.mouse=point;
    if(this.drag){const dx=point.x-this.drag.x;if(Math.abs(dx)>4)this.drag.moved=true;if(this.drag.moved){const shift=-dx/(this.plot.right-this.plot.left)*(this.drag.view.to-this.drag.view.from);this.view={from:this.drag.view.from+shift,to:this.drag.view.to+shift};this.follow=false;this.onView?.();}}
    if(this.tool==='measure'&&this.measurement&&!this.measurement.complete)this.measurement.b={time:this.timeAt(point.x),price:this.priceAt(point.y)};
    const hit=this.hit(point);this.onHover(hit?{item:hit.item,x:point.x,y:point.y}:null);this.draw();
  }
  up(e){if(this.drag&&!this.drag.moved){const hit=this.hit(this.coords(e));if(hit)this.onInspect(hit.item,this.hitAll(this.coords(e)).map(h=>h.item));}this.drag=null;if(this.tool==='pan')this.canvas.style.cursor='grab';}
  timeAt(x){return this.view.from+(x-this.plot.left)/(this.plot.right-this.plot.left)*(this.view.to-this.view.from);}
  priceAt(y){return this.high-(y-this.plot.top)/(this.plot.bottom-this.plot.top)*(this.high-this.low);}
  hitAll(p){return [...(this.hits||[])].reverse().filter(hit=>hit.type==='bubble'?Math.hypot(p.x-hit.x,p.y-hit.y)<=hit.r+4:p.x>=hit.x1-4&&p.x<=hit.x2+4&&Math.abs(p.y-hit.y)<6);}
  hit(p){return this.hitAll(p)[0]??null;}
  draw(){
    const box=this.canvas.getBoundingClientRect();if(box.width<1||box.height<1)return;
    const dpr=window.devicePixelRatio||1,w=box.width,h=box.height;this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);
    const c=this.ctx;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.font='10px Consolas, monospace';
    const p=this.plot={left:w<720?56:77,right:w-(w<720?76:94),top:108,bottom:h-82};if(p.bottom<=p.top)return;
    if(!this.data||!this.view){this.onLabels?.({labels:[],overflow:0});return;}
    this.canvas.dataset.viewFrom=String(Math.round(this.view.from));this.canvas.dataset.viewTo=String(Math.round(this.view.to));
    const rows=aggregateCandles(this.data.candles,this.interval).filter(r=>r.T>=this.view.from&&r.t<=this.view.to),overlays=this.data.overlays;
    const values=rows.flatMap(r=>[Number(r.h),Number(r.l)]);
    if(this.includeOverlays){values.push(...overlays.positions.filter(v=>v.openedAt<=this.view.to&&(v.endTime??this.data.now)>=this.view.from).map(v=>v.entry));values.push(...overlays.bubbles.filter(v=>v.time>=this.view.from&&v.time<=this.view.to).map(v=>v.price));}
    if(!values.length&&this.data.reference)values.push(this.data.reference);
    if(!values.length){this.onLabels?.({labels:[],overflow:0});this.onStats?.({lines:0,bubbles:0});return;}
    let low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.25,high*.0007);this.low=low-pad;this.high=high+pad;
    const x=t=>p.left+(t-this.view.from)/(this.view.to-this.view.from)*(p.right-p.left),y=n=>p.bottom-(Number(n)-this.low)/(this.high-this.low)*(p.bottom-p.top);
    this.hits=[];
    // Sparse exchange data stays sparse: no interpolated/fabricated candles.
    c.lineWidth=.6;
    for(let i=0;i<=7;i++){const yy=p.top+(p.bottom-p.top)*i/7;c.strokeStyle='#212737';c.beginPath();c.moveTo(p.left,yy);c.lineTo(p.right,yy);c.stroke();c.fillStyle='#687793';c.fillText(priceText(this.high-(this.high-this.low)*i/7),p.right+13,yy+3);}
    for(let i=0;i<=7;i++){const xx=p.left+(p.right-p.left)*i/7;c.strokeStyle='#1c2331';c.beginPath();c.moveTo(xx,p.top);c.lineTo(xx,p.bottom);c.stroke();c.fillStyle='#586983';c.fillText(timeText(this.view.from+(this.view.to-this.view.from)*i/7),xx-14,p.bottom+25);}
    c.save();c.beginPath();c.rect(p.left,p.top,p.right-p.left,p.bottom-p.top);c.clip();
    for(const gap of this.data.gaps||[]){const a=x(gap.from),b=x(gap.to);if(b<p.left||a>p.right)continue;c.fillStyle='#9f8ab906';c.fillRect(a,p.top,b-a,p.bottom-p.top);c.strokeStyle='#9f8ab910';for(let xx=Math.max(a,p.left)-h;xx<b;xx+=18){c.beginPath();c.moveTo(xx,p.bottom);c.lineTo(xx+h,p.top);c.stroke();}}
    let lines=0,bubbles=0;const badgeCandidates=[];
    for(const position of overlays.positions){
      if(position.entry===null||position.openedAt===null||(position.status!=='open'&&position.endTime===null))continue;
      const yy=y(position.entry),begin=Math.max(position.openedAt,this.data.start),end=position.endTime??Math.min(this.data.now,this.data.observedThrough??this.data.now),x1=Math.max(p.left,x(begin)),x2=Math.min(p.right,x(end));
      if(yy<p.top||yy>p.bottom||x2<x1)continue;
      const color=position.isLong?'#72d7be':'#f58ca5',notional=Number(position.notionalWad)/1e18;
      c.globalAlpha=position.status==='open'?.95:.6;c.strokeStyle=color;c.lineWidth=Math.min(2.6,1+Math.log10(Math.max(1,notional/100000))*.6);c.setLineDash(position.status==='open'&&position.openObserved?[]:[4,5]);
      c.beginPath();c.moveTo(x1,yy);c.lineTo(x2,yy);c.stroke();c.setLineDash([]);c.fillStyle=color;c.beginPath();c.arc(x1,yy,2.8,0,Math.PI*2);c.fill();c.globalAlpha=1;
      if(position.status!=='open'){c.strokeStyle=color;c.lineWidth=1;c.beginPath();c.moveTo(x2-2.5,yy-2.5);c.lineTo(x2+2.5,yy+2.5);c.moveTo(x2-2.5,yy+2.5);c.lineTo(x2+2.5,yy-2.5);c.stroke();}
      badgeCandidates.push({item:position,y:yy,endX:x2,color});
      this.hits.push({type:'line',item:position,x1,x2,y:yy});lines++;
    }
    const barWidth=Math.min(13,(p.right-p.left)/(this.view.to-this.view.from)*(this.interval*60000)*.62);
    for(const bar of rows){const xx=x(bar.t+this.interval*30000),color=bar.c>=bar.o?'#88bcb9':'#c28199';c.globalAlpha=bar.observations<this.interval?.55:.92;c.strokeStyle=c.fillStyle=color;c.lineWidth=1;c.beginPath();c.moveTo(xx,y(bar.h));c.lineTo(xx,y(bar.l));c.stroke();c.fillRect(xx-Math.max(2,barWidth)/2,Math.min(y(bar.o),y(bar.c)),Math.max(2,barWidth),Math.max(1,Math.abs(y(bar.o)-y(bar.c))));}
    c.globalAlpha=1;
    for(const event of overlays.bubbles){
      const xx=x(event.time),yy=y(event.price);if(xx<p.left||xx>p.right||yy<p.top||yy>p.bottom)continue;
      const size=Number(event.notionalWad)/1e18,r=Math.max(5,Math.min(30,5*Math.sqrt(size/100000))),color=event.isLong?'#f58ca5':'#72d7be';
      const glow=c.createRadialGradient(xx,yy,0,xx,yy,r*1.9);glow.addColorStop(0,color+'28');glow.addColorStop(.55,color+'10');glow.addColorStop(1,color+'00');c.fillStyle=glow;c.beginPath();c.arc(xx,yy,r*1.9,0,Math.PI*2);c.fill();
      c.fillStyle=color+'18';c.strokeStyle=color+'b0';c.lineWidth=1;c.beginPath();c.arc(xx,yy,r,0,Math.PI*2);c.fill();c.stroke();c.fillStyle=color;c.beginPath();c.arc(xx,yy,2,0,Math.PI*2);c.fill();
      if(size>=1000000){c.font='9px Consolas, monospace';c.fillText(shortMoney(size),xx+r+5,yy+3);}
      this.hits.push({type:'bubble',item:event,x:xx,y:yy,r});bubbles++;
    }
    // Label guides are display connectors, not extensions of a position's lifetime.
    const badgeLayout=layoutBadges(badgeCandidates,p,Math.min(250,Math.max(180,(p.right-p.left)*.31)));
    for(const label of badgeLayout.labels){c.strokeStyle=label.color+'90';c.lineWidth=1;c.setLineDash([2,4]);c.beginPath();c.moveTo(label.endX,label.y);c.lineTo(label.left+10,label.y);c.lineTo(label.left+10,label.top+label.height/2);c.stroke();c.setLineDash([]);}
    this.onLabels?.(badgeLayout);
    c.restore();
    const last=rows.at(-1);if(last){const yy=y(last.c);if(yy>p.top&&yy<p.bottom){c.strokeStyle='#8b9fb340';c.lineWidth=.7;c.setLineDash([3,5]);c.beginPath();c.moveTo(p.left,yy);c.lineTo(p.right,yy);c.stroke();c.setLineDash([]);c.fillStyle='#819cae';c.fillRect(p.right,yy-10,w-p.right-3,21);c.fillStyle='#111925';c.font='10px Consolas, monospace';c.fillText(priceText(last.c),p.right+9,yy+4);}}
    if(this.measurement){const{a,b}=this.measurement,xx=x(a.time),xx2=x(b.time),yy=y(a.price),yy2=y(b.price);c.fillStyle=b.price>=a.price?'#72d7be12':'#f58ca512';c.fillRect(Math.min(xx,xx2),Math.min(yy,yy2),Math.abs(xx2-xx),Math.abs(yy2-yy));c.strokeStyle='#a99ad6';c.strokeRect(Math.min(xx,xx2),Math.min(yy,yy2),Math.abs(xx2-xx),Math.abs(yy2-yy));const delta=(b.price/a.price-1)*100,label=`${delta>=0?'+':''}${delta.toFixed(2)}% · ${Math.abs((b.time-a.time)/60000).toFixed(1)}m`;c.font='10px Consolas, monospace';c.fillStyle='#bdb0df';c.fillText(label,Math.min(xx,xx2)+8,Math.min(yy,yy2)-9);}
    if(this.mouse&&this.tool!=='pan'&&this.mouse.x>=p.left&&this.mouse.x<=p.right&&this.mouse.y>=p.top&&this.mouse.y<=p.bottom){const m=this.mouse;c.strokeStyle='#7c8ba15a';c.lineWidth=.8;c.setLineDash([3,5]);c.beginPath();c.moveTo(m.x,p.top);c.lineTo(m.x,p.bottom);c.moveTo(p.left,m.y);c.lineTo(p.right,m.y);c.stroke();c.setLineDash([]);const bar=rows.reduce((a,b)=>Math.abs(b.t-this.timeAt(m.x))<Math.abs((a?.t??Infinity)-this.timeAt(m.x))?b:a,null);this.onHover?.({item:this.hit(m)?.item??null,x:m.x,y:m.y,crosshair:{time:this.timeAt(m.x),price:this.priceAt(m.y),bar}});}
    this.canvas.dataset.lines=String(lines);this.canvas.dataset.bubbles=String(bubbles);this.onStats?.({lines,bubbles});
  }
}
