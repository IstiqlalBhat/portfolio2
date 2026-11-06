import{BufferAttribute as e,BufferGeometry as t,Color as n,Group as r,LineSegments as i,Mesh as a,PerspectiveCamera as o,Points as s,Scene as c,ShaderMaterial as l,Vector3 as u,Vector4 as d,WebGLRenderer as f}from"./three-lite-BlL_hqgc.js";import{t as p}from"./index-lwQiPdbU.js";var m=[`Jan`,`Feb`,`Mar`,`Apr`,`May`,`Jun`,`Jul`,`Aug`,`Sep`,`Oct`,`Nov`,`Dec`];function h(e){let t=new Date(e);return`${m[t.getUTCMonth()]} ${t.getUTCFullYear()}`}function ee(e){let t=Date.parse(e.timeline?.start+`T00:00:00Z`),n=Date.parse(e.timeline?.end+`T00:00:00Z`);return{t0:t,t1:n,span:Math.max(1,(n-t)/864e5)}}function g(e){let t=[...e.chapters||[]].sort((e,t)=>(e.index??0)-(t.index??0)),n=new Map(t.map((e,t)=>[e.id,t])),r=new Map;for(let t of e.repos||[])n.has(t.chapter)&&r.set(t.id,n.get(t.chapter));return t.forEach((e,t)=>(e.repoIds||[]).forEach(e=>{r.has(e)||r.set(e,t)})),{chapters:t,repoChap:r}}var _,te=0,v=()=>new Promise(e=>{globalThis.scheduler?.yield?globalThis.scheduler.yield().then(e):setTimeout(e,0)}).then(()=>{te=performance.now()}),ne=()=>performance.now()-te>8?v():null,y=9,b=e=>{let t=Math.sin(e*127.1+311.7)*43758.5453;return t-Math.floor(t)},x=(e,t,n)=>Math.min(n,Math.max(t,e)),re=e=>e*e*(3-2*e),S=(e,t,n,r)=>e+(t-e)*(1-Math.exp(-n*r));function ie(){try{let e=localStorage.getItem(`p2-dev-tier`);return e===`0`||e===`1`||e===`2`?+e:-1}catch{return-1}}function ae(){let e=navigator.hardwareConcurrency||4,t=navigator.deviceMemory||8,n=Math.min(screen.width,screen.height)<520,r=ie();return r>=0?r:e<=2||t<=2?0:n||e<=4?1:2}var oe=[{dpr:1,stars:500,nebula:0,dust:1200,near:0,scaffold:300,maxPoints:3e3},{dpr:1.5,stars:1e3,nebula:70,dust:2500,near:110,scaffold:720,maxPoints:7e3},{dpr:1.5,stars:1800,nebula:160,dust:4500,near:220,scaffold:1e3,maxPoints:14e3}],se=`
uniform float uTime, uReveal, uNow, uScale, uPR, uPulseR, uPulseA, uPulseCh, uFocus, uAper, uFinal;
uniform vec3 uPulseC;
uniform vec4 uCh[${y}]; // per chapter: focus weight, world morph, world brightness
attribute vec3 aColor, aFin;
attribute vec4 aForm;
attribute float aT, aSize, aChap, aSeed;
varying vec3 vColor;
varying float vAlpha, vBloom, vBlur;
void main() {
  vec4 ch = uCh[int(aChap + 0.5)];
  float w = ch.x;
  // chapter "world": the focused chapter's commits leave the galaxy and assemble into its
  // own formation, earliest commits first (aForm.w = time rank inside the chapter)
  float mm = smoothstep(0.0, 1.0, clamp(ch.y * 1.8 - aForm.w * 0.8, 0.0, 1.0));
  // finale: the whole career resolves into one ring, oldest commits first
  float fm = smoothstep(0.0, 1.0, clamp(uFinal * 1.7 - aT * 0.7, 0.0, 1.0));
  vec3 p = mix(position, aForm.xyz, mm);
  p += vec3(sin(uTime * 0.7 + aSeed * 40.0), cos(uTime * 0.6 + aSeed * 23.0), sin(uTime * 0.5 + aSeed * 17.0)) * 0.1 * mm;
  p = mix(p, aFin, fm);
  // mid-flight points bow outward so the morph reads as a swarm, not a cross-fade
  float fly = mm * (1.0 - mm) + fm * (1.0 - fm);
  p += (vec3(aSeed, fract(aSeed * 7.31), fract(aSeed * 13.7)) - 0.5) * fly * 9.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(0.1, -mv.z);
  // scaffold motes (aSize < 0) are not commits: they only appear, faintly, to outline a formed world
  float scaf = step(aSize, 0.0);
  float fk = ch.z;
  float rev = smoothstep(aT - 0.004, aT + 0.012, uReveal);
  float front = exp(-pow((uReveal - aT) * 70.0, 2.0)) * step(uReveal, 1.01);
  float future = mix(1.0, 0.16, smoothstep(uNow + 0.003, uNow + 0.04, aT) * (1.0 - fm) * (1.0 - mm));
  float tw = 0.72 + 0.28 * sin(uTime * (0.8 + aSeed * 2.6) + aSeed * 61.0);
  float s = mix(abs(aSize), min(abs(aSize), 0.4), mm) * uScale / z * (1.0 + 1.6 * front) * (0.55 + 0.45 * w) * mix(1.0, 0.55 + 0.45 * fk, mm);
  float a = rev * future * tw * w * mix(1.0, fk, mm) * mix(1.0, 0.6, fm) * mix(1.0, 1.9 * mm, scaf);
  // commits streaming in: a light sweeps through the formed world (and the finale ring) in commit order
  float sw = aForm.w - fract(uTime * 0.09);
  float sf = aT - fract(uTime * 0.06);
  float stream = mm * exp(-sw * sw * 600.0) + fm * exp(-sf * sf * 1400.0);
  s *= 1.0 + 0.9 * stream;
  a *= 1.0 + 2.4 * stream;
  // arrival pulse: a shock-wave ring sweeping through the focused chapter's stars
  float same = 1.0 - step(0.5, abs(aChap - uPulseCh));
  float pd = distance(p, uPulseC) - uPulseR;
  float pulse = uPulseA * same * (exp(-pd * pd * 0.12) + 0.35);
  s *= 1.0 + 1.0 * pulse;
  a *= 1.0 + 2.0 * pulse;
  vBloom = clamp((w - 1.0) * 4.0, 0.0, 1.0) + 0.6 * pulse;
  s *= 1.0 + 0.25 * vBloom;
  a *= 1.0 / (1.0 + 0.6 * vBloom + 0.5 * mm);
  // depth of field: out-of-focus commits grow into soft discs and spread their light
  float coc = clamp(abs(z - uFocus) / z * uAper, 0.0, 1.0);
  float s2 = s + coc * 15.0 * uPR;
  a *= mix(1.0, (s * s + 9.0) / (s2 * s2 + 9.0), 0.8);
  // aerial perspective: distant structure dims and cools
  float far = smoothstep(uFocus * 1.25, uFocus * 3.2, z);
  a *= 1.0 - 0.55 * far;
  float ps = max(s2, 2.6 * uPR);
  a *= min(1.0, s2 / (2.6 * uPR));
  gl_PointSize = min(ps, 34.0 * uPR);
  vBlur = coc;
  vAlpha = a * (1.0 + 2.0 * front);
  vec3 c = mix(aColor, vec3(0.42, 0.52, 0.95) * dot(aColor, vec3(0.33)), far * 0.6);
  vColor = mix(c, vec3(1.0), min(1.0, 0.15 + 0.5 * front + 0.4 * pulse + 0.7 * stream));
  gl_Position = projectionMatrix * mv;
}`,ce=`
attribute vec3 aFrom;
attribute float aOrd, aEnd;
uniform float uDraw;
void main() {
  float k = clamp((uDraw - aOrd) * 3.0, 0.0, 1.0);
  vec3 p = aEnd > 0.5 ? mix(aFrom, position, k) : position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,le=`
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor * uOpacity, 1.0); }`,ue=`
uniform float uScale, uSize;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(uSize * uScale / max(0.1, -mv.z), 2048.0);
  gl_Position = projectionMatrix * mv;
}`,de=`
uniform vec3 uColor;
uniform float uP;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float r = 0.15 + 0.85 * uP;
  float ring = exp(-pow((d - r) * 16.0, 2.0)) + 0.35 * exp(-pow((d - r * 0.82) * 9.0, 2.0));
  float a = ring * (1.0 - uP) * (1.0 - smoothstep(0.96, 1.0, d));
  if (a < 0.003) discard;
  gl_FragColor = vec4((uColor + vec3(0.25)) * a * 1.4, 1.0);
}`,C=`
attribute float aI;
uniform vec3 uHead, uDir;
uniform float uLen, uA, uPR;
varying float vA;
void main() {
  vec3 p = uHead - uDir * aI * uLen;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (3.2 - 2.4 * aI) * uPR;
  vA = uA * pow(1.0 - aI, 1.6);
  gl_Position = projectionMatrix * mv;
}`,fe=`
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a * 1.6, 1.0);
}`,pe=`
varying vec3 vColor;
varying float vAlpha, vBloom, vBlur;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  if (d > 1.0) discard;
  float core = exp(-d * mix(22.0, 3.0, vBlur));
  float halo = exp(-d * 4.0) * (0.38 + 0.18 * vBloom) * (1.0 - 0.6 * vBlur) + exp(-d * 1.4) * 0.08 * vBloom;
  float disc = vBlur * smoothstep(1.0, 0.75, d) * (0.55 + 0.25 * smoothstep(0.45, 0.9, d));
  float a = (core + halo + disc) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4((vColor * (core + halo + disc) + vec3(core * 0.55 * (1.0 - vBlur))) * vAlpha, 1.0);
}`,me=`
uniform float uTime, uPR, uAlpha;
attribute vec3 aColor;
attribute float aSize, aSeed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPR;
  vAlpha = uAlpha * (0.55 + 0.45 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 90.0));
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`,he=`
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  float a = exp(-d * 5.0) * (1.0 - smoothstep(0.7, 1.0, d)) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`,w=`
uniform float uTime, uScale, uPR, uAlpha, uFocus, uAper, uMaxPx, uNear;
attribute vec3 aColor;
attribute float aSize, aSeed;
varying vec3 vColor;
varying float vAlpha, vBlur;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.11 + aSeed * 30.0), sin(uTime * 0.13 + aSeed * 50.0), cos(uTime * 0.09 + aSeed * 70.0)) * 0.6 * uNear;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(0.2, -mv.z);
  float s = aSize * uScale / z;
  float coc = clamp(abs(z - uFocus) / z * uAper, 0.0, 1.2);
  float s2 = min(s + coc * uMaxPx * 0.6 * uPR, uMaxPx * uPR);
  vAlpha = uAlpha * mix(1.0, (s * s + 16.0) / (s2 * s2 + 16.0), 0.65 * uNear + 0.25) * smoothstep(1.5, 6.0, z);
  vBlur = min(1.0, coc);
  gl_PointSize = max(s2, 1.5 * uPR);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`,ge=`
varying vec3 vColor;
varying float vAlpha, vBlur;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  if (d > 1.0) discard;
  float a = mix(exp(-d * 5.0), smoothstep(1.0, 0.7, d) * (0.6 + 0.4 * d), vBlur * 0.8) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`,_e=`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,ve=`
uniform vec3 uTintA, uTintB;
uniform vec2 uCore;
uniform float uAsp, uTime, uGlow;
varying vec2 vUv;
float h(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 asp = vec2(uAsp, 1.0);
  float r = length((vUv - uCore) * asp);
  vec3 col = vec3(0.010, 0.012, 0.028);
  col += uTintA * (0.075 * exp(-r * r * 4.0) + 0.022 * exp(-r * 1.8)) * uGlow;
  col += uTintB * 0.03 * exp(-length((vUv - vec2(0.9, 0.95)) * asp) * 2.2);
  col += vec3(0.05, 0.03, 0.09) * exp(-length((vUv - vec2(0.05, 0.1)) * asp) * 2.0);
  col *= 1.0 - 0.6 * smoothstep(0.35, 1.25, length((vUv - 0.5) * asp * 1.15));
  col += (h(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`,ye={blocks(e,t,n,r,i){let a=Math.min(5,Math.floor(e*6)),o=[-.62,0,.62][a%3]*(Math.floor(a/3)%2?-1:1),s=a<3?.36:-.36,c=.25;if(r<.12){let e=Math.min(4,a),n=t,r=[-.62,0,.62][e%3]*(Math.floor(e/3)%2?-1:1),o=e<3?.36:-.36,s=e+1,c=[-.62,0,.62][s%3]*(Math.floor(s/3)%2?-1:1),l=s<3?.36:-.36;return i.set(r+(c-r)*n,o+(l-o)*n,0)}let l=Math.floor(n*12),u=t*2-1,d=l>>2,f=l&1?1:-1,p=l&2?1:-1,m=d===0?u:f,h=d===1?u:d===0?f:p,ee=d===2?u:p,g=.62,_=.5,te=m*Math.cos(g)+ee*Math.sin(g),v=-m*Math.sin(g)+ee*Math.cos(g),ne=h*Math.cos(_)-v*Math.sin(_);return v=h*Math.sin(_)+v*Math.cos(_),i.set(o+te*c,s+ne*c,v*c)},helix(e,t,n,r,i){let a=e*2-1,o=e*Math.PI*7,s=n<.5?0:Math.PI;if(r<.18){let e=t*2-1;return i.set(Math.cos(o)*.32*e,a*.95,Math.sin(o)*.32*e)}let c=.32+(t-.5)*.05;return i.set(Math.cos(o+s)*c,a*.95,Math.sin(o+s)*c)},wave(e,t,n,r,i){let a=Math.min(39,Math.floor(e*40)),o=(a+.5)/40*2-1,s=.08+.72*(Math.exp(-o*o*2.2)*(.35+.65*Math.abs(Math.sin(a*1.7)*Math.cos(a*.63))));return i.set(o*.95,(t*2-1)*s,(n-.5)*.06)},eye(e,t,n,r,i){if(r<.2){let e=Math.floor(n*8),r=e>>1,a=r&1?1:-1,o=r&2?1:-1,s=.28*t;return e&1?i.set(a*(.92-s),o*.92,0):i.set(a*.92,o*(.92-s),0)}if(r<.32){let e=n*Math.PI*2,r=.19+(t-.5)*.02;return i.set(Math.cos(e)*r,Math.sin(e)*r,0)}let a=Math.floor(n*90)/90*Math.PI*2+(t-.5)*.03,o=.24+(e*.5+t*.5)**.8*.5;return i.set(Math.cos(a)*o,Math.sin(a)*o,(r-.5)*.05)},stack(e,t,n,r,i){let a=Math.min(3,Math.floor(e*4)),o=.6,s=(t*2-1)*o,c,l;if(r<.22)c=n<.5?s:0,l=n<.5?0:s;else{let e=Math.floor(n*4);c=e===0?s:e===1?o:e===2?-s:-.6,l=e===0?-.6:e===1?s:e===2?o:-s}let u=-.78+a*.52,d=.4,f=.62,p=c*Math.cos(f)+l*Math.sin(f),m=-c*Math.sin(f)+l*Math.cos(f);return i.set(p,u*Math.cos(d)-m*Math.sin(d),u*Math.sin(d)+m*Math.cos(d))},ripples(e,t,n,r,i){let a=Math.min(6,Math.floor(e*7)),o=.14+a*.135+(t-.5)*.02,s=n*Math.PI*2;return i.set(Math.cos(s)*o,Math.sin(s)*o*.92,Math.sin(s*3+a)*.06)},orbits(e,t,n,r,i){if(r<.14){let e=t*2-1,r=Math.sqrt(1-e*e),a=n*Math.PI*2,o=.12;return i.set(Math.cos(a)*r*o,e*o,Math.sin(a)*r*o)}let a=Math.min(3,Math.floor(e*4)),o=n*Math.PI*2,s=.9-a%2*.12,c=[0,1.05,2.1,.52][a],l=Math.cos(o)*s,u=Math.sin(o)*s*.36,d=Math.sin(o)*s*.3;return i.set(l*Math.cos(c)-u*Math.sin(c),l*Math.sin(c)+u*Math.cos(c),d)}},T=[`blocks`,`helix`,`wave`,`eye`,`stack`,`ripples`,`orbits`];function be(e,t){let n=`${e.id||``} ${e.title||``}`.toLowerCase();return/ledger|carbon|chain|block/.test(n)?`blocks`:/listen|hear|transcri/.test(n)?`ripples`:/voice|memory|speech/.test(n)?`wave`:/vision|eye|inventory|object|image/.test(n)?`eye`:/aws|infra|rebuild|cloud|terraform/.test(n)?`stack`:/agent|operating|os\b/.test(n)?`orbits`:/night|build|pipeline|ci\b/.test(n)?`helix`:T[t%T.length]}async function xe({onFail:m}){_=(await p(async()=>{let{default:e}=await import(`./story-BoHcOsEN.js`);return{default:e}},[])).default,await v();let te=document.getElementById(`gl`),T;try{T=new f({canvas:te,antialias:!1,alpha:!1,powerPreference:`high-performance`})}catch(e){m(e);return}await v();let xe=!1;try{let e=T.getContext(),t=e.getExtension(`WEBGL_debug_renderer_info`),n=String(t?e.getParameter(t.UNMASKED_RENDERER_WEBGL):e.getParameter(e.RENDERER));xe=/swiftshader|llvmpipe|softpipe|software|basic render/i.test(n)}catch{}let Se=ie()>=0?ie():xe?0:ae(),E=xe?{...oe[0],dpr:.75,scaffold:140}:oe[Se];!xe&&Se===2&&document.documentElement.classList.add(`hq`),T.setClearColor(263434,1);let{chapters:D,repoChap:O}=g(_),{t0:Ce,span:k}=ee(_),A=D.length,we=D.map(e=>new n(e.color||`#9aa4b8`)),Te=new n(`#9aa4b8`),j=e=>Math.min(e,8),M=new u;function Ee(e,t){let n=.9+e*1.25*Math.PI*2,r=4+30*e**.8;return t.set(Math.cos(n)*r,(e-.5)*7+Math.sin(n*2)*1.2,Math.sin(n)*r),n}function De(e,t,n){let r=O.has(e)?O.get(e):-1,i=r<0?0:(r%3-1)*6.5,a=r<0?0:(r%2*2-1)*2.2,o=i+(b(e*3+1)-.5)*5,s=a+(b(e*3+2)-.5)*3;return n.set(Math.cos(t)*o,s,Math.sin(t)*o),n}let Oe=_.timeline?.days||[],N=new Float32Array(Math.ceil(k)+2);for(let[e,,t]of Oe)N[x(Math.floor(e),0,N.length-1)]+=t;for(let e=1;e<N.length;e++)N[e]+=N[e-1];let ke=N[N.length-1]||1,Ae=e=>{let t=x(e,0,1)*(N.length-2),n=Math.floor(t),r=t-n,i=(N[n]+(N[n+1]-N[n])*r)/ke;return .6*e+.4*i},je=Oe.reduce((e,t)=>e+(t[2]||0),0),Me=Math.min(1,E.maxPoints/Math.max(1,je)),Ne=new Map;for(let[e,t,n]of Oe){let r=Ne.get(t)||{sum:0,n:0,first:1/0};r.sum+=e/k*n,r.n+=n,r.first=Math.min(r.first,e/k),Ne.set(t,r)}let Pe=new Map;for(let[e,t]of Ne){let n=t.sum/t.n,r=new u,i=Ee(Ae(n),r);r.add(De(e,i,M)),Pe.set(e,r)}let Fe=0;for(let e of Oe)Fe+=Math.max(1,Math.round(e[2]*Me));let Ie=Ne.size,Le=A*E.scaffold,P=Fe+Ie+Le,F=new Float32Array(P*3),Re=new Float32Array(P*3),ze=new Float32Array(P),Be=new Float32Array(P),Ve=new Float32Array(P),He=new Float32Array(P),Ue=new Float32Array(P*4),We=new Float32Array(P*3),I=new Int16Array(P),Ge=D.map(()=>({c:new u,n:0,pts:[]})),Ke=new Map,L=new u,qe=new u,R=0,Je=new n(1,1,1),z=new n;for(let e=0;e<Oe.length;e++){ne()&&await v();let[t,n,r]=Oe[e],i=Math.max(1,Math.round(r*Me)),a=Math.sqrt(r/i),o=O.has(n)?O.get(n):A,s=Pe.get(n);for(let c=0;c<i;c++){let i=b(e*13.37+c*7.1+.5),l=x((t+i*.95)/k,0,1),d=Ee(Ae(x((t+.5)/k,0,1)),L);L.add(De(n,d,qe)),L.lerp(s,.55);let f=e=>b(R*3.1+i*91+e*17.3+1)+b(R*5.7+i*13+e*29.1+2)+b(R*1.3+i*47+e*41.7+3)-1.5,p=(1.1+.3*Math.log2(1+r))*(1+.4*Math.log10(1+(Ne.get(n)?.n||1)));L.x+=f(1)*p,L.y+=f(2)*p*.6,L.z+=f(3)*p,F.set([L.x,L.y,L.z],R*3),z.copy(o<A?we[o]:Te).lerp(Je,b(R+.31)*.35),Re.set([z.r,z.g,z.b],R*3),ze[R]=l,Be[R]=(.2+.1*Math.log2(1+r))*a*(.7+i*.6),Ve[R]=j(o),He[R]=i,I[R]=o,o<A&&(Ge[o].c.add(L),Ge[o].n++,Ge[o].pts.length<4e3&&Ge[o].pts.push(L.clone()));let m=Ke.get(n)||{c:new u,n:0};m.c.add(L),m.n++,Ke.set(n,m),R++}}let Ye=e=>(e+.5)/Math.max(1,A),Xe=new Map,Ze=new Map;for(let[e,t]of Ke){let n=t.c.multiplyScalar(1/t.n);Xe.set(e,n),Ze.set(e,R);let r=O.has(e)?O.get(e):A;F.set([n.x,n.y,n.z],R*3),z.copy(r<A?we[r]:Te).lerp(Je,.55),Re.set([z.r,z.g,z.b],R*3),ze[R]=Ne.get(e).first,Be[R]=.55+Math.min(.8,Math.log10(1+t.n)*.3),Ve[R]=j(r),He[R]=b(e+.77),I[R]=r,R++}let Qe=D.map(()=>[]);for(let e=0;e<Fe;e++)I[e]<A&&Qe[I[e]].push(e);for(let e=0;e<A;e++){ne()&&await v();let t=Qe[e];for(let n=0;n<E.scaffold;n++){let r=b(e*101.3+n*1.71+.3),i=b(e*57.1+n*2.93+.7),a=t.length?t[Math.floor(r*t.length)]:-1;a>=0?(F.set([F[a*3]+(i-.5)*2,F[a*3+1]+(b(n*3.3+e)-.5),F[a*3+2]+(b(n*4.7+e)-.5)*2],R*3),ze[R]=x(ze[a]+(i-.5)*.01,0,1)):(Ee(Ye(e),M),F.set([M.x,M.y,M.z],R*3),ze[R]=Ye(e)),z.copy(we[e]).lerp(Je,.4),Re.set([z.r,z.g,z.b],R*3),Be[R]=-(.12+i*.08),Ve[R]=j(e),He[R]=b(R*.37+.5),I[R]=e,R++}}await v();let $e=Ge.map((e,t)=>{let n;e.n?n=e.c.clone().multiplyScalar(1/e.n):(n=new u,Ee(Ye(t),n));let r=4;e.pts.length&&(r=Math.sqrt(e.pts.reduce((e,t)=>e+t.distanceToSquared(n),0)/e.pts.length));let i=new u(n.x,0,n.z);i.lengthSq()<1e-4&&i.set(1,0,0),i.normalize();let a=new u(-i.z,0,i.x),o=i.clone().multiplyScalar(.55).add(new u(0,.62,0)).add(a.multiplyScalar(t%2?.45:-.45)).normalize(),s=r*2.6+14;return{c:n,rad:r,dir:o,D:s}}),et=new u(0,1,0),tt=e=>{let t=new u().crossVectors(et,e).normalize();return{r:t,u:new u().crossVectors(e,t).normalize(),f:e}},nt=D.map(()=>[]);for(let e=0;e<P;e++)I[e]<A&&nt[I[e]].push(e);let rt=new Map,B=new u;for(let e=0;e<A;e++){let t=D[e];await v();let n=nt[e].sort((e,t)=>ze[e]-ze[t]),{c:r,dir:i,D:a}=$e[e],o=tt(i),s=.3*a*1.12,c=ye[be(t,e)];n.forEach((e,t)=>{let i=n.length>1?t/(n.length-1):0;c(i,b(e*1.37+.11),b(e*2.71+.53),b(e*3.97+.29),B);let a=r.x+(o.r.x*B.x+o.u.x*B.y+o.f.x*B.z)*s,l=r.y+(o.r.y*B.x+o.u.y*B.y+o.f.y*B.z)*s,u=r.z+(o.r.z*B.x+o.u.z*B.y+o.f.z*B.z)*s;Ue.set([a,l,u,i],e*4)})}for(let[e,t]of Ze)I[t]<A&&rt.set(e,new u(Ue[t*4],Ue[t*4+1],Ue[t*4+2]));for(let e=0;e<P;e++)I[e]>=A&&Ue.set([F[e*3],F[e*3+1],F[e*3+2],0],e*4);let it=new u(.18,.5,1).normalize(),at=e=>{let t=x(e,0,1)*(N.length-2),n=Math.floor(t),r=t-n;return .25*e+.75*(N[n]+(N[n+1]-N[n])*r)/ke},ot=tt(it),st=.42,ct=ot.u.clone().multiplyScalar(Math.cos(st)).addScaledVector(ot.f,Math.sin(st)),lt=ot.f.clone().multiplyScalar(Math.cos(st)).addScaledVector(ot.u,-Math.sin(st));await v();for(let e=0;e<P;e++){!(e&511)&&ne()&&await v();let t=e>=Fe&&e<Fe+Ie,n=Math.PI/2-(.03+at(ze[e])*.94)*Math.PI*2,r=I[e],i=b(e*.71+3)+b(e*1.93+5)+b(e*2.77+7)-1.5,a=t?19.36:22*(1+i*.05+(r<A?(r%3-1)*.03:0)),o=(b(e*4.1+9)-.5)*(t?0:1.6),s=Math.cos(n)*a,c=Math.sin(n)*a;We.set([ot.r.x*s+ct.x*c+lt.x*o,ot.r.y*s+ct.y*c+lt.y*o,ot.r.z*s+ct.z*c+lt.z*o],e*3)}let ut=new t;ut.setAttribute(`position`,new e(F,3)),ut.setAttribute(`aColor`,new e(Re,3)),ut.setAttribute(`aT`,new e(ze,1)),ut.setAttribute(`aSize`,new e(Be,1)),ut.setAttribute(`aChap`,new e(Ve,1)),ut.setAttribute(`aSeed`,new e(He,1)),ut.setAttribute(`aForm`,new e(Ue,4)),ut.setAttribute(`aFin`,new e(We,3));let dt=new Float32Array(y).fill(1),ft=new Float32Array(y),pt=new Float32Array(y).fill(1);nt.forEach((e,t)=>{pt[j(t)]=x(Math.sqrt(520/Math.max(1,e.length)),.4,1)});let mt=Array.from({length:y},()=>new d),ht=()=>{for(let e=0;e<y;e++)mt[e].set(dt[e],ft[e],pt[e],0)};ht();let V={uTime:{value:0},uReveal:{value:0},uNow:{value:1},uScale:{value:400},uPR:{value:1},uCh:{value:mt},uFinal:{value:0},uFocus:{value:60},uAper:{value:.6},uPulseC:{value:new u},uPulseR:{value:0},uPulseA:{value:0},uPulseCh:{value:-5}},gt=new l({uniforms:V,vertexShader:se,fragmentShader:pe,transparent:!0,depthWrite:!1,depthTest:!1,blending:2}),_t=new c,H=new r;_t.add(H);let vt=new t;vt.setAttribute(`position`,new e(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));let yt={uTintA:{value:new n(`#5b6cff`)},uTintB:{value:new n(`#2ec4d6`)},uCore:{value:{x:.5,y:.6}},uAsp:{value:1},uTime:V.uTime,uGlow:{value:1}},bt=new a(vt,new l({uniforms:yt,vertexShader:_e,fragmentShader:ve,depthTest:!1,depthWrite:!1}));bt.frustumCulled=!1,bt.renderOrder=-10,_t.add(bt);let xt=new s(ut,gt);xt.frustumCulled=!1,H.add(xt);let St=[];await v(),D.forEach((n,r)=>{let a=[...Xe.entries()].filter(([e])=>O.get(e)===r).map(([,e])=>e);if(a.length<2){St.push(null);return}let o=[0],s=[],c=a.map(e=>e.distanceTo(a[0])),u=a.map(()=>0);for(c[0]=1/0;o.length<a.length;){let e=-1,t=1/0;c.forEach((n,r)=>{!o.includes(r)&&n<t&&(t=n,e=r)}),o.push(e),s.push(a[u[e]],a[e]),a.forEach((t,n)=>{if(!o.includes(n)){let r=t.distanceTo(a[e]);r<c[n]&&(c[n]=r,u[n]=e)}})}let d=s.length,f=new Float32Array(d*3),p=new Float32Array(d*3),m=new Float32Array(d),h=new Float32Array(d),ee=d/2;for(let e=0;e<d;e++){let t=e>>1,n=s[t*2];f.set([s[e].x,s[e].y,s[e].z],e*3),p.set([n.x,n.y,n.z],e*3),m[e]=t/Math.max(1,ee)*.667,h[e]=e&1}let g=new t;g.setAttribute(`position`,new e(f,3)),g.setAttribute(`aFrom`,new e(p,3)),g.setAttribute(`aOrd`,new e(m,1)),g.setAttribute(`aEnd`,new e(h,1));let _=new l({uniforms:{uColor:{value:we[r]},uOpacity:{value:0},uDraw:{value:1}},vertexShader:ce,fragmentShader:le,transparent:!0,blending:2,depthWrite:!1,depthTest:!1}),te=new i(g,_);te.frustumCulled=!1,H.add(te),St.push(_)});let Ct={uScale:V.uScale,uSize:{value:40},uColor:{value:new n},uP:{value:1}},wt=new t;wt.setAttribute(`position`,new e(new Float32Array(3),3));let Tt=new s(wt,new l({uniforms:Ct,vertexShader:ue,fragmentShader:de,transparent:!0,blending:2,depthWrite:!1,depthTest:!1}));Tt.frustumCulled=!1,Tt.visible=!1,H.add(Tt);let Et=new t;Et.setAttribute(`position`,new e(new Float32Array(108),3)),Et.setAttribute(`aI`,new e(Float32Array.from({length:36},(e,t)=>t/35),1));let Dt={uHead:{value:new u},uDir:{value:new u(1,0,0)},uLen:{value:14},uA:{value:0},uPR:V.uPR,uColor:{value:new n(1,1,1)}},Ot=new s(Et,new l({uniforms:Dt,vertexShader:C,fragmentShader:fe,transparent:!0,blending:2,depthWrite:!1,depthTest:!1}));Ot.frustumCulled=!1,Ot.visible=!1,H.add(Ot);let U={t:9,life:1.3,from:new u,vel:new u,next:5};function kt(e,t){let n=new u(b($*3.1)-.5,(b($*5.3)-.5)*.4,b($*7.7)-.5).normalize(),r=e||new u((b($)-.5)*50,(b($*1.7)-.5)*10,(b($*2.3)-.5)*50);U.from.copy(r).addScaledVector(n,-22),U.vel.copy(n).multiplyScalar(36),U.t=0,Dt.uDir.value.copy(n),Dt.uColor.value.copy(t||Je).lerp(Je,.4),Ot.visible=!0}async function At(n,r,i,a,o){let c=new Float32Array(n*3),u=new Float32Array(n*3),d=new Float32Array(n),f=new Float32Array(n);for(let e=0;e<n;e++)!(e&255)&&ne()&&await v(),r(e,c,u,d,f);let p=new t;p.setAttribute(`position`,new e(c,3)),p.setAttribute(`aColor`,new e(u,3)),p.setAttribute(`aSize`,new e(d,1)),p.setAttribute(`aSeed`,new e(f,1));let m=new l({uniforms:{uTime:V.uTime,uScale:V.uScale,uPR:V.uPR,uFocus:V.uFocus,...o},vertexShader:i,fragmentShader:a,transparent:!0,depthWrite:!1,depthTest:!1,blending:2}),h=new s(p,m);return h.frustumCulled=!1,h}let jt=await At(E.stars,(e,t,n,r,i)=>{let a=b(e*1.1+5)*2-1,o=b(e*2.3+9)*Math.PI*2,s=160+b(e*3.7)*180,c=Math.sqrt(1-a*a);t.set([Math.cos(o)*c*s,a*s,Math.sin(o)*c*s],e*3);let l=b(e*4.4);n.set(l>.8?[1,.85,.7]:l>.5?[.75,.85,1]:[.9,.92,1],e*3),r[e]=1.2+b(e*6.1)**3*3.5,i[e]=b(e*8.8)},me,he,{uAlpha:{value:.75}});_t.add(jt);let Mt={uAlpha:{value:.85},uAper:{value:.6},uMaxPx:{value:16},uNear:{value:0}},Nt=await At(E.dust,(e,t,n,r,i)=>{let a=b(e*.913+4.2)**.9,o=Ee(a,M),s=2+a*7,c=t=>b(e*2.17+t*13.1+1)+b(e*3.31+t*23.7+2)+b(e*5.03+t*37.9+3)-1.5,l=b(e*7.7)<.35;l&&(M.x=-M.x,M.z=-M.z);let u=c(1)*s,d=c(2)*s*.6;M.x+=Math.cos(o)*u-Math.sin(o)*d,M.z+=Math.sin(o)*u+Math.cos(o)*d,M.y+=c(3)*(1+a*2),t.set([M.x,M.y,M.z],e*3);let f=1-a;n.set([.55+f*.35,.6+f*.2,.85-f*.15].map(e=>e*(l?.6:1)),e*3),r[e]=.07+b(e*9.1)*.09,i[e]=b(e*1.9)},w,ge,Mt);H.add(Nt);let Pt=null,Ft=null;A>0&&(Pt=await At(E.nebula+14,(e,t,n,r,i)=>{if(e<14){t.set([(b(e)-.5)*4,(b(e+3)-.5)*2,(b(e+7)-.5)*4],e*3),n.set([1.4,1,.75],e*3),r[e]=5+b(e+1)*9,i[e]=0;return}let a=b(e*1.7+.2);Ee(Ae(a),M),M.x+=(b(e*2.9)-.5)*10,M.y+=(b(e*3.3)-.5)*4,M.z+=(b(e*4.1)-.5)*10,t.set([M.x,M.y,M.z],e*3);let o=a*k,s=-1,c=1/0;for(let[e,t]of Oe){let n=Math.abs(e-o);if(n<c&&(c=n,s=O.has(t)?O.get(t):-1),e>o)break}let l=s>=0?we[s]:Te;n.set([l.r,l.g,l.b],e*3),r[e]=9+b(e*5.5)*16,i[e]=b(e*6.6)},w,ge,Ft={uAlpha:{value:.07},uAper:{value:0},uMaxPx:{value:380},uNear:{value:0}}),H.add(Pt));let It=null;E.near&&(It=await At(E.near,(e,t,n,r,i)=>{let a=b(e*3.3+1)*Math.PI*2,o=8+Math.sqrt(b(e*5.1+2))*85;t.set([Math.cos(a)*o,(b(e*7.9+3)-.5)*(14+o*.5),Math.sin(a)*o],e*3);let s=Math.floor(b(e*2.2)*Math.max(1,A));z.copy(we[s]||Te).lerp(Je,.45),n.set([z.r,z.g,z.b],e*3),r[e]=.12+b(e*6.6)*.22,i[e]=b(e*9.4)},w,ge,{uAlpha:{value:.55},uAper:{value:1.1},uMaxPx:{value:70},uNear:{value:1}}),H.add(It)),await v();let W=new o(50,1,.5,900),Lt=(e,t)=>{let n=/^(\d{4})-(\d{2})/.exec(e||``);return n?x(((t?Date.UTC(+n[1],+n[2],0):Date.UTC(+n[1],n[2]-1,1))-Ce)/864e5/k,0,1):null},Rt=D.map((e,t)=>Lt(e.period?.start,!1)??t/Math.max(1,A)),zt=D.map(e=>{let t=/^(\d{4})-(\d{2})/.exec(e.period?.end||``);return t?x((Date.UTC(+t[1],+t[2],0)-Ce)/864e5/k,.02,1):1}),Bt=[...document.querySelectorAll(`.step`)],Vt=Bt.map(e=>e.dataset.kind||`chapter`),Ht=Bt.map(e=>e.dataset.ch!=null&&D[+e.dataset.ch]?+e.dataset.ch:-1),Ut=new n(`#6a5cff`),Wt=new n(`#4f8cff`),Gt=new n(`#ff9e5e`),G=!1,Kt=[];function qt(){Kt.length=0;let e=window.innerWidth/Math.max(1,window.innerHeight);G=e<.9;let t=G?1.55/Math.max(.45,e)*.62:1,n=G?92*Math.min(1.25,.5/Math.max(.4,e)):80,r=G?.98:.82,i={pos:new u(0,Math.sin(r),Math.cos(r)).multiplyScalar(n),look:new u(0,-2,0),ox:G?0:.2,oy:G?-.24:0,t:1,show:1,ap:.55,tint:Ut},a={pos:new u(46,22,-40).multiplyScalar(t*(G?.9:.95)),look:new u(0,0,0),ox:G?0:.24,oy:G?-.3:0,t:1,show:1,ap:.7,tint:Wt},o=G?22/(.466*Math.max(.42,e))/.92:22/.466/.94,s={pos:it.clone().multiplyScalar(o),look:new u(0,0,0),ox:0,oy:G?.02:0,t:1,show:1,ap:.12,tint:Gt},c=[];D.forEach((e,t)=>{let{c:n,dir:r,D:i}=$e[t];c.push({pos:n.clone().addScaledVector(r,i*(G?1.75:1.12)),look:n.clone(),ox:G?0:.22,oy:G?-.26:0,t:zt[t],show:(Math.min(Rt[t],zt[t])+zt[t])/2,ap:1,tint:we[t]})}),Bt.forEach((e,t)=>{let n=Vt[t];Kt.push(n===`hero`?i:n===`impact`?a:n===`cta`?s:c[Ht[t]]||i)})}let Jt=[...document.querySelectorAll(`.chapter, .impact-sec`)].map(e=>({sec:e,panel:e.querySelector(`.panel, .impact-inner`),top:0,bottom:0})),K=[],Yt=0;function Xt(){let e=window.innerHeight,t=document.querySelector(`.chapter .panel`)?.getBoundingClientRect();Yt=!G&&t?t.right+8:0;let n=Math.max(1,document.documentElement.scrollHeight-e);for(let e of Jt){let t=e.sec.getBoundingClientRect();e.top=t.top+window.scrollY,e.bottom=t.bottom+window.scrollY}K=Bt.map((t,r)=>{let i=t.getBoundingClientRect(),a=i.top+window.scrollY,o=i.bottom+window.scrollY,s=r===0?0:Math.min(n,Math.max(0,a-e*(G?.05:.2)));return[s,r===0?0:Math.min(n,Math.max(s,o-e*.92))]});for(let e=1;e<K.length;e++)K[e][0]=Math.max(K[e][0],K[e-1][1]+1),K[e][1]=Math.max(K[e][1],K[e][0])}function Zt(){let e=window.scrollY;for(let t=0;t<K.length;t++){let[n,r]=K[t];if(e<=r)return e>=n||t===0?t:t-1+(e-K[t-1][1])/Math.max(1,n-K[t-1][1])}return K.length-1}let Qt=document.documentElement,$t=document.getElementById(`playhead`),en=document.getElementById(`scrub-date`),tn=document.getElementById(`scrub-title`),nn=[...document.querySelectorAll(`.scrubber [data-ch]`)],rn=document.getElementById(`scrub-range`),an=h(Ce+k*864e5),on=`${h(Ce)} – ${an}`,sn=``,cn=-2,ln=0,un=[`Jan`,`Feb`,`Mar`,`Apr`,`May`,`Jun`,`Jul`,`Aug`,`Sep`,`Oct`,`Nov`,`Dec`],dn=D.map(e=>{let t=e=>{let t=/^(\d{4})-(\d{2})/.exec(e||``);return t?[+t[1],t[2]-1]:null},n=t(e.period?.start),r=t(e.period?.end);return!n||!r?n?`${un[n[1]]} ${n[0]}`:``:n[0]===r[0]?n[1]===r[1]?`${un[n[1]]} ${n[0]}`:`${un[n[1]]}–${un[r[1]]} ${n[0]}`:`${un[n[1]]} ${n[0]} – ${un[r[1]]} ${r[0]}`}),fn=document.getElementById(`labels`),pn=new Map((_.repos||[]).map(e=>[e.id,e])),mn=[],hn=D.map((e,t)=>{let n=(_.repos||[]).some(e=>typeof e.featured==`boolean`);return[...Xe.keys()].filter(e=>O.get(e)===t).filter(e=>{let t=pn.get(e);return!n||t&&(t.featured||t.public&&t.url)}).sort((e,t)=>(Ke.get(t)?.n||0)-(Ke.get(e)?.n||0)).slice(0,6).map((t,n)=>{let r=document.createElement(`span`);r.className=`lbl`,r.style.setProperty(`--c`,e.color||`#fff`);let i=pn.get(t),a=String(i?.label??``).replace(/^Private\s*·\s*/,``);return a.length>30&&(a=a.slice(0,29)+`…`),r.textContent=a,i&&!i.public&&r.classList.add(`priv`),fn.appendChild(r),{el:r,id:t,rank:n,w:0}})});hn.flat().forEach(e=>{e.w=20+e.el.textContent.length*7.25}),await v();let gn=new IntersectionObserver(e=>e.forEach(e=>{e.isIntersecting&&e.target.classList.remove(`pre`)}),{threshold:.12}),_n=[...document.querySelectorAll(`.panel, .cta-inner, .impact-inner`)];_n.forEach(e=>gn.observe(e));let vn=document.querySelector(`.scrubber`),q=0,J=0,yn=1,Y={ox:0,oy:0};function bn(e){let t=window.innerWidth,n=window.innerHeight;!e&&t===q&&Math.abs(n-J)<140?Xt():(q=t,J=n,yn=Math.min(window.devicePixelRatio||1,E.dpr),T.setPixelRatio(yn),T.setSize(t,n,!1),W.aspect=t/n,yt.uAsp.value=t/n,V.uPR.value=yn,V.uScale.value=n*yn*.5/Math.tan(W.fov*Math.PI/360),qt(),Xt(),xn(),Sn())}function xn(){ln=document.querySelector(`.scrub-track`)?.clientWidth||0}function Sn(){W.setViewOffset(q,J,-Y.ox*q,-Y.oy*J,q,J),W.updateProjectionMatrix()}if(window.addEventListener(`resize`,()=>bn(!1),{passive:!0}),document.fonts?.ready&&document.fonts.ready.then(Xt),window.addEventListener(`load`,Xt),window.ResizeObserver){let e=0;new ResizeObserver(()=>{e||(e=requestAnimationFrame(()=>{e=0,Xt()}))}).observe(document.getElementById(`story`))}let Cn=0,wn=0,Tn=0,En=0;window.addEventListener(`pointermove`,e=>{e.pointerType===`mouse`&&(Tn=e.clientX/q-.5,En=e.clientY/J-.5)},{passive:!0});let X=new u,Z=new u,Q=new u,Dn=new u,On=new Float32Array(y),kn=new n().copy(Ut),An=new n,jn=0,Mn=0,$=0,Nn=!0,Pn=1,Fn=1,In=-1,Ln=-1,Rn=9,zn=.55,Bn=!1,Vn=D.map(()=>1),Hn=0,Un=0,Wn=!1,Gn=performance.now();await v(),bn(!0);function Kn(e,t){let n=Ht[e];n<0?t.fill(1):(t.fill(.24),t[j(n)]=1.25)}let qn=new Float32Array(y),Jn=new Float32Array(y),Yn=0,Xn=0,Zn=!1,Qn=-1,$n=!1,er=!1,tr=()=>{$n=!0};for(let e of[`scroll`,`pointerdown`,`pointermove`,`keydown`,`touchstart`,`wheel`])window.addEventListener(e,tr,{passive:!0,once:!0});function nr(e){jn=requestAnimationFrame(nr);let t=Yn?(e-Yn)/1e3:.016;Yn=e,Xn++;let n=(!$n&&er?3:Zn?2:1)*(xe?3:1);if(window.scrollY===Qn&&Xn%n!==0)return;Qn=window.scrollY;let r=Math.min(.05,Mn?(e-Mn)/1e3:.016);Mn=e,$+=r,V.uTime.value=$;let i=window.scrollY;for(let e of Jt){let t={top:e.top-i,bottom:e.bottom-i};if(t.bottom<-50||t.top>J)continue;let n=t.bottom<J*.42;e.gone!==n&&e.panel&&(e.gone=n,e.panel.classList.toggle(`gone`,n))}let a=window.scrollY>J*.12;a!==Bn&&(Bn=a,Qt.classList.toggle(`scrolled`,a)),$>2&&!Wn&&ie()<0&&(Hn+=t,Un++,Un>=90&&(Hn/Un>1/40&&(Wn=!0,E={...oe[0]},Pt&&(Pt.visible=!1),It&&(It.visible=!1),document.documentElement.classList.remove(`hq`),bn(!0)),Hn=0,Un=0));let o=(e-Gn)/1e3-.15,s=x(o/2.6,0,1),c=s<1?1-(1-s)**2.2:1;V.uReveal.value=s<1?c:1.1;let l=x(Zt(),0,Kt.length-1),u=Math.floor(l),d=Math.min(Kt.length-1,u+1),f=re(l-u),p=Kt[u],m=Kt[d];Q.lerpVectors(p.pos,m.pos,f),Q.y+=Math.sin(Math.PI*f)*p.pos.distanceTo(m.pos)*.18,Dn.lerpVectors(p.look,m.look,f),H.rotation.y=$*.012,H.updateMatrixWorld(),Q.applyMatrix4(H.matrixWorld),Dn.applyMatrix4(H.matrixWorld),Cn=S(Cn,Tn,2,r),wn=S(wn,En,2,r),Q.x+=Cn*4,Q.y-=wn*3;let ee=x(o/3.4,0,1);if(ee<1&&l<.5){let e=1-(1-ee)**3,t=M.copy(Q).sub(Dn),n=(1-e)*1.6,r=Math.cos(n),i=Math.sin(n),a=t.x*r-t.z*i,o=t.x*i+t.z*r;t.set(a,t.y*(.3+.7*e),o).multiplyScalar(1+(1-e)*.6),Q.copy(Dn).add(t)}Nn&&(X.copy(Q),Z.copy(Dn),Nn=!1,Y.ox=p.ox+(m.ox-p.ox)*f,Y.oy=p.oy+(m.oy-p.oy)*f,Sn());let g=ee<1&&l<.5?8:2.6;X.x=S(X.x,Q.x,g,r),X.y=S(X.y,Q.y,g,r),X.z=S(X.z,Q.z,g,r),Z.x=S(Z.x,Dn.x,3,r),Z.y=S(Z.y,Dn.y,3,r),Z.z=S(Z.z,Dn.z,3,r),W.position.copy(X),W.lookAt(Z);let te=p.ox+(m.ox-p.ox)*f,v=p.oy+(m.oy-p.oy)*f+(G&&u!==d?Math.sin(Math.PI*f)*.42:0);Math.abs(te-Y.ox)+Math.abs(v-Y.oy)>1e-4&&(Y.ox=S(Y.ox,te,3,r),Y.oy=S(Y.oy,v,3,r),Sn()),V.uFocus.value=X.distanceTo(Z),zn=S(zn,p.ap+(m.ap-p.ap)*f,3,r),V.uAper.value=zn,Mt.uAper.value=zn*.8,An.copy(p.tint).lerp(m.tint,f),kn.r=S(kn.r,An.r,2.5,r),kn.g=S(kn.g,An.g,2.5,r),kn.b=S(kn.b,An.b,2.5,r),yt.uTintA.value.copy(kn),M.copy(Z).project(W),yt.uCore.value.x=M.x*.5+.5,yt.uCore.value.y=M.y*.5+.5,Kn(u,qn),Kn(d,Jn);for(let e=0;e<y;e++)On[e]=qn[e]+(Jn[e]-qn[e])*f,dt[e]=S(dt[e],On[e],4,r);let ne=!1;for(let e=0;e<A&&e<y;e++){let t=(Ht[u]===e?1-f:0)+(Ht[d]===e?f:0),n=s<1?0:x((t-.45)/.45,0,1),i=j(e);ft[i]=Math.abs(ft[i]-n)<.002?n:S(ft[i],n,n>ft[i]?1.5:2.4,r),ft[i]!==n&&(ne=!0)}let ae=x(((Vt[u]===`cta`?1-f:0)+(Vt[d]===`cta`?f:0)-.35)/.5,0,1),se=V.uFinal.value;V.uFinal.value=Math.abs(se-ae)<.002?ae:S(se,ae,ae>se?1.2:2.4,r),V.uFinal.value!==ae&&(ne=!0);let ce=0;for(let e=0;e<y;e++)ce=Math.max(ce,ft[e]);Mt.uAlpha.value=.85*(1-.6*V.uFinal.value)*(1-.35*ce),Ft&&(Ft.uAlpha.value=.07*(1-.85*ce));let le=p.t+(m.t-p.t)*f;Pn=S(Pn,le,4,r);let ue=p.show+(m.show-p.show)*f;Fn=Math.abs(Fn-ue)<.001?ue:S(Fn,ue,5,r);let de=s<1?Math.min(Fn,c):Fn;V.uNow.value=s<1?1.1:Pn,St.forEach((e,t)=>{if(!e)return;let n=+(c>=zt[t]-.05),i=t===Ln;Vn[t]=i?Math.min(1,Vn[t]+r/1.8):1,e.uniforms.uDraw.value=Vn[t];let a=(1-ft[j(t)])*(1-V.uFinal.value);e.uniforms.uOpacity.value=n*a*(i?.75:x(.06+(dt[j(t)]-.2)*.5,.03,.55))}),$t.style.transform=`translateX(${(de*ln).toFixed(1)}px)`;let C=Math.round(l),fe=Math.abs(l-C)<.35?Ht[C]:-1,pe=Math.abs(l-C)<.35?Vt[C]:``,me=s<1?h(Ce+de*k*864e5):fe>=0?dn[fe]:pe===`impact`?on:pe===`hero`||pe===`cta`?`Now · ${an}`:h(Ce+de*k*864e5);me!==sn&&(en.textContent=me,sn=me);let he=fe>=0?fe:pe===`impact`&&s>=1?-9:-1;if(he!==cn&&(cn=he,rn)){if(he===-9)rn.style.transform=`translateX(0) scaleX(1)`,rn.style.opacity=`1`;else if(fe>=0){let e=Math.min(Rt[fe],zt[fe]);rn.style.transform=`translateX(${(e*100).toFixed(2)}%) scaleX(${Math.max(.006,zt[fe]-e).toFixed(4)})`,rn.style.opacity=`1`}else rn.style.opacity=`0`}let w=Math.abs(l-C)<.2?Ht[C]:-1;if(w!==Ln&&(Ln=w,w>=0&&s>=1&&(Rn=0,Vn[w]=0,V.uPulseC.value.copy($e[w].c),kt($e[w].c,we[w]),Tt.position.copy($e[w].c),Ct.uColor.value.copy(we[w]),Ct.uSize.value=$e[w].rad*7+18,V.uPulseCh.value=j(w))),Rn+=r,U.next-=r,U.next<=0&&s>=1&&(kt(null,null),U.next=7+b($)*6),U.t<U.life){U.t+=r;let e=U.t/U.life;Dt.uHead.value.copy(U.from).addScaledVector(U.vel,U.t),Dt.uA.value=Math.sin(Math.PI*x(e,0,1))*.9,Dt.uLen.value=6+12*Math.min(1,e*3)}else Ot.visible&&(Ot.visible=!1);if(V.uPulseR.value=Rn*20,V.uPulseA.value=Rn<4?Math.exp(-Rn*1.2):0,Tt.visible=Rn<1.6,Ct.uP.value=x(1-(1-Rn/1.6)**2.2,0,1),C!==In){In=C;let e=Ht[C],t=Vt[C];tn.textContent=e>=0?`${String(e+1).padStart(2,`0`)} · ${D[e].title}`:t===`impact`?_.impact?.title||``:t===`cta`?`Now`:_.person?.name||``,nn.forEach(t=>t.classList.toggle(`on`,+t.dataset.ch===e)),vn?.style.setProperty(`--accent`,e>=0?D[e].color:`#7dd3fc`)}let ge=Math.abs(l-C)<.42?Ht[C]:-1,_e=ge>=0?(1-Math.abs(l-C)/.42)*re(x((ft[j(ge)]-.85)/.15,0,1)):0;mn.length=0,hn.forEach((e,t)=>{for(let n of e){if(!(t===ge&&s>=1&&_e>.01&&n.rank<(G?3:5))){n.vis&&(n.el.style.opacity=`0`,n.vis=!1);continue}M.copy(rt.get(n.id)||Xe.get(n.id)).applyMatrix4(H.matrixWorld).project(W);let e=(M.x*.5+.5)*q,r=(-M.y*.5+.5)*J,i=n.w,a=r-12,o=e+i>q-6,c=o?e-i:e;if(o!==!!n.flip&&(n.flip=o,n.el.classList.toggle(`flip`,o)),c<6&&(c=6),c+i>q-6&&(c=q-6-i),M.z>1||e<0||e>q||c<Yt||r<8||r>J-90||mn.some(e=>c<e.x+e.w&&c+i>e.x&&a<e.y+e.h&&a+24>e.y)){n.vis&&(n.el.style.opacity=`0`,n.vis=!1);continue}mn.push({x:c,y:a,w:i,h:24}),n.el.style.transform=`translate(${c.toFixed(1)}px, ${r.toFixed(1)}px)`;let l=_e.toFixed(2);n.o!==l&&(n.o=l,n.el.style.opacity=l),n.vis=!0}}),er=s>=1&&o>3.5,Zn=s>=1&&!ne&&Rn>1.7&&U.t>=U.life&&X.distanceToSquared(Q)<.002&&Math.abs(Pn-le)<.002,ht(),T.render(_t,W),Qt.classList.contains(`gl-on`)||Qt.classList.add(`gl-on`)}function rr(){jn||(Mn=0,jn=requestAnimationFrame(nr))}function ir(){jn&&(cancelAnimationFrame(jn),jn=0)}document.addEventListener(`visibilitychange`,()=>document.hidden?ir():rr()),te.addEventListener(`webglcontextlost`,e=>{e.preventDefault(),ir(),m(`webgl context lost`)});let ar=document.querySelector(`.scrub-track`);ar?.addEventListener(`click`,e=>{if(e.target.closest(`.mark`))return;let t=ar.getBoundingClientRect(),n=(e.clientX-t.left)/t.width,r=0,i=1/0;D.forEach((e,t)=>{let a=Math.abs((Rt[t]+zt[t])/2-n);a<i&&(i=a,r=t)}),document.getElementById(`ch-${D[r].id}`)?.scrollIntoView({behavior:`smooth`})}),await v();let or=!!T.compileAsync&&T.extensions.has(`KHR_parallel_shader_compile`),sr=[];_t.traverse(e=>{e.material&&sr.push(e)});for(let e of sr){try{if(or?await T.compileAsync(e,W,_t):T.compile(e,W,_t),xe){let e=T.getContext();for(let t of T.info.programs||[])t.program&&!t._linked&&(t._linked=!0,e.getProgramParameter(t.program,e.LINK_STATUS))}else{await v();let t=e.visible;e.visible=!0,T.render(e,W),e.visible=t}}catch{}await v()}for(let e of _n)e.getBoundingClientRect().top>window.innerHeight&&e.classList.add(`pre`);Gn=performance.now(),rr();let cr=window.requestIdleCallback||(e=>setTimeout(()=>e({timeRemaining:()=>8}),120)),lr=Jt.map(e=>e.sec),ur=()=>{let e=lr.shift();e?(e.classList.add(`cv-on`),e.offsetHeight,cr(ur,{timeout:1500})):Xt()};cr(ur,{timeout:2500})}export{xe as start};