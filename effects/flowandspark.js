/* Flow & Spark. Slow movement combs luminous silk; quick sweeps shed warm sparks.
 * Hold: gather a knot. Drag: stretch strands. Release: unwind. Other motion sends
 * waves through held strands. Existing kit.fingers + WallBody (v2) + kit.room (v1).
 * No socket, sound, storage, calibration or game writes. V1 is aggregate motion,
 * not skeletal tracking. All pools bounded; stale input releases without a burst.
 */
(function () {
  'use strict';
  var TAU = Math.PI * 2, N = 61, MAX_HANDS = 4, MAX_SPARKS = 520;
  var clamp = function(v, a, b) { return Math.max(a, Math.min(b, v)); };
  var valid = function(p) { return Array.isArray(p) && p.length >= 2 && p.slice(0,2).every(function(v) { return Number.isFinite(v) && v >= 0 && v <= 1; }); };
  registerWallPlugin({id:'flowandspark', title:'Flow & Spark', author:'lab', create:function(canvas, kit) {
    var g = canvas.getContext('2d', {alpha:false}), W=canvas.width, H=canvas.height;
    var settings={punch:1.3,silk:1,sparks:1,fade:2.8,brightness:1};
    var ranges={punch:[.3,2],silk:[.4,1.8],sparks:[0,2],fade:[1,5],brightness:[.3,1.4]};
    var time=0, energy=0, hands=[], nextId=1, lastFinger=-Infinity, pulses=[], sparks=[], ribbons=[];
    var actors=new Map(), dead=false, body=window.WallBody ? WallBody.create(kit,{minMm:110}) : null;
    var roomBudget=0, roomSpeed=0, roomLast=null, releaseCount=0, madeSparks=0, bodyPulses=0, reduced=false;
    var media=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var randSeed=17391;
    function random() { randSeed=(Math.imul(randSeed,1664525)+1013904223)>>>0; return randSeed/4294967296; }
    for(var r=0;r<6;r++) {
      var nodes=[];
      for(var i=0;i<N;i++) nodes.push({x:i/(N-1),y:.5,vx:0,vy:0});
      ribbons.push({nodes:nodes,phase:r*.89,offset:(r-2.5)*.045});
    }
    function set(o) {
      if(o && !dead) Object.keys(ranges).forEach(function(k) { if(Number.isFinite(o[k])) settings[k]=clamp(o[k],ranges[k][0],ranges[k][1]); });
      return Object.assign({},settings);
    }
    function pulse(x,y,power,kind) {
      if(!Number.isFinite(x+y+power))return;
      pulses.push({x:x,y:y,age:0,power:clamp(power,0,1.5),kind:kind||'motion'});
      if(pulses.length>28)pulses.shift();
      energy=Math.max(energy,clamp(power*.6,0,1));
    }
    function emit(x,y,vx,vy,count) {
      if(reduced)return;
      count=Math.min(24,Math.floor(count*settings.sparks));
      for(var i=0;i<count;i++) {
        if(sparks.length>=MAX_SPARKS)break;
        var a=random()*TAU, v=.035+random()*.15;
        sparks.push({x:x,y:y,px:x,py:y,vx:vx*.3+Math.cos(a)*v,vy:vy*.3+Math.sin(a)*v,
          life:.4+random()*.85,age:0,white:random()<.18,width:.7+random()*1.1});madeSparks++;
      }
    }
    function release(h,intentional) {
      if(!h.held)return;
      h.held=false;h.released=time;
      if(intentional) { releaseCount++;pulse(h.x,h.y,.65,'release'); }
    }
    function readHands(dt) {
      var f=kit.fingers, stamp=Date.now(), pts=null, fresh=false;
      if(f) {
        fresh=Number.isFinite(f.t) && stamp-f.t>=-34 && stamp-f.t<220;
        if(fresh && f.t>lastFinger && Array.isArray(f.pts)) { lastFinger=f.t;pts=f.pts.filter(valid).slice(0,MAX_HANDS); }
      } else if(kit.touches) {
        var touches=kit.touches.filter(function(t){return t && Number.isFinite(t.t) && stamp-t.t>=0 && stamp-t.t<180 && valid([t.x,t.y]);});
        var newest=touches.reduce(function(m,t){return Math.max(m,t.t);},-Infinity);
        if(newest>lastFinger) { lastFinger=newest;pts=touches.slice(0,MAX_HANDS).map(function(t){return [t.x,t.y];}); }
        fresh=touches.length>0;
      }
      if(pts!==null) {
        var used=new Set(), assigned=new Set(), pairs=[];
        hands.forEach(function(h,hi){if(!h.held)return;pts.forEach(function(p,pi){var d=Math.hypot(p[0]-h.x,p[1]-h.y);if(d<.24)pairs.push({d:d,hi:hi,pi:pi});});});
        pairs.sort(function(a,b){return a.d-b.d;});
        pairs.forEach(function(p){
          if(used.has(p.hi)||assigned.has(p.pi))return;
          used.add(p.hi);assigned.add(p.pi);
          var h=hands[p.hi],xy=pts[p.pi],gap=time-h.seen;
          var elapsed=clamp(gap,1/120,.15),vx=(xy[0]-h.x)/elapsed,vy=(xy[1]-h.y)/elapsed;
          var raw=Math.hypot(vx,vy), speed=raw<.035?0:clamp(raw,0,3);
          // Reacquisition after a dropout never creates a speed spike.
          if(gap>.12){speed=0;vx=vy=0;}
          h.speed+=(speed-h.speed)*.55;h.vx=vx;h.vy=vy;h.x=xy[0];h.y=xy[1];h.seen=time;h.missing=null;
          if(h.speed>.45 && time-h.sparkAt>.045) {emit(h.x,h.y,clamp(vx,-3,3),clamp(vy,-3,3),8+Math.min(14,h.speed*7));h.sparkAt=time;}
          if(h.speed>.06 && time-h.waveAt>.14) {pulse(h.x,h.y,.22+h.speed*.28);h.waveAt=time;}
        });
        pts.forEach(function(p,pi){
          if(assigned.has(pi)||hands.filter(function(h){return h.held;}).length>=MAX_HANDS)return;
          hands.push({id:nextId++,x:p[0],y:p[1],home:p[0],seen:time,born:time,held:true,released:0,
            speed:0,vx:0,vy:0,missing:null,sparkAt:time,waveAt:time});
          pulse(p[0],p[1],.35,'gather');
        });
        hands.forEach(function(h,hi){if(h.held && h.seen!==time && h.missing===null)h.missing=time;});
      }
      hands.forEach(function(h){
        if(h.held && (!fresh || time-h.seen>.22))release(h,false);
        else if(h.held && h.missing!==null && time-h.missing>.11)release(h,true);
        h.speed*=Math.exp(-dt*3);
      });
      hands=hands.filter(function(h){return h.held || time-h.released<settings.fade;});
      if(hands.length>12)hands=hands.slice(-12);
    }
    function readMotion(dt,now) {
      var movers=[], reg=false;
      if(body) {
        var folded=body.update(dt,now);reg=body.regOk;
        if(body.fresh && reg) body.people.slice(0,6).forEach(function(p){
          var xy=kit.toScreen(p.cx*512,p.cy*424);
          if(!valid(xy))return;
          var key='v2:'+p.id,prev=actors.get(key),speed=0;
          if(folded) {
            var gap=prev ? (now-prev.now)/1000 : 0;
            if(gap>0 && gap<.2) speed=clamp(Math.hypot(xy[0]-prev.x,xy[1]-prev.y)/gap,0,2);
            var mv=prev ? Math.max(speed,clamp(p.moving,0,1)*.9) : 0;
            actors.set(key,{x:xy[0],y:xy[1],now:now,speed:mv,lastPulse:prev?prev.lastPulse:-10});
          }
          var a=actors.get(key);if(a)movers.push({key:key,x:xy[0],y:xy[1],speed:a.speed});
        });
      }
      actors.forEach(function(a,k){if(now-a.now>220)actors.delete(k);});
      var room=kit.room ? kit.room(dt) : null;
      if(room && room.enabled && room.fresh && room.present && Number.isFinite(room.motion)) {
        var positioned=room.positioned && Number.isFinite(room.x) && Number.isFinite(room.y);
        var rx=positioned ? clamp(.5+room.x*.42,0,1) : .5, ry=positioned ? clamp(.5+room.y*.25,0,1) : .5;
        roomSpeed=clamp(room.motion,0,1)*1.2;
        // V1 deliberately exposes collective energy when more than one region exists.
        roomLast={x:rx,y:ry};roomBudget+=dt;
        if(roomBudget>.15 && roomSpeed>.018) {pulse(rx,ry,.2+roomSpeed*.7);roomBudget=0;bodyPulses++;}
        if(roomSpeed>.6 && roomBudget<dt*1.1)emit(rx,ry,0,-roomSpeed*.2,8*roomSpeed);
      } else {roomSpeed=0;roomLast=null;roomBudget=0;}
      movers.forEach(function(m){
        var a=actors.get(m.key);
        if(m.speed>.035 && time-a.lastPulse>.16) {pulse(m.x,m.y,.2+m.speed*.65);a.lastPulse=time;bodyPulses++;
          if(m.speed>.6)emit(m.x,m.y,0,-.12,8*m.speed);
        }
      });
      return {people:movers.length,reg:reg,room:!!roomLast};
    }
    function simulate(dt) {
      var active=hands.filter(function(h){return h.held;});
      var target=active.length ? .82 : 0;
      energy+=(target-energy)*(1-Math.exp(-dt/(target>energy?.08:settings.fade)));
      pulses.forEach(function(p){p.age+=dt;});pulses=pulses.filter(function(p){return p.age<2.6;});
      var calm=reduced?.25:1;
      ribbons.forEach(function(r,ri){
        for(var i=0;i<N;i++) {
          var u=i/(N-1),n=r.nodes[i];
          var wave=Math.sin(u*TAU*1.35-time*.23*calm+r.phase*.34);
          var tx=-.065+u*1.13 + .025*Math.sin(u*TAU*2-time*.3+r.phase), ty=.5+r.offset;
          ty+=wave*(.13+.1*energy)*settings.silk + Math.sin(u*TAU*2.6+time*.18+r.phase)*.06*settings.silk;
          pulses.forEach(function(p){
            var d=Math.abs(u-p.x),front=p.age*.48,env=Math.exp(-Math.pow((d-front)/.16,2))*Math.exp(-p.age*.8);
            ty+=Math.sin(d*19-p.age*9+r.phase*.24)*env*p.power*.12*settings.punch*calm;
          });
          hands.forEach(function(h,hi){
            var age=h.held?Math.min(1,(time-h.born)/.24):Math.exp(-(time-h.released)/(.3+settings.fade*.2));
            var du=u-h.home,weight=Math.exp(-du*du/(.014+Math.abs(h.x-h.home)*.08));
            var affinity=(ri+hi)%3===0?.42:1;
            var edge=clamp(u/.12,0,1)*clamp((1-u)/.12,0,1);
            var pull=clamp(weight*age*affinity*edge,0,.98);
            var curl=(h.held?.014:.045)*Math.sin(du*25+time*(h.held?1.2:2)+r.phase);
            tx+=(h.x+du*.35-tx)*pull;
            ty+=(h.y+curl*(1-weight)-ty)*pull;
          });
          var k=1-Math.exp(-dt*(reduced?5:13));n.x+=(tx-n.x)*k;n.y+=(ty-n.y)*k;
        }
      });
      sparks.forEach(function(s){s.px=s.x;s.py=s.y;s.age+=dt;s.vx*=Math.exp(-dt*1.15);s.vy+=dt*.045;s.x+=s.vx*dt;s.y+=s.vy*dt;});
      sparks=sparks.filter(function(s){return s.age<s.life;});
    }
    var points=new Float32Array(N*2);
    function path(r,offset,width) {
      g.beginPath();
      for(var i=0;i<N;i++) {
        var n=r.nodes[i],prev=r.nodes[Math.max(0,i-1)],next=r.nodes[Math.min(N-1,i+1)];
        var dx=(next.x-prev.x)*W,dy=(next.y-prev.y)*H,len=Math.hypot(dx,dy)||1,u=i/(N-1);
        var breadth=(12+39*Math.pow(Math.sin(u*Math.PI),2))*(.4+.6*energy)*settings.silk*W/1280;
        var d=offset*breadth*(.4+.6*Math.pow(Math.sin(u*11-time*.45+r.phase),2));
        d+=Math.sin(u*22+time*.4+r.phase+offset*2)*width;
        points[i*2]=n.x*W-dy/len*d;points[i*2+1]=n.y*H+dx/len*d;
      }
      g.moveTo(points[0],points[1]);
      for(var j=1;j<N-1;j++)g.quadraticCurveTo(points[j*2],points[j*2+1],(points[j*2]+points[j*2+2])*.5,(points[j*2+1]+points[j*2+3])*.5);
      g.lineTo(points[(N-1)*2],points[(N-1)*2+1]);
    }
    function draw() {
      g.globalCompositeOperation='source-over';g.globalAlpha=1;g.fillStyle='#010209';g.fillRect(0,0,W,H);
      g.globalCompositeOperation='lighter';g.lineJoin='round';g.lineCap='round';
      var light=(.10+energy*1.15)*settings.brightness,px=W/1280;
      ribbons.forEach(function(r,ri){
        var gradient=g.createLinearGradient(0,0,W,H*.7);
        if(ri%2) {gradient.addColorStop(0,'#4e1dea');gradient.addColorStop(.46,'#af6fff');gradient.addColorStop(1,'#00dfff');}
        else {gradient.addColorStop(0,'#047eec');gradient.addColorStop(.5,'#00cfff');gradient.addColorStop(1,'#8852ff');}
        g.strokeStyle=gradient;
        path(r,0,0);g.globalAlpha=Math.min(1,light*.075);g.lineWidth=46*px;g.stroke();
        g.globalAlpha=Math.min(1,light*.15);g.lineWidth=19*px;g.stroke();
        for(var f=0;f<13;f++) {
          var off=(f-6)/6;path(r,off,1.3*px);
          g.globalAlpha=Math.min(1,light*(f===6?.75:.22+(.5+.5*Math.sin(f*1.7+r.phase))*.25));
          g.lineWidth=(f===6?2:1)*px;g.stroke();
        }
      });
      hands.forEach(function(h){
        var a=h.held?Math.min(1,(time-h.born)/.18):Math.exp(-(time-h.released)*3);
        if(a<.01)return;
        var x=h.x*W,y=h.y*H,rad=(22+Math.min(time-h.born,1)*10)*px;
        var halo=g.createRadialGradient(x,y,0,x,y,rad*2.2);
        halo.addColorStop(0,'rgba(172,212,255,.6)');halo.addColorStop(.14,'rgba(82,140,255,.25)');halo.addColorStop(1,'rgba(37,30,110,0)');
        g.globalAlpha=Math.min(1,a*settings.brightness);g.fillStyle=halo;g.fillRect(x-rad*2.2,y-rad*2.2,rad*4.4,rad*4.4);
        for(var j=0;j<5;j++) {g.beginPath();g.strokeStyle=j%2?'#a47cff':'#65dfff';g.lineWidth=px*.8;g.globalAlpha=a*.55*settings.brightness;
          g.ellipse(x,y,rad*(.45+j*.09),rad*(.12+j*.025),time*.4+j*.6,0,TAU);g.stroke();}
        g.fillStyle='#eefaff';g.globalAlpha=Math.min(1,a*.9*settings.brightness);g.beginPath();g.arc(x,y,2.8*px,0,TAU);g.fill();
      });
      sparks.forEach(function(s){
        var fade=Math.pow(1-s.age/s.life,1.5)*Math.min(1,s.age/.035);
        g.globalAlpha=Math.min(1,fade*.85*settings.brightness);g.strokeStyle=s.white?'#fff7df':'#ffb24d';g.lineWidth=s.width*px;
        g.beginPath();g.moveTo((s.x-s.vx*.024)*W,(s.y-s.vy*.024)*H);g.lineTo(s.x*W,s.y*H);g.stroke();
      });
      g.globalAlpha=1;g.globalCompositeOperation='source-over';
    }
    var motionState={people:0,reg:false,room:false};
    function frame(dt,now) {
      if(dead)return;
      dt=clamp(Number.isFinite(dt)?dt:0,0,.05);time+=dt;W=canvas.width;H=canvas.height;
      reduced=!!(media && media.matches);
      readHands(dt);motionState=readMotion(dt,now);simulate(dt);draw();
    }
    window.FlowandsparkSet=set;if(window._flowandsparkFx)set(window._flowandsparkFx);
    kit.wantDepth(true);
    return {frame:frame,touch:function(){/* kit.fingers is authoritative; sparse kit.touches is the fallback. */},
      resize:function(w,h){W=w;H=h;},
      destroy:function(){if(dead)return;dead=true;kit.wantDepth(false);if(window.FlowandsparkSet===set)delete window.FlowandsparkSet;
        hands=[];sparks=[];pulses=[];actors.clear();ribbons=[];},
      debug:function(){return {settings:set(),held:hands.filter(function(h){return h.held;}).length,
        hands:hands.map(function(h){return {id:h.id,x:h.x,y:h.y,held:h.held};}),sparks:sparks.length,madeSparks:madeSparks,
        releases:releaseCount,bodyPulses:bodyPulses,pulses:pulses.length,energy:energy,reduced:reduced,
        people:motionState.people,reg:motionState.reg,room:motionState.room,
        finite:ribbons.every(function(r){return r.nodes.every(function(n){return Number.isFinite(n.x+n.y);});})};}
    };
  }});
})();
