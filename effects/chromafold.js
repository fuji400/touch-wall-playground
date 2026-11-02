/* Chromafold — an original kinetic textile for the wall, 2026-10-04.
 * Only the WallKit plugin contract is used. No libraries, assets, audio, or network calls.
 * Continuous fingertips open the folds; registered foreground depth presses the cloth.
 */
(function () {
  'use strict';
  registerWallPlugin({id: 'chromafold', title: 'Chromafold', author: 'Codex', create: create});

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Chromafold needs WebGL 2');
    var cols = 54, rows, count, aspect, height, velocity, light, hands, body, rawBody, hits, upload;
    var seq = -1, depthAt = -Infinity, depthFresh = false, fingerCount = 0, bodySamples = 0;
    var elapsed = 0, frames = 0, accumulator = 0, destroyed = false, tipData = new Float32Array(48);
    var tap = [], resources = [], geometry, vertices, buffer, texture, sceneTexture, target;
    var sceneW = 0, sceneH = 0, maxHeight = 0, maxEnergy = 0;
    function own(kind, item) { resources.push([kind, item]); return item; }
    function shader(type, text) {
      var s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var error = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(error);
      }
      return s;
    }
    function program(vs, fs) {
      var v = shader(gl.VERTEX_SHADER, vs), f = shader(gl.FRAGMENT_SHADER, fs), p = gl.createProgram();
      gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        var error = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(error);
      }
      return own('Program', p);
    }
    var textile = program(`#version 300 es
      precision highp float;
      layout(location=0) in vec2 cell;
      layout(location=1) in vec3 local;
      layout(location=2) in vec2 face;
      uniform sampler2D field;
      uniform vec2 grid;
      uniform float time;
      out vec3 colour;
      out vec3 bary;
      const float TAU=6.2831853;
      vec3 dye(float p) {
        vec3 a=vec3(.075,.22,.64), b=vec3(.025,.77,.69), c=vec3(1.,.36,.12), d=vec3(1.,.76,.32);
        p=fract(p)*4.;
        return p<1.?mix(a,b,p):p<2.?mix(b,c,p-1.):p<3.?mix(c,d,p-2.):mix(d,a,p-3.);
      }
      void main() {
        vec4 s=texelFetch(field,ivec2(cell),0);
        float h=(s.r-.5)*4.;
        float e=s.g;
        vec2 uv=(cell+.5)/grid;
        float idle=sin(uv.x*8.+uv.y*5.+time*.22)*.045;
        float turn=h*.92+idle+sin(uv.y*7.-uv.x*5.+time*.13)*.12;
        float fold=.19+e*.48+max(h,0.)*.30;
        vec3 p=vec3(local.xy*.465,local.z*fold);
        // Four creased facets, each with its own moving normal.
        vec3 n=normalize(vec3(face*fold*2.15,1.));
        float tilt=.25+sin(h*1.6+uv.y*3.)*.30;
        mat2 ry=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt));
        p.xz=ry*p.xz; n.xz=ry*n.xz;
        mat2 rz=mat2(cos(turn),sin(turn),-sin(turn),cos(turn));
        p.xy=rz*p.xy; n.xy=rz*n.xy;
        p.y-=p.z*.44;
        vec2 pos=(cell+.5+p.xy)/grid;
        pos+=vec2(sin(uv.y*5.+h),cos(uv.x*4.-h))*(h*.12)/grid;
        gl_Position=vec4(pos.x*2.-1.,1.-pos.y*2.,0.,1.);
        float lambert=max(0.,dot(n,normalize(vec3(-.38,-.60,1.))));
        float spec=pow(max(0.,dot(n,normalize(vec3(-.12,-.30,1.)))),25.);
        float thread=.5+.5*sin(uv.x*9.-uv.y*7.+time*.055);
        float palette=uv.x*.22+uv.y*.20+h*.19+e*.20+time*.006;
        vec3 pigment=dye(palette);
        float awake=max(e,s.b*.9);
        float shimmer=pow(.5+.5*sin(h*4.-uv.x*2.+uv.y*3.),3.);
        float luminance=.045+thread*.07+awake*(.55+.32*shimmer);
        colour=pigment*luminance*(.24+lambert*.82);
        colour+=vec3(.62,.89,1.)*spec*(.02+awake*.56);
        colour+=vec3(.85,.92,.68)*pow(s.b,3.)*spec*.35;
        int k=gl_VertexID%3;
        bary=k==0?vec3(1,0,0):k==1?vec3(0,1,0):vec3(0,0,1);
      }`, `#version 300 es
      precision highp float;
      in vec3 colour;
      in vec3 bary;
      out vec4 outColour;
      void main() {
        vec3 width=fwidth(bary)*.7;
        vec3 edge=smoothstep(vec3(0),width,bary);
        float seam=min(edge.x,min(edge.y,edge.z));
        outColour=vec4(colour*(.86+.14*seam)+colour*.20*(1.-seam),1.);
      }`);
    var finish = program(`#version 300 es
      precision highp float;
      out vec2 uv;
      void main() {
        vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
        uv=p; gl_Position=vec4(p*2.-1.,0.,1.);
      }`, `#version 300 es
      precision highp float;
      uniform sampler2D scene;
      uniform vec2 resolution;
      uniform vec3 tips[16];
      uniform int tipCount;
      in vec2 uv;
      out vec4 outColour;
      void main() {
        vec3 c=texture(scene,uv).rgb;
        vec2 d=vec2(3.)/resolution;
        vec3 glow=texture(scene,uv+vec2(d.x,0)).rgb+texture(scene,uv-vec2(d.x,0)).rgb;
        glow+=texture(scene,uv+vec2(0,d.y)).rgb+texture(scene,uv-vec2(0,d.y)).rgb;
        glow+=texture(scene,uv+d*2.).rgb+texture(scene,uv-d*2.).rgb;
        c+=glow*.085;
        vec2 p=vec2(uv.x,1.-uv.y);
        for(int i=0;i<16;i++) {
          if(i>=tipCount) break;
          vec2 delta=(p-tips[i].xy)*vec2(resolution.x/resolution.y,1.);
          float r=length(delta);
          // Small contact glint anchors the fabric to the actual hand location.
          c+=vec3(.65,.90,1.)*exp(-r*r/0.000034)*tips[i].z*.36;
        }
        float vignette=1.-.28*pow(length((uv-.5)*1.2),2.);
        c=vec3(1.)-exp(-c*vignette*1.50);
        outColour=vec4(pow(c,vec3(.86)),1.);
      }`);
    var U = {};
    ['field','grid','time'].forEach(function(n){U[n]=gl.getUniformLocation(textile,n);});
    var P = {};
    ['scene','resolution','tips','tipCount'].forEach(function(n){P[n]=gl.getUniformLocation(finish,n);});
    geometry=own('VertexArray',gl.createVertexArray());
    buffer=own('Buffer',gl.createBuffer());
    texture=own('Texture',gl.createTexture());
    sceneTexture=own('Texture',gl.createTexture());
    target=own('Framebuffer',gl.createFramebuffer());
    function texParams(filter) {
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    function resize(w,h) {
      aspect=w/Math.max(1,h); rows=Math.max(16,Math.min(80,Math.round(cols/aspect))); count=cols*rows;
      height=new Float32Array(count); velocity=new Float32Array(count); light=new Float32Array(count);
      hands=new Float32Array(count); body=new Float32Array(count); rawBody=new Float32Array(count);
      hits=new Uint16Array(count); upload=new Uint8Array(count*4); seq=-1;
      var data=[], corners=[[-1,-1],[1,-1],[1,1],[-1,1]], normals=[[0,-1],[1,0],[0,1],[-1,0]];
      for(var y=0;y<rows;y++) for(var x=0;x<cols;x++) for(var f=0;f<4;f++) {
        var a=corners[f],b=corners[(f+1)%4],n=normals[f];
        data.push(x,y,0,0,1,n[0],n[1], x,y,a[0],a[1],0,n[0],n[1], x,y,b[0],b[1],0,n[0],n[1]);
      }
      vertices=data.length/7;
      gl.bindVertexArray(geometry); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
      [2,3,2].forEach(function(size,i){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,size,gl.FLOAT,false,28,[0,8,20][i]);});
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D,texture); texParams(gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,cols,rows,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      // Cap private Retina previews as well as the projector to a modest render budget.
      var scale=Math.min(1,1600/w,1200/h); sceneW=Math.max(1,Math.round(w*scale)); sceneH=Math.max(1,Math.round(h*scale));
      gl.bindTexture(gl.TEXTURE_2D,sceneTexture); texParams(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,sceneW,sceneH,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,target);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,sceneTexture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Chromafold render target incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    function finitePoint(p) {return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0]>=0 && p[0]<=1 && p[1]>=0 && p[1]<=1;}
    function stamp(x,y,strength) {
      var cx=x*cols-.5, cy=y*rows-.5, radius=3.8;
      for(var iy=Math.max(0,Math.floor(cy-radius*2));iy<=Math.min(rows-1,Math.ceil(cy+radius*2));iy++) {
        for(var ix=Math.max(0,Math.floor(cx-radius*2));ix<=Math.min(cols-1,Math.ceil(cx+radius*2));ix++) {
          var dx=ix-cx,dy=iy-cy,fall=Math.exp(-(dx*dx+dy*dy)/(radius*radius*.62));
          var i=iy*cols+ix; hands[i]=Math.max(hands[i],fall*strength);
        }
      }
    }
    function input(now) {
      hands.fill(0); tipData.fill(0); fingerCount=0;
      var f=kit.fingers, pts=[];
      if(f) {if(Date.now()-f.t<=160 && Date.now()-f.t>=0 && Array.isArray(f.pts)) pts=f.pts;}
      else if(kit.touches) pts=kit.touches.filter(function(t){return Date.now()-t.t<160;}).map(function(t){return[t.x,t.y];});
      for(var j=0;j<pts.length && fingerCount<16;j++) if(finitePoint(pts[j])) {
        var p=pts[j]; stamp(p[0],p[1],1); tipData.set([p[0],p[1],1],fingerCount*3); fingerCount++;
      }
      tap=tap.filter(function(t){return now-t.t<160;});
      if(!f) tap.forEach(function(t){stamp(t.x,t.y,Math.max(0,1-(now-t.t)/160));});
      var d=kit.depth(); depthFresh=!!(d && d.wall && now-d.time>=-34 && now-d.time<=150);   // >= -34 like body.js: a depth frame can land between vsync and the rAF callback
      if(depthFresh && d.seq!==seq) {
        seq=d.seq; depthAt=d.time; hits.fill(0); rawBody.fill(0); bodySamples=0;
        if(d.data.length===d.w*d.h && d.wall.length===d.data.length) {
          for(var v=2;v<d.h;v+=4) for(var u=2;u<d.w;u+=4) {
            var k=v*d.w+u,z=d.data[k],wall=d.wall[k],gap=wall-z;
            if(z<400 || !Number.isFinite(wall) || wall<500 || gap<65 || gap>1800) continue;
            var s=kit.toScreen(u,v); if(!finitePoint(s)) continue;
            var sx=Math.min(cols-1,Math.floor(s[0]*cols)),sy=Math.min(rows-1,Math.floor(s[1]*rows));
            hits[sy*cols+sx]++; bodySamples++;
          }
        }
        if(bodySamples>=18) for(var b=0;b<count;b++) rawBody[b]=hits[b]>=2?1:0;
      }
      if(!depthFresh) {rawBody.fill(0);bodySamples=0;}
    }
    function simulate(dt) {
      var relax=1-Math.exp(-dt*22), decay=Math.exp(-dt*2.15);
      for(var y=0;y<rows;y++) for(var x=0;x<cols;x++) {
        var i=y*cols+x,l=x>0?i-1:i,r=x<cols-1?i+1:i,t=y>0?i-cols:i,b=y<rows-1?i+cols:i;
        var silhouette=(rawBody[i]*4+rawBody[l]+rawBody[r]+rawBody[t]+rawBody[b])/8;
        body[i]+=(silhouette-body[i])*relax;
        var goal=hands[i]*1.12+body[i]*.48;
        var lap=height[l]+height[r]+height[t]+height[b]-4*height[i];
        velocity[i]+=(100*(goal-height[i])+88*lap-9.8*velocity[i])*dt;
      }
      maxHeight=0;maxEnergy=0;
      for(var k=0;k<count;k++) {
        height[k]=Math.max(-1.3,Math.min(1.7,height[k]+velocity[k]*dt));
        light[k]=Math.max(light[k]*decay,hands[k],body[k]*.68,Math.min(1,Math.abs(velocity[k])*.16+Math.abs(height[k])*.48));
        maxHeight=Math.max(maxHeight,Math.abs(height[k]));maxEnergy=Math.max(maxEnergy,light[k]);
      }
    }
    function draw() {
      for(var i=0;i<count;i++) {
        upload[i*4]=Math.round((height[i]/4+.5)*255);
        upload[i*4+1]=Math.round(Math.min(1,Math.max(light[i],hands[i]))*255);
        upload[i*4+2]=Math.round(Math.min(1,hands[i])*255);
        upload[i*4+3]=255;
      }
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(0,0,sceneW,sceneH);
      gl.clearColor(.002,.004,.009,1);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(textile);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,cols,rows,gl.RGBA,gl.UNSIGNED_BYTE,upload);
      gl.uniform1i(U.field,0);gl.uniform2f(U.grid,cols,rows);gl.uniform1f(U.time,elapsed);
      gl.bindVertexArray(geometry);gl.drawArrays(gl.TRIANGLES,0,vertices);gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);
      gl.useProgram(finish);gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
      gl.uniform1i(P.scene,0);gl.uniform2f(P.resolution,sceneW,sceneH);
      gl.uniform3fv(P.tips,tipData);gl.uniform1i(P.tipCount,fingerCount);gl.drawArrays(gl.TRIANGLES,0,3);
    }
    function frame(dt,now) {
      if(destroyed)return;
      dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));elapsed+=dt;frames++;
      input(now);accumulator=Math.min(.1,accumulator+dt);
      while(accumulator>=1/120){simulate(1/120);accumulator-=1/120;}
      draw();
    }
    function destroy() {
      if(destroyed)return;destroyed=true;kit.wantDepth(false);tap=[];
      resources.reverse().forEach(function(r){gl['delete'+r[0]](r[1]);});resources=[];
    }
    try {resize(canvas.width,canvas.height);kit.wantDepth(true);}
    catch(e) {destroy();throw e;}
    return {
      frame:frame,resize:resize,destroy:destroy,
      touch:function(t){if(finitePoint([t.x,t.y]) && t.first){tap.push({x:t.x,y:t.y,t:performance.now()});if(tap.length>16)tap.shift();}},
      debug:function(){return{frames:frames,grid:[cols,rows],fingers:fingerCount,bodySamples:bodySamples,depthFresh:depthFresh,
        depthAgeMs:Number.isFinite(depthAt)?Math.round(performance.now()-depthAt):null,
        maxHeight:maxHeight,maxEnergy:maxEnergy,glError:gl.getError(),destroyed:destroyed};}
    };
  }
})();
