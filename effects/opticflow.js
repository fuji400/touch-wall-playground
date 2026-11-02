/* Optic Flow: one plugin, three versions you can switch between with the Version knob (Optic Flow tune panel). (2026-10-09)
 *   1 Original: perspective passages steered gently by fingertips on the wall. No depth camera.
 *   2 Body:     you fly the passage with your body: the person in front steers, moving speeds up, stepping closer zooms in,
 *               a touch sends a ring down the tunnel. This is the ONLY version that uses the depth camera.
 *   3 Touch:    touch-first: a tap makes it faster and sends a ripple of light, holding bends the far end toward your hand,
 *               two hands turning twist the tunnel. No depth camera. (Default.)
 * The three passages stay Facet Tunnel, Maze Passage and Helix. Speed, Depth, Intensity, Pause and Reduced motion are shared by all
 * three versions and survive a switch. A version change made through window.OpticflowSet({version:n}) takes effect at the start of
 * the next frame (the old version is destroyed, the new one created); the depth stream is on only while version 2 runs.
 * Each version's code below is the reviewed file of that version, wrapped as a factory; this wrapper owns window.OpticflowSet.
 */
(function () {
  'use strict';
  var DEFAULT_VERSION = 3;
  var MUS = {gain: 1, wide: 1};   // music (set by the switch below each frame): bass brightens and thickens the stripes; 1 = unchanged
  var VERSION_NAMES = {1:'Original', 2:'Body', 3:'Touch'};
  // ==== version 1: Original ====
  var makeV1 = (function () {
  var defaults = {speed: 0.35, depth: 26, intensity: 0.65, pause: 0, reduced: 0};
  var ranges = {speed:[0,1], depth:[12,40], intensity:[0.15,1], pause:[0,1], reduced:[0,1]};
    return function (canvas, kit, mode, cfgIn) {
      var g=canvas.getContext('2d'), cfg=Object.assign({},defaults), t=0, travel=0, cx=0,cy=0, alive=true;
      var media=window.matchMedia('(prefers-reduced-motion: reduce)');
      function set(values) { Object.keys(ranges).forEach(function(k) {
        var raw=values && values[k], n=Number(raw); if(raw!==null && raw!==undefined && Number.isFinite(n)) cfg[k]=Math.max(ranges[k][0],Math.min(ranges[k][1],n));
      }); }
      set(cfgIn);   // shared settings from the switch wrapper
      function point(z,a) {
        var square=mode===1, radius=square?1/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a))):1;
        if(mode===0) { var morph=.35+.3*Math.sin(t*.15+z*.08);radius=1+morph*(1/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)))-1); }
        var twist=mode===2?z*0.085+travel*0.045:mode===0?0.13*Math.sin(z*.15+t*.08):0;
        var bend=(mode===1?0.65:0.25), wx=bend*Math.sin((z+travel)*.095), wy=bend*.42*Math.sin((z+travel)*.13);
        var x=Math.cos(a)*radius,y=Math.sin(a)*radius;
        var X=x*Math.cos(twist)-y*Math.sin(twist)+wx-cx,Y=x*Math.sin(twist)+y*Math.cos(twist)+wy-cy;
        var f=Math.min(canvas.width,canvas.height)*1.5/(z+0.8);
        return [canvas.width/2+X*f,canvas.height/2+Y*f];
      }
      function line(a,b,alpha,width) {g.strokeStyle='rgba(235,235,235,'+alpha+')';g.lineWidth=width;g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.stroke();}
      var inst={frame:function(dt) {
        if(!alive)return; dt=Number.isFinite(dt)?Math.max(0,Math.min(.05,dt)):0;
        var frozen=cfg.pause>=.5 || cfg.reduced>=.5 || media.matches;
        if(!frozen) {t+=dt*cfg.speed;travel+=dt*cfg.speed*2.2;}
        var tx=0,ty=0, fingers=kit.fingers;
        if(!frozen && fingers && Date.now()-fingers.t<250 && Array.isArray(fingers.pts)) {
          var valid=fingers.pts.filter(function(p){return Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;});
          if(valid.length) {tx=(valid.reduce(function(s,p){return s+p[0];},0)/valid.length-.5)*.42;ty=(valid.reduce(function(s,p){return s+p[1];},0)/valid.length-.5)*.3;}
        }
        if(!frozen) {cx+=(tx-cx)*(1-Math.exp(-dt*2));cy+=(ty-cy)*(1-Math.exp(-dt*2));}
        g.fillStyle='#060606';g.fillRect(0,0,canvas.width,canvas.height);
        var n=Math.round(cfg.depth),sides=mode===1?4:mode===0?8:24, offset=mode===1?Math.PI/4:0;
        var width=Math.max(1,Math.min(canvas.width,canvas.height)/700)*MUS.wide, phase=travel%1;
        // Fixed spatial spacing, continuously moving toward camera. Near/far fades hide recycling.
        for(var j=n;j>=0;j--) {
          var z=j+1-phase, fade=Math.min(1,Math.max(0,(z-.3)/1.2))*Math.pow(Math.max(0,1-z/(n+1)),.65);
          var alpha=Math.min(1,cfg.intensity*fade*.82*MUS.gain);
          for(var k=0;k<sides;k++) {
            var a=offset+k*Math.PI*2/sides,b=offset+(k+1)*Math.PI*2/sides;
            var p=point(z,a),q=point(z,b),r=point(z+1,a);
            var stroke=width*(mode===1?Math.max(1,18/(z+.8)):mode===0?Math.max(1,7/(z+.8)):1);
            line(p,q,alpha,stroke);line(p,r,alpha*.6,stroke*.8);
            if(mode!==2) for(var sub=1;sub<4;sub++) {
              var sa=a+(b-a)*sub/4;line(point(z,sa),point(z+1,sa),alpha*.65,stroke*.7);
            }
            if(mode===1 && (j+Math.floor(travel))%4===1 && k%2===1) {
              // Door jambs and receding side passage: scale with depth, never screen-space decals.
              var u=point(z,a+(b-a)*.3),v=point(z,a+(b-a)*.7),u2=point(z+1.5,a+(b-a)*.3),v2=point(z+1.5,a+(b-a)*.7);
              line(u,v,alpha*.9,width*1.5);line(u,u2,alpha,width);line(v,v2,alpha,width);line(u2,v2,alpha*.6,width);
            }
          }
        }
        // Dark central vanishing point and a restrained edge vignette, no flashing fills.
        var vignette=g.createRadialGradient(canvas.width/2,canvas.height/2,Math.min(canvas.width,canvas.height)*.2,canvas.width/2,canvas.height/2,Math.max(canvas.width,canvas.height)*.65);
        vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(0,0,0,.65)');g.fillStyle=vignette;g.fillRect(0,0,canvas.width,canvas.height);
      },resize:function(){},destroy:function(){alive=false;},inspect:function(){return {travel:travel,time:t,x:cx,y:cy,settings:Object.assign({},cfg),systemReduced:media.matches};}};
      inst.set=set;
      return inst;
    };
  })();

  // ==== version 2: Body ====
  var makeV2 = (function () {
  // ---- the numbers Billy can tweak (each reaction scale in one place)
  var STEER_TRANSLATE = 0.6;   // camera slide at full deflection, in tunnel radii
  var STEER_VP = 0.18;         // vanishing-point shift at full deflection, as a share of the screen width / height
  var HEAD_REST_Y = 0.25;      // fallback head height on the wall (0 top .. 1 bottom) when a person's own height is unknown
  var HEAD_REST_TAU = 3;       // s, 'straight ahead' head height follows the followed person's head this slowly (children stand lower)
  var STEER_GAIN_Y = 2.5;      // head height moves little, so up/down is boosted (head 0.4 off its rest height = full deflection)
  var HEAD_FRAC = 0.25;        // "head height" = top of the person + this share of their height
  var STEER_TAU = 0.3;         // s, body steering ease
  var FINGER_TAU = 0.12;       // s, fingertip steering ease (faster)
  var ROLL_MAX = 0.349;        // rad (20 degrees) of bank at full sideways steer
  var ROLL_TAU = 0.25;         // s
  var THROTTLE_MAX = 5;        // top speed, times the Speed knob
  var CRAWL = 0.35;            // speed when someone stands still
  var CRAWL_AFTER_S = 1.5;     // s of standing still before the crawl
  var MOVE_LOW = 0.04;         // person.moving at or below this counts as no motion
  var MOVE_HIGH = 0.5;         // ...and at or above this as full motion
  var THROTTLE_RISE_TAU = 0.25;// s, speeding up
  var THROTTLE_FALL_TAU = 1.5; // s, slowing down
  var ACCEL_MAX = 6;           // largest change of the speed multiplier per second (speed never snaps)
  var DIVE_MAX = 1.5;          // zoom when close to the wall
  var DIVE_TAU = 0.4;          // s
  var GAP_NEAR_MM = 350;       // person this far in front of the wall (or closer) = full dive (closest body in the recorded clips)
  var GAP_FAR_MM = 1100;       // this far or further = no dive
  var KICK_ADD = 1.5;          // touch speed kick, added to the multiplier
  var KICK_S = 0.6;            // s the kick lasts
  var RING_SPEED = 16;         // tunnel units per second a touch ring races away
  var RING_MAX = 6;            // rings alive at once
  var RING_ALPHA = 0.9;        // ring brightness at birth (times a share of the Intensity knob)
  var ALPHA_CAP = 0.92;        // no line is ever brighter than this
  var ALPHA_SPEED_GAIN = 0.35; // alpha x (0.8 + this x speed share)
  var WIDTH_SPEED_GAIN = 0.5;  // stroke x (1 + this x speed share)

  var defaults = {speed: 0.35, depth: 26, intensity: 0.65, pause: 0, reduced: 0};
  var ranges = {speed:[0,1], depth:[12,40], intensity:[0.15,1], pause:[0,1], reduced:[0,1]};
  function fin(x) { return typeof x === 'number' && Number.isFinite(x); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
    return function (canvas, kit, mode, cfgIn) {
      var g=canvas.getContext('2d'), cfg=Object.assign({},defaults), t=0, travel=0, alive=true;
      var sx=0, sy=0, roll=0, thr=1, kick=0, kickLeft=0, dive=1, rings=[], rest=null, restId=null, resets=0, goodTravel=0, goodT=0, followId=null, lastPeople=0, lastFingers=false;
      var media=window.matchMedia('(prefers-reduced-motion: reduce)');
      var body=null;
      try { if(window.WallBody) { body=WallBody.create(kit,{}); kit.wantDepth(true); } } catch(e) { body=null; }
      function set(values) { Object.keys(ranges).forEach(function(k) {
        var raw=values && values[k], n=Number(raw); if(raw!==null && raw!==undefined && Number.isFinite(n)) cfg[k]=Math.max(ranges[k][0],Math.min(ranges[k][1],n));
      }); }
      set(cfgIn);   // shared settings from the switch wrapper
      var cam={x:0,y:0,ox:0,oy:0,f:1,dive:1};   // this frame's camera: slide (tunnel radii), vanishing-point offset (px), focal base
      function point(z,a) {
        var square=mode===1, radius=square?1/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a))):1;
        if(mode===0) { var morph=.35+.3*Math.sin(t*.15+z*.08);radius=1+morph*(1/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)))-1); }
        var twist=mode===2?z*0.085+travel*0.045:mode===0?0.13*Math.sin(z*.15+t*.08):0;
        var bend=(mode===1?0.65:0.25), wx=bend*Math.sin((z+travel)*.095), wy=bend*.42*Math.sin((z+travel)*.13);
        var x=Math.cos(a)*radius,y=Math.sin(a)*radius;
        var X=x*Math.cos(twist)-y*Math.sin(twist)+wx-cam.x,Y=x*Math.sin(twist)+y*Math.cos(twist)+wy-cam.y;
        var f=cam.f*cam.dive/(z+0.8);
        return [canvas.width/2+cam.ox+X*f,canvas.height/2+cam.oy+Y*f];
      }
      function line(a,b,alpha,width) {g.strokeStyle='rgba(235,235,235,'+alpha+')';g.lineWidth=width;g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.stroke();}
      function ease(cur,target,dt,tau) { return cur+(target-cur)*(1-Math.exp(-dt/tau)); }
      // the person we follow: the biggest; keep the same id while they are there
      function pickPerson() {
        var list=body && body.people, best=null, i;
        lastPeople=list?list.length:0;
        if(!list || !list.length) { followId=null; return null; }
        for(i=0;i<list.length;i++) if(list[i].id===followId) return list[i];
        for(i=0;i<list.length;i++) if(!best || list[i].area>best.area) best=list[i];
        followId=best?best.id:null; return best;
      }
      function fingerTarget() {
        var fingers=kit.fingers;
        if(fingers && fin(fingers.t) && Date.now()-fingers.t<250 && Array.isArray(fingers.pts)) {
          var valid=fingers.pts.filter(function(p){return Array.isArray(p)&&fin(p[0])&&fin(p[1])&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;});
          if(valid.length) return [(valid.reduce(function(s,p){return s+p[0];},0)/valid.length-.5)*2,(valid.reduce(function(s,p){return s+p[1];},0)/valid.length-.5)*2];
        }
        return null;
      }
      function bodyTarget(p) {
        if(!p || !fin(p.cx) || !fin(p.cy) || !fin(p.top) || !fin(p.bottom)) return null;
        var c=kit.toScreen(p.cx*512,p.cy*424), h=kit.toScreen(p.cx*512,(p.top+(p.bottom-p.top)*HEAD_FRAC)*424);
        if(!c || !h || !fin(c[0]) || !fin(h[1])) return null;
        return [clamp((c[0]-.5)*2,-1,1), h[1]];   // x steer, head height on the wall
      }
      function reset() { // last line of defence: one bad number must never stick
        if((rest!==null&&!fin(rest))||!fin(sx)||!fin(sy)||!fin(roll)||!fin(thr)||!fin(kick)||!fin(kickLeft)||!fin(dive)||!fin(travel)||!fin(t)||rings.some(function(r){return !fin(r.z)||!fin(r.age);})) {
          resets++;
          if(rest!==null&&!fin(rest)){rest=null;restId=null;}
          if(!fin(sx))sx=0; if(!fin(sy))sy=0; if(!fin(roll))roll=0; if(!fin(thr))thr=1; if(!fin(kick))kick=0; if(!fin(kickLeft))kickLeft=0; if(!fin(dive))dive=1;
          if(!fin(travel))travel=goodTravel; if(!fin(t))t=goodT;
          rings=rings.filter(function(r){return fin(r.z)&&fin(r.age);});
        } else { goodTravel=travel; goodT=t; }
      }
      function speedMul() { return thr+kick; }
      function speedShare() { return clamp((speedMul()-1)/(THROTTLE_MAX-1),0,1); }
      var inst={frame:function(dt,now) {
        if(!alive)return; dt=fin(dt)?Math.max(0,Math.min(.05,dt)):0;
        if(!fin(now)) now=performance.now();
        if(body) { try { body.update(dt,now); } catch(e) {} }
        var frozen=cfg.pause>=.5 || cfg.reduced>=.5 || media.matches;
        if(!frozen && dt>0) {
          var p=pickPerson(), fing=fingerTarget(), bt=bodyTarget(p), bx=null;
          var room = kit.room ? kit.room(dt, frozen) : {enabled:false};
          lastFingers=!!fing;
          // steering: fingers override the body; nobody = back to centre
          // head rest height: starts at this person's own head, then follows it slowly (a child stands lower than an adult)
          if(!p) { rest=null; restId=null; }
          else if(restId!==followId || !fin(rest)) { rest=bt&&fin(bt[1])?bt[1]:HEAD_REST_Y; restId=followId; }
          else if(bt&&fin(bt[1])) rest=ease(rest,bt[1],dt,HEAD_REST_TAU);
          if(bt&&fin(rest)) bx=[bt[0],clamp((bt[1]-rest)*STEER_GAIN_Y,-1,1)];
          var tgt=room.enabled?[room.x,0]:(fing||bx||[0,0]), tau=room.enabled?STEER_TAU:(fing?FINGER_TAU:STEER_TAU);
          sx=ease(sx,tgt[0],dt,tau); sy=ease(sy,tgt[1],dt,tau);
          roll=ease(roll,-sx*ROLL_MAX,dt,ROLL_TAU);
          // throttle: movement of the followed person; still = crawl; nobody = cruise
          var want=1;
          if(room.enabled) want=1+3*room.motion;
          else if(p) {
            var still=fin(p.still)?p.still:0, mv=fin(p.moving)?p.moving:0;
            want=still>CRAWL_AFTER_S ? CRAWL : 1+(THROTTLE_MAX-1)*clamp((mv-MOVE_LOW)/(MOVE_HIGH-MOVE_LOW),0,1);
          }
          var next=ease(thr,want,dt,want>thr?THROTTLE_RISE_TAU:THROTTLE_FALL_TAU), lim=ACCEL_MAX*dt;
          thr=clamp(thr+clamp(next-thr,-lim,lim),CRAWL,THROTTLE_MAX);
          // touch kick: a smooth bump, no snap
          if(kickLeft>0) { kickLeft=Math.max(0,kickLeft-dt); kick=KICK_ADD*Math.sin(Math.PI*(1-kickLeft/KICK_S)); } else kick=0;
          // dive: closer to the wall = bigger
          var gap=p&&fin(p.gap)?p.gap:(body&&fin(body.meanGap)&&p?body.meanGap:NaN), dtg=1;
          if(!room.enabled && fin(gap)) dtg=1+(DIVE_MAX-1)*clamp((GAP_FAR_MM-gap)/(GAP_FAR_MM-GAP_NEAR_MM),0,1);
          dive=ease(dive,dtg,dt,DIVE_TAU);
          // travel
          var sp=speedMul();
          t+=dt*cfg.speed; travel+=dt*cfg.speed*2.2*sp;
          // touch rings race away
          for(var i=rings.length-1;i>=0;i--) { rings[i].age+=dt; rings[i].z+=RING_SPEED*dt; if(rings[i].z>cfg.depth+1) rings.splice(i,1); }
          reset();
        }
        var W=canvas.width, H=canvas.height, share=speedShare();
        cam.x=sx*STEER_TRANSLATE; cam.y=sy*STEER_TRANSLATE; cam.ox=sx*STEER_VP*W; cam.oy=sy*STEER_VP*H;
        cam.f=Math.min(W,H)*1.5; cam.dive=dive;
        g.fillStyle='#060606';g.fillRect(0,0,W,H);
        g.save(); g.translate(W/2+cam.ox,H/2+cam.oy); g.rotate(roll); g.translate(-(W/2+cam.ox),-(H/2+cam.oy));
        var n=Math.round(cfg.depth),sides=mode===1?4:mode===0?8:24, offset=mode===1?Math.PI/4:0;
        var width=Math.max(1,Math.min(W,H)/700)*(1+WIDTH_SPEED_GAIN*share)*MUS.wide, phase=travel%1, aMul=0.8+ALPHA_SPEED_GAIN*share;
        // Fixed spatial spacing, continuously moving toward camera. Near/far fades hide recycling.
        for(var j=n;j>=0;j--) {
          var z=j+1-phase, fade=Math.min(1,Math.max(0,(z-.3)/1.2))*Math.pow(Math.max(0,1-z/(n+1)),.65);
          var alpha=Math.min(1,Math.min(ALPHA_CAP,cfg.intensity*fade*.82*aMul)*MUS.gain);
          for(var k=0;k<sides;k++) {
            var a=offset+k*Math.PI*2/sides,b=offset+(k+1)*Math.PI*2/sides;
            var p0=point(z,a),q=point(z,b),r=point(z+1,a);
            var stroke=width*(mode===1?Math.max(1,18/(z+.8)):mode===0?Math.max(1,7/(z+.8)):1);
            line(p0,q,alpha,stroke);line(p0,r,alpha*.6,stroke*.8);
            if(mode!==2) for(var sub=1;sub<4;sub++) {
              var sa=a+(b-a)*sub/4;line(point(z,sa),point(z+1,sa),alpha*.65,stroke*.7);
            }
            if(mode===1 && (j+Math.floor(travel))%4===1 && k%2===1) {
              // Door jambs and receding side passage: scale with depth, never screen-space decals.
              var u=point(z,a+(b-a)*.3),vv=point(z,a+(b-a)*.7),u2=point(z+1.5,a+(b-a)*.3),v2=point(z+1.5,a+(b-a)*.7);
              line(u,vv,alpha*.9,width*1.5);line(u,u2,alpha,width);line(vv,v2,alpha,width);line(u2,v2,alpha*.6,width);
            }
          }
        }
        // touch rings: a bright loop that starts near you and races away
        for(var ri=0;ri<rings.length;ri++) {
          var rg=rings[ri], rz=rg.z, rf=Math.min(1,rg.age/.12)*Math.pow(Math.max(0,1-rz/(n+1)),1.2);
          var ra=Math.min(ALPHA_CAP,RING_ALPHA*(0.75+0.25*cfg.intensity)*rf);
          if(ra<.01) continue;
          for(var rk=0;rk<sides;rk++) {
            var ra0=offset+rk*Math.PI*2/sides,ra1=offset+(rk+1)*Math.PI*2/sides;
            line(point(rz,ra0),point(rz,ra1),ra,width*3.4);
          }
        }
        g.restore();
        // Dark central vanishing point and a restrained edge vignette, no flashing fills.
        var vignette=g.createRadialGradient(W/2,H/2,Math.min(W,H)*.2,W/2,H/2,Math.max(W,H)*.65);
        vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(0,0,0,.65)');g.fillStyle=vignette;g.fillRect(0,0,W,H);
      },
      touch:function(e) {
        if(!alive || !e || !e.first) return;
        if(cfg.pause>=.5 || cfg.reduced>=.5 || media.matches) return;
        rings.push({z:0.5,age:0}); while(rings.length>RING_MAX) rings.shift();
        if(kickLeft>0) { var kp=1-kickLeft/KICK_S; if(kp>0.5) kickLeft=KICK_S*kp; } else kickLeft=KICK_S;   // mid-kick: rise again from the same height, no jump
      },
      resize:function(){},
      destroy:function(){
        if(!alive) return; alive=false;
        if(body) { try { kit.wantDepth(false); } catch(e) {} body=null; }
        rings=[];
        
      },
      inspect:function(){
        var W=canvas.width, H=canvas.height, fin_=[sx,sy,roll,thr,kick,kickLeft,dive,travel,t].every(fin)&&(rest===null||fin(rest));
        return {travel:travel,time:t,x:cam.x,y:cam.y,settings:Object.assign({},cfg),systemReduced:media.matches,
          body:!!body,present:!!(body&&body.present),followId:followId,people:lastPeople,regOk:!!(body&&body.regOk),fingers:lastFingers,
          steerX:sx,steerY:sy,vpX:cam.ox,vpY:cam.oy,roll:roll,throttle:speedMul(),thr:thr,kick:kick,dive:dive,rings:rings.length,rest:rest,
          resets:resets,finite:fin_&&fin(cam.x)&&fin(cam.y)&&fin(cam.ox)&&fin(cam.oy),
          axisX4:cam.ox-cam.x*(Math.min(W,H)*1.5/4.8),axisY4:cam.oy-cam.y*(Math.min(W,H)*1.5/4.8)};}};
      inst.set=set;
      return inst;
    };
  })();

  // ==== version 3: Touch ====
  var makeV3 = (function () {
  // ---- the numbers Billy can tweak
  var HAND_CLUSTER = 0.1;      // fingertips closer than this (x screen width) are one hand
  var HAND_JUMP = 0.25;        // a hand can move this far (x width) between frames and stay the same hand
  var GRACE_S = 0.4;           // s a hand survives without any fingertip (the bridge flickers)
  var HOLD_MS = 250;           // ms a hand must stay before it steers (a quick tap does not move the centre)
  var TAP_KICK = 0.9;          // speed added by one tap
  var HELD_BOOST = 1.5;        // boost that settles while any hand is on the wall (1 + 1.5 = 2.5x)
  var BOOST_TAU = 2;           // s, boost easing toward its resting level
  var SPEED_MAX = 5;           // top speed, times the Speed knob
  var ACCEL_MAX = 8;           // largest change of the speed multiplier per second (speed never snaps)
  var TAP_DEDUPE_W = 0.08;     // two taps closer than this (x width) ...
  var TAP_DEDUPE_S = 0.3;      // ... and this many s apart are one tap
  var SAME_HAND_S = 0.3;       // a touch next to a hand older than this (or one that is moving) is the same hand, not a new tap
  var HAND_MOVE = 0.004;       // a hand that moved more than this (x width) in one report counts as moving
  var RIPPLE_SPEED = 0.9;      // ripple radius growth, screen widths per second
  var RIPPLE_LIFE = 1.4;       // s
  var RIPPLE_MAX = 8;          // ripples alive at once
  var RIPPLE_COLOR = '200,225,255';   // soft white-blue
  var RIPPLE_ALPHA = 0.8;      // light ring brightness at birth (times a share of the Intensity knob)
  var RIPPLE_ECHO = 0.6;       // the fainter echo ring rides at this share of the radius
  var RIPPLE_BAND = 0.04;      // wave thickness for lighting tunnel lines (x width)
  var RIPPLE_LINE_ALPHA = 0.75;// alpha added to a line at the crest of the wave
  var RIPPLE_LINE_WIDTH = 2;   // extra stroke (x) at the crest
  var HOLD_REACH = 0.9;        // how far the far end goes toward the hand (1 = all the way)
  var BEND_POW = 0.8;          // bend grows with depth as (z / depth) to this power
  var HOLD_TAU = 0.35;         // s, bend easing toward your hand
  var RETURN_TAU = 2.5;        // s, bend drifting back to the middle
  var HOLD_CLAMP = 0.08;       // the target stays this far inside every screen edge (share of width / height)
  var TWIST_MAX = 3.1416;      // rad, most the tunnel winds
  var TWIST_STEP_MAX = 0.3;    // rad, most one frame can add
  var TWIST_RETURN_TAU = 3;    // s, unwinding after you let go
  var SPIRAL_LAG = 0.7;        // the far end lags the near end by this share of the twist
  var ALPHA_CAP = 0.92;        // no line is ever brighter than this (ripple crests go to 1)
  var ALPHA_SPEED_GAIN = 0.35; // alpha x (0.8 + this x speed share)
  var WIDTH_SPEED_GAIN = 0.5;  // stroke x (1 + this x speed share)

  var defaults = {speed: 0.35, depth: 26, intensity: 0.65, pause: 0, reduced: 0};
  var ranges = {speed:[0,1], depth:[12,40], intensity:[0.15,1], pause:[0,1], reduced:[0,1]};
  function fin(x) { return typeof x === 'number' && Number.isFinite(x); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
    return function (canvas, kit, mode, cfgIn) {
      var g=canvas.getContext('2d'), cfg=Object.assign({},defaults), t=0, travel=0, clk=0, alive=true;
      var hands=[], nextHand=1, ripples=[], taps=0, lastTap=null;
      var bx=0, by=0, twist=0, lastAngle=null, boost=0, spd=1, tgt=null, held=false, resets=0, goodTravel=0, goodT=0, lastFresh=false, lastFt=0;
      var media=window.matchMedia('(prefers-reduced-motion: reduce)');
      function set(values) { Object.keys(ranges).forEach(function(k) {
        var raw=values && values[k], n=Number(raw); if(raw!==null && raw!==undefined && Number.isFinite(n)) cfg[k]=Math.max(ranges[k][0],Math.min(ranges[k][1],n));
      }); }
      set(cfgIn);   // shared settings from the switch wrapper
      function isFrozen() { return cfg.pause>=.5 || cfg.reduced>=.5 || media.matches; }
      var cam={n:26,ox:0,oy:0};   // this frame's depth and bend (px)
      function point(z,a) {
        var W=canvas.width, H=canvas.height, wz=Math.pow(clamp(z/(cam.n+1),0,1),BEND_POW);
        var square=mode===1, radius=square?1/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a))):1;
        if(mode===0) { var morph=.35+.3*Math.sin(t*.15+z*.08);radius=1+morph*(1/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)))-1); }
        var tw=(mode===2?z*0.085+travel*0.045:mode===0?0.13*Math.sin(z*.15+t*.08):0)+twist*(1-SPIRAL_LAG*wz);
        var bend=(mode===1?0.65:0.25), wx=bend*Math.sin((z+travel)*.095), wy=bend*.42*Math.sin((z+travel)*.13);
        var x=Math.cos(a)*radius,y=Math.sin(a)*radius;
        var X=x*Math.cos(tw)-y*Math.sin(tw)+wx,Y=x*Math.sin(tw)+y*Math.cos(tw)+wy;
        var f=Math.min(W,H)*1.5/(z+0.8);
        return [W/2+X*f+cam.ox*wz,H/2+Y*f+cam.oy*wz];
      }
      // a line, lit by any ripple wave passing over its middle
      function line(a,b,alpha,width) {
        var lit=0;
        if(ripples.length) {
          var mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2, W=canvas.width, band=RIPPLE_BAND*W;
          for(var i=0;i<ripples.length;i++) { var r=ripples[i], d=Math.hypot(mx-r.x,my-r.y), q=(d-RIPPLE_SPEED*W*r.age)/band;
            if(q<3&&q>-3) lit+=Math.exp(-q*q)*r.fade; }
          if(lit>1) lit=1;
        }
        if(lit>0.01) { alpha=Math.min(1,alpha+RIPPLE_LINE_ALPHA*lit); width*=1+RIPPLE_LINE_WIDTH*lit;
          g.strokeStyle='rgba('+Math.round(235-45*lit)+','+Math.round(235-10*lit)+',255,'+alpha+')'; }
        else g.strokeStyle='rgba(235,235,235,'+alpha+')';
        g.lineWidth=width;g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.stroke();
      }
      function ease(cur,target,dt,tau) { return cur+(target-cur)*(1-Math.exp(-dt/tau)); }
      function wrap(a) { while(a>Math.PI) a-=2*Math.PI; while(a<=-Math.PI) a+=2*Math.PI; return a; }
      // one tap: a ripple and a speed kick (the fingertip stream and touch events both report it; this folds them into one)
      function tap(x,y) {
        var W=canvas.width;
        if(lastTap && clk-lastTap.t<TAP_DEDUPE_S && Math.hypot(x-lastTap.x,y-lastTap.y)<TAP_DEDUPE_W*W) return false;
        lastTap={x:x,y:y,t:clk}; taps++;
        ripples.push({x:x,y:y,age:0,fade:1}); while(ripples.length>RIPPLE_MAX) ripples.shift();
        boost=Math.min(SPEED_MAX-1,boost+TAP_KICK);
        return true;
      }
      // turn this frame's fingertips into hands: cluster, then follow each hand by nearest centroid
      function updateHands(dt) {
        var W=canvas.width, H=canvas.height, pts=[], fingers=kit.fingers, i, j;
        lastFresh=!!(fingers && fin(fingers.t) && Date.now()-fingers.t<250 && Array.isArray(fingers.pts));
        var newData=lastFresh && fingers.t!==lastFt; if(lastFresh) lastFt=fingers.t;   // only a NEW report counts as seen (a stale re-read must not stretch a tap into a hold)
        if(newData) fingers.pts.forEach(function(p){ if(Array.isArray(p)&&fin(p[0])&&fin(p[1])&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1) pts.push([p[0]*W,p[1]*H]); });
        var cl=[];
        pts.forEach(function(p){ var best=null,bd=HAND_CLUSTER*W;
          cl.forEach(function(c){ var d=Math.hypot(p[0]-c.x,p[1]-c.y); if(d<bd){bd=d;best=c;} });
          if(best) { best.sx+=p[0]; best.sy+=p[1]; best.n++; best.x=best.sx/best.n; best.y=best.sy/best.n; }
          else cl.push({x:p[0],y:p[1],sx:p[0],sy:p[1],n:1});
        });
        if(!newData) { hands=hands.filter(function(h){ return clk-h.seen<=GRACE_S; }); return; }
        var pairs=[]; for(i=0;i<cl.length;i++) for(j=0;j<hands.length;j++) { var d=Math.hypot(cl[i].x-hands[j].x,cl[i].y-hands[j].y); if(d<HAND_JUMP*W) pairs.push([d,i,j]); }
        pairs.sort(function(a,b){return a[0]-b[0];});
        var usedC={}, usedH={};
        pairs.forEach(function(pr){ if(usedC[pr[1]]||usedH[pr[2]]) return; usedC[pr[1]]=usedH[pr[2]]=true;
          var h=hands[pr[2]]; h.px=h.x; h.py=h.y; h.x=cl[pr[1]].x; h.y=cl[pr[1]].y; h.seen=clk;
          if(Math.hypot(h.x-h.px,h.y-h.py)>HAND_MOVE*W) h.moved=clk; });
        for(i=0;i<cl.length;i++) if(!usedC[i] && hands.length<8) {
          var nh={id:nextHand++,x:cl[i].x,y:cl[i].y,px:cl[i].x,py:cl[i].y,born:clk,seen:clk,moved:clk}; hands.push(nh);
          tap(nh.x,nh.y);                                   // a hand arriving is a tap
        }
        hands.forEach(function(h){ if(h.seen===clk && clk-h.born>=HOLD_MS/1000) h.held=true; });   // down long enough (real fingertips, not grace)
        hands=hands.filter(function(h){ return clk-h.seen<=GRACE_S; });
      }
      function heldHands() { return hands.filter(function(h){ return h.held; }).sort(function(a,b){return a.id-b.id;}); }
      function speedShare() { return clamp((spd-1)/(SPEED_MAX-1),0,1); }
      function reset() { // last line of defence: one bad number must never stick
        var bad=!fin(bx)||!fin(by)||!fin(twist)||!fin(boost)||!fin(spd)||!fin(travel)||!fin(t)||!fin(clk)||(lastAngle!==null&&!fin(lastAngle))
          ||ripples.some(function(r){return !fin(r.x)||!fin(r.y)||!fin(r.age)||!fin(r.fade);})||hands.some(function(h){return !fin(h.x)||!fin(h.y)||!fin(h.born)||!fin(h.seen);});
        if(!bad) { goodTravel=travel; goodT=t; return; }
        resets++;
        if(!fin(bx))bx=0; if(!fin(by))by=0; if(!fin(twist))twist=0; if(!fin(boost))boost=0; if(!fin(spd))spd=1; if(!fin(clk))clk=0;
        if(!fin(travel))travel=goodTravel; if(!fin(t))t=goodT; if(lastAngle!==null&&!fin(lastAngle))lastAngle=null;
        ripples=ripples.filter(function(r){return fin(r.x)&&fin(r.y)&&fin(r.age)&&fin(r.fade);});
        hands=hands.filter(function(h){return fin(h.x)&&fin(h.y)&&fin(h.born)&&fin(h.seen);});
      }
      var inst={frame:function(dt) {
        if(!alive)return; dt=fin(dt)?Math.max(0,Math.min(.05,dt)):0;
        var W=canvas.width, H=canvas.height;
        if(!isFrozen() && dt>0) {
          clk+=dt;
          updateHands(dt);
          var hh=heldHands(), mid=null; held=hh.length>0;
          // hold: the far end of the tunnel goes toward the hand (two hands: their midpoint)
          if(hh.length>=2) mid=[(hh[0].x+hh[1].x)/2,(hh[0].y+hh[1].y)/2]; else if(hh.length===1) mid=[hh[0].x,hh[0].y];
          if(mid) { tgt=[clamp(mid[0],HOLD_CLAMP*W,(1-HOLD_CLAMP)*W),clamp(mid[1],HOLD_CLAMP*H,(1-HOLD_CLAMP)*H)];
            bx=ease(bx,(tgt[0]-W/2)*HOLD_REACH,dt,HOLD_TAU); by=ease(by,(tgt[1]-H/2)*HOLD_REACH,dt,HOLD_TAU); }
          else { tgt=null; bx=ease(bx,0,dt,RETURN_TAU); by=ease(by,0,dt,RETURN_TAU); }
          // twist: the angle between the two oldest held hands, unwrapped frame to frame
          if(hh.length>=2) {
            var ang=Math.atan2(hh[1].y-hh[0].y,hh[1].x-hh[0].x);
            if(lastAngle!==null) twist=clamp(twist+clamp(wrap(ang-lastAngle),-TWIST_STEP_MAX,TWIST_STEP_MAX),-TWIST_MAX,TWIST_MAX);
            lastAngle=ang;
          } else { lastAngle=null; twist=ease(twist,0,dt,TWIST_RETURN_TAU); }
          // speed: taps add boost; while a hand is down it settles at HELD_BOOST, otherwise back to cruise
          boost=clamp(ease(boost,hands.length?HELD_BOOST:0,dt,BOOST_TAU),0,SPEED_MAX-1);
          var want=1+boost, lim=ACCEL_MAX*dt;
          spd=clamp(spd+clamp(want-spd,-lim,lim),1,SPEED_MAX);
          t+=dt*cfg.speed; travel+=dt*cfg.speed*2.2*spd;
          for(var i=ripples.length-1;i>=0;i--) { var rp=ripples[i]; rp.age+=dt; rp.fade=Math.pow(Math.max(0,1-rp.age/RIPPLE_LIFE),1.5); if(rp.age>=RIPPLE_LIFE) ripples.splice(i,1); }
          reset();
        }
        cam.n=Math.round(cfg.depth); cam.ox=bx; cam.oy=by;
        var share=speedShare();
        g.fillStyle='#060606';g.fillRect(0,0,W,H);
        var n=cam.n,sides=mode===1?4:mode===0?8:24, offset=mode===1?Math.PI/4:0;
        var width=Math.max(1,Math.min(W,H)/700)*(1+WIDTH_SPEED_GAIN*share)*MUS.wide, phase=travel%1, aMul=0.8+ALPHA_SPEED_GAIN*share;
        // Fixed spatial spacing, continuously moving toward camera. Near/far fades hide recycling.
        for(var j=n;j>=0;j--) {
          var z=j+1-phase, fade=Math.min(1,Math.max(0,(z-.3)/1.2))*Math.pow(Math.max(0,1-z/(n+1)),.65);
          var alpha=Math.min(1,Math.min(ALPHA_CAP,cfg.intensity*fade*.82*aMul)*MUS.gain);
          for(var k=0;k<sides;k++) {
            var a=offset+k*Math.PI*2/sides,b=offset+(k+1)*Math.PI*2/sides;
            var p0=point(z,a),q=point(z,b),r=point(z+1,a);
            var stroke=width*(mode===1?Math.max(1,18/(z+.8)):mode===0?Math.max(1,7/(z+.8)):1);
            line(p0,q,alpha,stroke);line(p0,r,alpha*.6,stroke*.8);
            if(mode!==2) for(var sub=1;sub<4;sub++) {
              var sa=a+(b-a)*sub/4;line(point(z,sa),point(z+1,sa),alpha*.65,stroke*.7);
            }
            if(mode===1 && (j+Math.floor(travel))%4===1 && k%2===1) {
              // Door jambs and receding side passage: scale with depth, never screen-space decals.
              var u=point(z,a+(b-a)*.3),vv=point(z,a+(b-a)*.7),u2=point(z+1.5,a+(b-a)*.3),v2=point(z+1.5,a+(b-a)*.7);
              line(u,vv,alpha*.9,width*1.5);line(u,u2,alpha,width);line(vv,v2,alpha,width);line(u2,v2,alpha*.6,width);
            }
          }
        }
        // Dark central vanishing point and a restrained edge vignette, no flashing fills.
        var vignette=g.createRadialGradient(W/2,H/2,Math.min(W,H)*.2,W/2,H/2,Math.max(W,H)*.65);
        vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(0,0,0,.65)');g.fillStyle=vignette;g.fillRect(0,0,W,H);
        // ripples of light: a soft ring and a fainter echo, added onto the picture
        if(ripples.length) {
          g.save(); g.globalCompositeOperation='lighter'; g.lineCap='round';
          for(var ri=0;ri<ripples.length;ri++) {
            var rg=ripples[ri], rr=RIPPLE_SPEED*W*rg.age, ra=RIPPLE_ALPHA*(0.6+0.4*cfg.intensity)*rg.fade;
            if(!(rr>0) || ra<.01) continue;
            [[1,1],[RIPPLE_ECHO,0.4]].forEach(function(e){ var r2=rr*e[0], a2=ra*e[1]; if(r2<2) return;
              [[W*0.03,0.18],[W*0.012,0.4],[Math.max(2,W*0.003),1]].forEach(function(l){
                g.strokeStyle='rgba('+RIPPLE_COLOR+','+Math.min(1,a2*l[1])+')'; g.lineWidth=l[0]; g.beginPath(); g.arc(rg.x,rg.y,r2,0,Math.PI*2); g.stroke(); }); });
          }
          g.restore();
        }
        g.globalCompositeOperation='source-over';
      },
      touch:function(e) {
        if(!alive || !e || !e.first || isFrozen()) return;
        if(!fin(e.x)||!fin(e.y)||e.x<0||e.x>1||e.y<0||e.y>1) return;
        var W=canvas.width, H=canvas.height, x=e.x*W, y=e.y*H;
        // next to a hand that has been down a while = that hand moving or twisting, not a new tap
        for(var i=0;i<hands.length;i++) { var h=hands[i];
          if((clk-h.born>SAME_HAND_S || clk-h.moved<SAME_HAND_S) && (Math.hypot(x-h.x,y-h.y)<HAND_CLUSTER*W || Math.hypot(x-h.px,y-h.py)<HAND_CLUSTER*W)) return; }
        tap(x,y);
      },
      resize:function(){},
      destroy:function(){
        if(!alive) return; alive=false; hands=[]; ripples=[];
        
      },
      inspect:function(){
        var W=canvas.width, H=canvas.height, nums=[bx,by,twist,boost,spd,travel,t,clk];
        return {travel:travel,time:t,settings:Object.assign({},cfg),systemReduced:media.matches,
          handCount:hands.length,handIds:hands.map(function(h){return h.id;}),handPos:hands.map(function(h){return [h.x,h.y];}),fresh:lastFresh,
          held:held,target:tgt,bend:[bx,by],farPoint:[W/2+bx*1,H/2+by*1],twist:twist,speed:spd,boost:boost,ripples:ripples.length,taps:taps,
          resets:resets,finite:nums.every(fin)&&(lastAngle===null||fin(lastAngle))&&hands.every(function(h){return fin(h.x)&&fin(h.y);})&&ripples.every(function(r){return fin(r.x)&&fin(r.y)&&fin(r.age);})};}};
      inst.set=set;
      return inst;
    };
  })();

  // ==== the switch ====
  var defaults = {speed: 0.35, depth: 26, intensity: 0.65, pause: 0, reduced: 0};
  var ranges = {speed:[0,1], depth:[12,40], intensity:[0.15,1], pause:[0,1], reduced:[0,1]};
  var makers = {1: makeV1, 2: makeV2, 3: makeV3};
  // a usable version number, or null (null, empty, text, NaN, out of 1..3 after rounding)
  function parseVersion(raw) {
    if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
    var n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 1 && n <= 3 ? n : null;
  }
  [['optictunnel','Facet Tunnel'],['opticmaze','Maze Passage'],['opticspiral','Helix']].forEach(function (v, mode) {
    registerWallPlugin({id:v[0], title:v[1], author:'Billy / Codex', create:function(canvas,kit) {
      var cfg = Object.assign({}, defaults), alive = true, version, pending, active = null;
      function clampSettings(values) { Object.keys(ranges).forEach(function(k) {
        var raw = values && values[k], n = Number(raw); if (raw !== null && raw !== undefined && Number.isFinite(n)) cfg[k] = Math.max(ranges[k][0], Math.min(ranges[k][1], n));
      }); }
      clampSettings(window._opticflowFx);
      version = parseVersion(window._opticflowFx && window._opticflowFx.version); if (version === null) version = DEFAULT_VERSION;
      pending = version;
      function build(n) { return makers[n](canvas, kit, mode, Object.assign({}, cfg)); }
      active = build(version);
      function set(values) {
        clampSettings(values);
        var pv = parseVersion(values && values.version); if (pv !== null) pending = pv;   // swapped at the next frame, never here
        if (active && active.set) active.set(values);
      }
      window.OpticflowSet = set;
      function swap() {
        var old = version, target = pending;
        pending = target;
        try { active.destroy(); } catch (e) {}
        active = null;
        try { active = build(target); version = target; }
        catch (e) { try { kit.log('optic flow version ' + target + ' failed (' + e + '); back to ' + old); } catch (x) {} active = build(old); version = old; pending = old; return; }
        try { kit.log('optic flow version ' + version + ' (' + VERSION_NAMES[version] + ')'); } catch (e) {}
      }
      var inst = {
        frame: function (dt, now) {
          if (!alive) return;
          if (pending !== version) swap();
          var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
          MUS.gain = 1 + 0.6 * Math.min(1, bass * 1.4); MUS.wide = 1 + 0.5 * bass;   // music: bass raises stripe brightness (up to 1.6x); a beat adds a short forward burst on top of the host's dt
          if (active) active.frame(dt * (1 + 1.2 * beat), now);
        },
        touch: function (e) { if (alive && active && active.touch) active.touch(e); },
        resize: function () { if (active && active.resize) active.resize.apply(active, arguments); },
        destroy: function () {
          if (!alive) return; alive = false;
          if (active) { try { active.destroy(); } catch (e) {} active = null; }
          if (window.OpticflowSet === set) delete window.OpticflowSet;
        },
        inspect: function () {
          var base = {version: version, versionName: VERSION_NAMES[version], pendingVersion: pending};
          var ai = active && active.inspect ? active.inspect() : {}, r = Object.assign(base, ai);
          if (r.finite === undefined) r.finite = [r.travel, r.time, r.x, r.y].every(function (q) { return typeof q === 'number' && Number.isFinite(q); });   // version 1 has no finite flag of its own
          return r;
        }
      };
      return inst;
    }});
  });
})();
