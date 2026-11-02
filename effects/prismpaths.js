/* Prism Paths — private study, 2026-10-10. A hand carries a crystal that
   splits light; pair beam intersections open a rosette. Analytic bounded rays,
   coarse body occlusion, Canvas 2D, no network, external assets or audio. */
(function(){'use strict';
  registerWallPlugin({id:'prismpaths',title:'Prism Paths',author:'Codex',create:create});

  function valid(x,y){return Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1&&y>=0&&y<=1;}
  function contacts(kit){
    var wakes=[];
    function read(){
      var f=kit.fingers, age=f?Date.now()-f.t:Infinity, now=performance.now(), out=[];
      wakes=wakes.filter(function(p){return now-p.t>=0&&now-p.t<=240;});
      if(f&&Array.isArray(f.pts)&&age>=0&&age<=180){wakes=[];return f.pts.filter(function(p){return p&&valid(p[0],p[1]);}).slice(0,4);}
      function add(x,y){if(!valid(x,y)||out.length>=4)return;for(var i=0;i<out.length;i++)if(Math.hypot(out[i][0]-x,out[i][1]-y)<.025)return;out.push([x,y]);}
      wakes.forEach(function(p){add(p.x,p.y);});
      (kit.touches||[]).forEach(function(p){if(p&&Date.now()-p.t>=0&&Date.now()-p.t<240&&(!f||!Number.isFinite(f.t)||p.t>f.t))add(p.x,p.y);});return out;
    }
    return{read:read,wake:function(x,y){if(!valid(x,y))return;var f=kit.fingers,age=f?Date.now()-f.t:Infinity;if(f&&Array.isArray(f.pts)&&age>=0&&age<=180){wakes=[];return;}var now=performance.now();wakes=wakes.filter(function(p){return now-p.t<=240;});for(var i=0;i<wakes.length;i++)if(Math.hypot(wakes[i].x-x,wakes[i].y-y)<.025){wakes[i]={x:x,y:y,t:now};return;}if(wakes.length>=4)wakes.shift();wakes.push({x:x,y:y,t:now});},clear:function(){wakes=[];},size:function(){return wakes.length;}};
  }
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  function create(canvas,kit){
    var ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Prism Paths needs Canvas 2D');
    var body=WallBody.create(kit,{}),input=contacts(kit),dead=false,time=0,frames=0,size=[1280,800],last=[],tracks=[],nextId=1;
    var settings={spread:45,rays:7,linger:1.2,hue:0}, rays=[], crossings=[], clipped=0, bodyCount=0,frameMs=0;
    function intersect(a,b){var dx=a.ex-a.x,dy=a.ey-a.y,ux=b.ex-b.x,uy=b.ey-b.y,den=dx*uy-dy*ux;if(Math.abs(den)<1e-7)return null;
      var qx=b.x-a.x,qy=b.y-a.y,t=(qx*uy-qy*ux)/den,s=(qx*dy-qy*dx)/den;if(t>.05&&t<.98&&s>.05&&s<.98)return[a.x+dx*t,a.y+dy*t];return null;}
    function endRay(x,y,dx,dy){var t=1e9;if(dx>1e-6)t=Math.min(t,(1230-x)/dx);if(dx< -1e-6)t=Math.min(t,(50-x)/dx);if(dy>1e-6)t=Math.min(t,(760-y)/dy);if(dy< -1e-6)t=Math.min(t,(40-y)/dy);t=Math.max(0,Math.min(t,1600));
      if(body.fresh){
        function occupied(u,v){var p=kit.fromScreen(u/1280,v/800);if(!p||p[0]<0||p[0]>=512||p[1]<0||p[1]>=424)return false;var k=Math.floor(p[1]/4)*body.w+Math.floor(p[0]/4);return body.mask[k]>.56;}
        // A carried prism can start inside its owner's silhouette. Let light
        // leave that occupied prefix; any body encountered after open space
        // still interrupts it. This keeps the hand's fan visible without
        // removing body occlusion or changing the bounded ray march.
        var leavingSource=occupied(x,y);
        for(var j=1;j<=48;j++){var u=x+dx*t*j/48,v=y+dy*t*j/48,on=occupied(u,v);
          if(leavingSource){if(!on)leavingSource=false;continue;}
          if(on){clipped++;return[u,v];}
        }
      }return[x+dx*t,y+dy*t];}
    function crystal(x,y,angle,alpha){
      ctx.save();ctx.translate(x,y);ctx.rotate(angle*.24);ctx.globalAlpha=alpha;
      var r=36,pts=[[0,-r],[r*.77,-r*.25],[r*.58,r*.69],[-r*.58,r*.69],[-r*.77,-r*.25]];
      var g=ctx.createLinearGradient(-35,-25,35,35);g.addColorStop(0,'rgba(210,248,255,.58)');g.addColorStop(.48,'rgba(29,70,102,.6)');g.addColorStop(1,'rgba(228,151,106,.5)');ctx.fillStyle=g;ctx.strokeStyle='rgba(215,248,252,.95)';ctx.lineWidth=1.25;ctx.beginPath();pts.forEach(function(p,i){if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);});ctx.closePath();ctx.fill();ctx.stroke();
      ctx.strokeStyle='rgba(135,214,234,.55)';ctx.lineWidth=.75;ctx.beginPath();pts.forEach(function(p){ctx.moveTo(0,0);ctx.lineTo(p[0],p[1]);});ctx.moveTo(pts[1][0],pts[1][1]);ctx.lineTo(pts[4][0],pts[4][1]);ctx.stroke();ctx.fillStyle='#efffff';ctx.beginPath();ctx.arc(0,-r,2.6,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    function render(){
      ctx.setTransform(size[0]/1280,0,0,size[1]/800,0,0);var bg=ctx.createRadialGradient(630,400,20,630,400,760);bg.addColorStop(0,'#112233');bg.addColorStop(1,'#040810');ctx.fillStyle=bg;ctx.fillRect(0,0,1280,800);
      // Quiet optical bench: thin construction arcs, a horizon and dust motes.
      ctx.strokeStyle='rgba(116,161,184,.1)';ctx.lineWidth=.7;ctx.beginPath();[180,300,420].forEach(function(r){ctx.moveTo(640+r,400);ctx.arc(640,400,r,0,Math.PI*2);});ctx.stroke();
      for(var i=0;i<76;i++){var x=(i*.618034%1)*1280,y=(i*.414214%1)*800;ctx.fillStyle='rgba(171,214,226,'+(.1+.13*Math.sin(i+time*.3)**2)+')';ctx.fillRect(x,y,1.3,1.3);}
      rays.forEach(function(r){var hue=(r.hue+settings.hue)%360;ctx.beginPath();ctx.moveTo(r.x,r.y);ctx.lineTo(r.ex,r.ey);ctx.strokeStyle='hsla('+hue+',93%,67%,'+(.08*r.alpha)+')';ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle='hsla('+hue+',90%,73%,'+(.63*r.alpha)+')';ctx.lineWidth=1.15;ctx.stroke();
        ctx.fillStyle='hsla('+hue+',94%,81%,'+r.alpha*.6+')';ctx.beginPath();ctx.arc(r.ex,r.ey,2,0,Math.PI*2);ctx.fill();});
      crossings.forEach(function(p,i){var R=20+14*Math.sin(time*.7+i)**2;ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(time*.12);ctx.strokeStyle='hsla('+((34+settings.hue)%360)+',83%,78%,.65)';ctx.lineWidth=.8;ctx.beginPath();for(var j=0;j<=150;j++){var a=j/150*Math.PI*2,r=R*(.76+.24*Math.cos(6*a));if(j)ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);else ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.stroke();ctx.beginPath();ctx.arc(0,0,R*.34,0,Math.PI*2);ctx.stroke();ctx.restore();});
      tracks.forEach(function(p){ctx.strokeStyle='rgba(234,208,158,'+p.energy*.27+')';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(45,p.y*800+50);ctx.lineTo(p.x*1280,p.y*800);ctx.stroke();crystal(p.x*1280,p.y*800,p.angle,p.energy);});
      if(body.fresh){ctx.fillStyle='rgba(136,211,230,.45)';for(var y=1;y<body.h-1;y+=2)for(var x=1;x<body.w-1;x+=2){var k=y*body.w+x;if(body.mask[k]>.45&&body.sdf[k]>-1.6){var p=kit.toScreen((x+.5)*4,(y+.5)*4);if(p&&valid(p[0],p[1]))ctx.fillRect(p[0]*1280,p[1]*800,1.7,1.7);}}}
    }
    function frame(dt,now){if(dead)return;var at=performance.now();dt=clamp(Number.isFinite(dt)?dt:0,0,.06);time+=dt;frames++;body.update(dt,now);last=input.read();bodyCount=body.fresh?body.people.length:0;
      var room=kit.room?kit.room(dt):{presence:0,x:0};
      var positions=last.slice();if(!positions.length&&body.fresh)body.people.slice(0,3).forEach(function(p){var s=kit.toScreen(p.cx*512,p.cy*424);if(s&&valid(s[0],s[1]))positions.push([s[0],clamp(s[1]-.12,.15,.85)]);});
      var idle=!positions.length&&!bodyCount;
      if(idle&&tracks.every(function(p){return p.idle||p.energy<.025;}))positions=[[.34+.018*Math.sin(time*.22),.53],[.7,.4+.022*Math.sin(time*.17)]];
      tracks.forEach(function(p){p.used=false;});
      positions.forEach(function(p){var old=null,dist=.22;tracks.forEach(function(t){var d=Math.hypot(t.x-p[0],t.y-p[1]);if(!t.used&&d<dist){old=t;dist=d;}});
        if(!old){old={id:nextId++,x:p[0],y:p[1],energy:0,angle:0};tracks.push(old);}old.used=true;old.idle=idle;
        old.x+=(p[0]-old.x)*(1-Math.exp(-dt*18));old.y+=(p[1]-old.y)*(1-Math.exp(-dt*18));old.energy+=(1-old.energy)*(1-Math.exp(-dt*8));});
      tracks.forEach(function(p){if(!p.used)p.energy*=Math.exp(-dt/settings.linger);});tracks=tracks.filter(function(p){return p.energy>.025;}).sort(function(a,b){return Number(b.used)-Number(a.used)||b.energy-a.energy;}).slice(0,4);
      rays=[];crossings=[];clipped=0;var active=tracks.filter(function(p){return p.used;}),pair=active.length>=2;
      tracks.forEach(function(p,index){var target=pair?[((active[0].x+active[1].x)*.5)*1280,Math.max(110,Math.min(active[0].y,active[1].y)*800-145)]:[p.x<.5?1170:110,200+(1-p.y)*220];
        target[0]+=(640+room.x*520-target[0])*room.presence;
        target[1]+=(155-target[1])*room.presence;
        p.angle=Math.atan2(target[1]-p.y*800,target[0]-p.x*1280);var n=Math.round(settings.rays),spread=.13+settings.spread*.008;
        for(var j=0;j<n;j++){var a=p.angle+(j/(n-1)-.5)*spread,end=endRay(p.x*1280,p.y*800,Math.cos(a),Math.sin(a));rays.push({x:p.x*1280,y:p.y*800,ex:end[0],ey:end[1],hue:185-j/(n-1)*150,alpha:p.energy,owner:p.id,center:j===(n>>1)});}});
      if(pair){var a=rays.filter(function(r){return r.owner===active[0].id;}),b=rays.filter(function(r){return r.owner===active[1].id;});var hit=intersect(a[a.length>>1],b[b.length>>1]);if(hit)crossings.push(hit);}
      render();frameMs=performance.now()-at;
    }
    function resize(w,h){if(dead||!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return;size=[w,h];}
    function set(opts){if(opts)Object.keys(settings).forEach(function(k){var v=opts[k];if(Number.isFinite(v))settings[k]=k==='rays'?Math.round(clamp(v,3,15)):clamp(v,k==='linger'?.2:0,k==='hue'?360:k==='linger'?4:100);});return Object.assign({},settings);}
    function wake(x,y){if(!dead)input.wake(x,y);}
    function destroy(){if(dead)return;dead=true;tracks=[];rays=[];crossings=[];input.clear();last=[];kit.wantDepth(false);if(window.PrismpathsSet===set)delete window.PrismpathsSet;if(window.PrismpathsWake===wake)delete window.PrismpathsWake;}
    resize(canvas.width,canvas.height);window.PrismpathsSet=set;window.PrismpathsWake=wake;set(window._prismpathsFx);kit.wantDepth(true);
    var out={frame:frame,touch:function(t){if(t)wake(t.x,t.y);},resize:resize,destroy:destroy};
    if(window.WallTest)out.debug=function(){return{frames:frames,finite:rays.every(function(r){return [r.x,r.y,r.ex,r.ey].every(Number.isFinite);}),contacts:last.map(function(p){return p.slice();}),prisms:tracks.map(function(p){return{id:p.id,x:p.x,y:p.y,energy:p.energy,idle:p.idle};}),rays:rays.length,endpoints:rays.map(function(r){return[r.ex,r.ey];}),crossings:crossings.map(function(p){return p.slice();}),clipped:clipped,bodyCount:bodyCount,wakeCount:input.size(),frameMs:frameMs,settings:set(),destroyed:dead};};return out;
  }
})();
