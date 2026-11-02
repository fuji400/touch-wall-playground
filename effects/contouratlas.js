/* Contour Atlas — private study, 2026-10-10. Bodies raise islands; hands
   build terraced peaks, and two contacts join the terrain with a saddle.
   Bounded 81x51 height field, marching-square contours; no sockets or assets. */
(function(){'use strict';
  registerWallPlugin({id:'contouratlas',title:'Contour Atlas',author:'Codex',create:create});

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
    var ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Contour Atlas needs Canvas 2D');
    var body=WallBody.create(kit,{}), input=contacts(kit), dead=false, time=0, frames=0, mapAt=-1e9;
    var C=81,R=51,N=C*R, base=new Float32Array(N), field=new Float32Array(N), raised=new Float32Array(N), map=new Int32Array(N).fill(-1);
    var settings={relief:55,tide:35,settle:5,hue:0}, last=[], saddle=0, bodyCells=0, segments=0, frameMs=0;
    var size=[1280,800], seeds=[[.26,.39,.24,.26,.56],[.58,.57,.3,.29,.62],[.79,.3,.17,.2,.41],[.14,.79,.24,.19,.24]];
    for(var y=0;y<R;y++)for(var x=0;x<C;x++){var u=x/(C-1),v=y/(R-1),z=.055;
      seeds.forEach(function(p){var a=(u-p[0])/p[2],b=(v-p[1])/p[3];z+=p[4]*Math.exp(-(a*a+b*b)*1.3);});
      z+=.034*Math.sin(u*24+Math.sin(v*10)*2)+.021*Math.cos(v*31-u*11)+.01*Math.sin(u*65+v*43);
      base[y*C+x]=field[y*C+x]=Math.max(.01,z);
    }
    var fog=document.createElement('canvas');fog.width=C;fog.height=R;var fc=fog.getContext('2d'),pixels=fc.createImageData(C,R);
    function remap(now){if(now-mapAt<1500)return;mapAt=now;for(var y=0;y<R;y++)for(var x=0;x<C;x++){
      var p=kit.fromScreen(x/(C-1),y/(R-1));map[y*C+x]=p&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=0&&p[0]<512&&p[1]>=0&&p[1]<424?Math.floor(p[1]/4)*body.w+Math.floor(p[0]/4):-1;
    }}
    function render(){
      var W=size[0],H=size[1];ctx.setTransform(W/1280,0,0,H/800,0,0);
      var bg=ctx.createRadialGradient(640,360,20,640,360,780);bg.addColorStop(0,'#102b38');bg.addColorStop(1,'#050b1d');ctx.fillStyle=bg;ctx.fillRect(0,0,1280,800);
      var tide=.13+settings.tide*.0032+.008*Math.sin(time*.22), hue=settings.hue;
      for(var i=0;i<N;i++){var z=field[i],dry=clamp((z-tide)*2,0,1),p=i*4;pixels.data[p]=16+dry*90;pixels.data[p+1]=40+dry*44;pixels.data[p+2]=55+dry*5;pixels.data[p+3]=85;}
      fc.putImageData(pixels,0,0);ctx.globalAlpha=.48;ctx.drawImage(fog,0,0,1280,800);ctx.globalAlpha=1;
      segments=0;
      for(var l=0;l<12;l++){
        var level=tide+l*.076,major=l%3===0;ctx.beginPath();
        for(var y=0;y<R-1;y++)for(var x=0;x<C-1;x++){
          var k=y*C+x,a=field[k],b=field[k+1],c=field[k+C+1],d=field[k+C],edges=[];
          if((a>=level)!==(b>=level))edges.push([x+(level-a)/(b-a),y]);
          if((b>=level)!==(c>=level))edges.push([x+1,y+(level-b)/(c-b)]);
          if((c>=level)!==(d>=level))edges.push([x+(level-d)/(c-d),y+1]);
          if((d>=level)!==(a>=level))edges.push([x,y+(level-a)/(d-a)]);
          for(var e=0;e+1<edges.length;e+=2){ctx.moveTo(edges[e][0]*16,edges[e][1]*16);ctx.lineTo(edges[e+1][0]*16,edges[e+1][1]*16);segments++;}
        }
        ctx.strokeStyle=l===0?'hsla('+((174+hue)%360)+',67%,68%,.94)':'hsla('+((29+hue+l*.6)%360)+',64%,'+(major?77:63)+'%,'+(major?.92:.64)+')';
        ctx.lineWidth=l===0?2.2:major?1.7:1.05;ctx.stroke();
      }
      // Small glints make the contours readable without turning idle into an attract movie.
      ctx.strokeStyle='rgba(124,205,205,.24)';ctx.lineWidth=.7;
      for(var j=0;j<46;j++){var u=(j*.6180339887)%1,v=(j*.41421356)%1,x=64+u*1152,y=55+v*690;ctx.beginPath();ctx.moveTo(x-2,y);ctx.lineTo(x+2,y);ctx.moveTo(x,y-2);ctx.lineTo(x,y+2);ctx.stroke();}
      last.forEach(function(p){var x=p[0]*1280,y=p[1]*800;ctx.strokeStyle='hsla('+((173+hue)%360)+',90%,79%,.85)';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(x,y,7+Math.sin(time*2)*1.3,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fillStyle='#e4fff0';ctx.fill();});
      var vignette=ctx.createRadialGradient(640,400,240,640,400,780);vignette.addColorStop(0,'rgba(3,5,15,0)');vignette.addColorStop(1,'rgba(3,5,15,.67)');ctx.fillStyle=vignette;ctx.fillRect(0,0,1280,800);
    }
    function frame(dt,now){if(dead)return;var at=performance.now();dt=clamp(Number.isFinite(dt)?dt:0,0,.06);time+=dt;frames++;body.update(dt,now);remap(now);last=input.read();saddle=0;bodyCells=0;
      var room=kit.room?kit.room(dt):{presence:0,x:0};
      var decay=Math.exp(-dt/settings.settle),ease=1-Math.exp(-dt*9),amount=.3+settings.relief*.011;
      for(var y=0;y<R;y++)for(var x=0;x<C;x++){var k=y*C+x,u=x/(C-1),v=y/(R-1),z=0;
        for(var j=0;j<last.length;j++){var dx=(u-last[j][0])*1.6,dy=v-last[j][1];z+=amount*Math.exp(-(dx*dx+dy*dy)/.0068);}
        if(last.length>1){var a=last[0],b=last[1],dx=(b[0]-a[0])*1.6,dy=b[1]-a[1],len=dx*dx+dy*dy;
          if(len>.006){var t=clamp(((u-a[0])*1.6*dx+(v-a[1])*dy)/len,0,1),ex=(u-a[0])*1.6-dx*t,ey=v-a[1]-dy*t;var bridge=amount*.58*Math.exp(-(ex*ex+ey*ey)/.003)*Math.sin(Math.PI*t);z+=bridge;saddle=Math.max(saddle,bridge);}}
        raised[k]=Math.max(raised[k]*decay,z*(1-Math.exp(-dt*7))+raised[k]*Math.exp(-dt*7));
        var bi=map[k],bm=body.fresh&&bi>=0?body.mask[bi]:0;if(bm>.3)bodyCells++;
        var island=room.presence*.75*Math.exp(-(((u-(.5+room.x*.32))*1.6)**2+(v-.6)**2)/.065);
        var target=base[k]+raised[k]+island+bm*(.2+clamp(bi>=0?body.gap[bi]/1200:0,0,.7))*amount;
        field[k]+= (clamp(target,.005,2.3)-field[k])*ease;
      }
      render();frameMs=performance.now()-at;
    }
    function resize(w,h){if(dead||!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return;size=[w,h];}
    function set(opts){if(opts)Object.keys(settings).forEach(function(k){var v=opts[k];if(Number.isFinite(v))settings[k]=clamp(v,k==='settle'?1:0,k==='hue'?360:k==='settle'?12:100);});return Object.assign({},settings);}
    function wake(x,y){if(!dead)input.wake(x,y);}
    function destroy(){if(dead)return;dead=true;input.clear();last=[];kit.wantDepth(false);if(window.ContouratlasSet===set)delete window.ContouratlasSet;if(window.ContouratlasWake===wake)delete window.ContouratlasWake;fog.width=fog.height=1;}
    resize(canvas.width,canvas.height);window.ContouratlasSet=set;window.ContouratlasWake=wake;set(window._contouratlasFx);kit.wantDepth(true);
    var out={frame:frame,touch:function(t){if(t)wake(t.x,t.y);},resize:resize,destroy:destroy};
    if(window.WallTest)out.debug=function(){var max=0,finite=true;for(var i=0;i<N;i++){max=Math.max(max,raised[i]);if(!Number.isFinite(field[i]))finite=false;}return{frames:frames,finite:finite,peak:max,saddle:saddle,bodyCells:bodyCells,contacts:last.map(function(p){return p.slice();}),wakeCount:input.size(),segments:segments,frameMs:frameMs,settings:set(),destroyed:dead,sample:function(x,y){return field[Math.round(y*(R-1))*C+Math.round(x*(C-1))];}};};
    return out;
  }
})();
