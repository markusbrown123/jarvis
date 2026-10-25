/**
 * The scenes. Each is GLSL that defines how the world looks and where its
 * ground line runs; the shared layers in glsl.ts then put Markus's projects
 * on top of it. GSTYLE is how a Roblox game is drawn (0 tower, 1 launch
 * vehicle, 2 crystal, 3 lattice mast); LSTYLE is how an Automaton lead is
 * drawn (0 firefly, 1 fleet ship, 2 lit window, 3 rising lantern).
 */

export type SceneDef = { id: string; name: string; code: string }

export const SCENES: SceneDef[] = [
  {
    id: 'nebula-station',
    name: 'Nebula · deep-space station',
    code: /* glsl */ `
const int GSTYLE=1; const int LSTYLE=1;
float groundAt(float x){ return -.235+.011*sin(x*5.+uSeed.x*9.)+.007*sin(x*13.+uSeed.y*5.); }
vec3 sceneTint(){ return vec3(.7,.5,1.); }
vec3 sceneBG(vec2 p,float t){
  vec2 q=p*1.5+uSeed.xy*37.;
  vec2 w=vec2(fbm(q*.8+vec2(0.,t*.006)),fbm(q*.8+vec2(5.2,1.3)-t*.005));
  float n=fbm(q+2.2*w);
  float n2=fbm(q*2.1-w*1.7+7.);
  vec3 c=uB*pow(smoothstep(.36,.9,n),2.)*.9;
  c+=uA*pow(smoothstep(.48,.96,n2),3.)*.6;
  c+=uC*pow(smoothstep(.43,.93,w.x*w.y*3.),2.)*.4;
  c*=1.-.6*smoothstep(.45,.75,fbm(q*3.2+11.));
  c+=stars(p);
  vec2 sp=vec2(mix(-.36,.36,uSeed.z),.21);
  vec2 e=(p-sp)*vec2(1.,2.7);
  float rr=length(e);
  float ang=atan(e.y,e.x)+t*.02;
  float ring=aa(abs(rr-.085)-.0045);
  float ma=abs(mod(ang+PI/6.,PI/3.)-PI/6.);
  float spokes=aa(rr*sin(ma)-.0015)*step(rr,.085);
  float hub=aa(rr-.014);
  c=mix(c,vec3(.01,.012,.02),max(ring,max(spokes,hub))*.95);
  float lights=step(.7,h11(floor(ang*18.)+uSeed.w*9.))*aa(abs(rr-.085)-.0018);
  c+=vec3(1.,.8,.5)*lights*.8+uB*exp(-rr*9.)*.12;
  float gy=groundAt(p.x);
  float cell=floor(p.x*28.);
  float bump=step(.55,h11(cell+uSeed.w*20.))*(.006+.02*h11(cell*1.7));
  float mask=aa(p.y-gy-bump);
  float dd=gy-p.y;
  vec3 deck=vec3(.010,.012,.018)+uB*.05*exp(-max(dd,0.)*10.);
  deck+=uA*.03*step(.47,abs(fract(p.x*24.)-.5))*step(0.,dd);
  c=mix(c,deck,mask);
  c+=vec3(1.,.85,.6)*step(.8,h21(floor(vec2(p.x*260.,(p.y-gy)*260.))))*step(0.,p.y-gy)*step(p.y-gy,bump)*.8;
  c+=uB*lineD(dd,px*1.2)*.5;
  return c;
}`,
  },
  {
    id: 'neon-megacity',
    name: 'Neon megacity at night',
    code: /* glsl */ `
const int GSTYLE=0; const int LSTYLE=2;
float groundAt(float x){ return -.235; }
vec3 sceneTint(){ return vec3(1.,.3,.8); }
vec3 sceneBG(vec2 p,float t){
  float hz=-.235;
  vec3 c=mix(uVoid*.8,uB*.2,smoothstep(.5,-.2,p.y));
  c+=uC*.16*exp(-abs(p.y-hz-.05)*8.);
  c+=uB*.16*fbm(vec2(p.x*2.4+t*.008,p.y*5.5)+uSeed.xy*20.)*smoothstep(.15,-.2,p.y);
  c+=stars(p)*.4*smoothstep(-.05,.3,p.y);
  for(int L=0;L<3;L++){
    float fl=float(L);
    float k=fl/2.;
    if(L>0) c=mix(c,uB*.09+uVoid,.3);
    float sc=mix(8.,19.,k)*(.9+.2*uSeed.y);
    float x=(p.x+t*(.002+.006*k))*sc+fl*31.+uSeed.x*50.;
    float id=floor(x), fx=fract(x);
    float hh=h11(id*1.7+fl*9.1);
    float H=hz+(.06+.27*pow(hh,1.7))*mix(.8,1.2,k);
    float bw=step(.07,fx)*step(fx,.93);
    float inside=bw*step(p.y,H)*step(hz,p.y);
    c=mix(c,mix(uB*.06,vec3(0.),k)+vec3(.003),inside);
    float rows=mix(95.,52.,k), cols=mix(4.,6.,k);
    float wy=floor((p.y-hz)*rows), wx=floor(fx*cols);
    float on=step(.58,h21(vec2(id*3.1+wx,wy)+fl*7.1));
    float tg=h21(vec2(id,wx+wy*.3));
    vec3 wc=tg<.4?uA:(tg<.7?uC:vec3(1.,.82,.55));
    float cell=step(.2,fract(fx*cols))*step(.2,fract((p.y-hz)*rows));
    c+=wc*on*cell*inside*mix(.22,.5,k)*(.8+.2*sin(t*1.5+id*3.+wy));
    c+=mix(uA,uC,h11(id))*lineD(p.y-H,.0012)*bw*(.4+.3*fl)*.5;
    float sg=step(.82,h11(id*5.3+fl))*step(.35,fx)*step(fx,.45)*inside*step(p.y,H-.01)*step(hz+.03,p.y);
    c+=mix(uA,uC,h11(id+2.))*sg*.55;
  }
  if(p.y<hz){
    float d=hz-p.y;
    vec3 st=vec3(.004,.005,.008)+uB*.04*exp(-d*12.);
    float refl=fbm(vec2(p.x*80.,d*6.+t*.05))*exp(-d*7.);
    st+=(uC*.2+uA*.12)*refl*(.55+.45*sin(p.x*40.+t));
    for(int k=0;k<3;k++){
      float fk=float(k);
      float ly=hz-.018-.028*fk;
      float dir=(k%2==0)?1.:-1.;
      float s=fract(p.x*2.2+dir*t*.1*(1.+fk*.3)+fk*.31);
      float streak=smoothstep(0.,.02,s)*exp(-s*30.);
      vec3 lc=dir>0.?vec3(1.,.1,.1):vec3(1.,.9,.7);
      st+=lc*exp(-abs(p.y-ly)*420.)*streak*.8;
    }
    c=st;
  }
  vec2 rp=vec2(p.x*90.+p.y*14.,p.y*2.+t*3.);
  float rc=floor(rp.x), rf=fract(rp.x);
  float rain=step(.5,h11(rc))*smoothstep(0.,.08,rf)*(1.-smoothstep(.08,.16,rf))*step(.6,fract(rp.y+h11(rc)*5.));
  c+=vec3(.5,.65,.9)*rain*.05;
  return c;
}`,
  },
  {
    id: 'alien-terrain',
    name: 'Alien terrain · twin moons',
    code: /* glsl */ `
const int GSTYLE=3; const int LSTYLE=0;
float groundAt(float x){ return -.235+.05*fbm1(x*1.7+uSeed.x*30.); }
vec3 sceneTint(){ return vec3(.6,1.,.4); }
vec3 sceneBG(vec2 p,float t){
  vec3 c=mix(uVoid,uB*.26,smoothstep(.45,-.25,p.y));
  c+=uC*.22*exp(-abs(p.y+.04)*7.);
  c+=stars(p)*smoothstep(-.1,.25,p.y);
  vec2 m1=vec2(mix(-.4,.4,uSeed.z),.24);
  float d1=length(p-m1);
  c=mix(c,mix(uC*.6,vec3(.9),.35)*(.35+.65*fbm((p-m1)*40.)),aa(d1-.07)*.85);
  c+=uC*exp(-d1*8.)*.12;
  vec2 m2=m1+vec2(.19,.1);
  c=mix(c,uA*.5,aa(length(p-m2)-.025)*.8);
  for(int k=0;k<3;k++){
    float fk=float(k);
    vec2 rc=vec2(mix(-.5,.5,h11(fk*3.3+uSeed.x*5.)),.1+.12*h11(fk*7.1+uSeed.y*5.));
    rc.y+=.008*sin(t*.3+fk*2.);
    vec2 d=(p-rc)*vec2(1.,2.2);
    float rock=aa(length(d)-.04*(1.+.3*fk)+.012*fbm(p*50.));
    c=mix(c,vec3(.01,.012,.016)+uB*.03,rock*step(p.y,rc.y+.005));
    c+=uA*lineD(length(d)-.04*(1.+.3*fk),.0008)*.3*step(p.y,rc.y)*0.;
    c+=uA*exp(-max(rc.y-p.y,0.)*40.)*exp(-abs(p.x-rc.x)*30.)*.05*step(p.y,rc.y);
  }
  for(int L=0;L<4;L++){
    float fl=float(L);
    float k=fl/3.;
    if(L>0) c=mix(c,uB*.12+uC*.04,.12);
    float sc=mix(.9,3.2,k);
    float ry=mix(.03,-.2,k)+mix(.16,.09,k)*(fbm1((p.x+t*.004*(.3+k))*sc*2.+fl*17.+uSeed.x*40.)-.5)*2.;
    if(L==3) ry=groundAt(p.x);
    float inside=aa(p.y-ry);
    vec3 body=mix(uB*.2+uC*.07,vec3(.003,.005,.007),pow(k,.7));
    float depth=max(ry-p.y,0.);
    body+=uB*.07*exp(-depth*22.)*(.3+k);
    float spot=step(.975,h21(floor(p.xy*vec2(230.,230.))+fl*5.))*exp(-depth*10.)*(.3+.7*k);
    c=mix(c,body,inside);
    c+=uC*lineD(p.y-ry,.0012)*(1.1-k*.5)*.8;
    c+=uA*spot*inside*(k>.4?1.:.0)*.9;
  }
  return c;
}`,
  },
  {
    id: 'orbital-shipyard',
    name: 'Orbital shipyard',
    code: /* glsl */ `
const int GSTYLE=1; const int LSTYLE=1;
float planetY(float x){ return -2.46+sqrt(max(5.0625-x*x,0.)); }
float groundAt(float x){ return planetY(x); }
vec3 sceneTint(){ return vec3(1.,.6,.3); }
vec3 sceneBG(vec2 p,float t){
  float side=uSeed.w<.5?-1.:1.;
  vec3 c=uVoid*.7+stars(p)*1.1;
  c+=uB*.14*fbm(p*2.+uSeed.xy*20.)*smoothstep(-.3,.4,p.y);
  vec2 pc=vec2(0.,-2.46);
  float r=length(p-pc);
  float sunlit=.4+.6*smoothstep(-.5,.5,p.x*side);
  c+=uB*exp(-max(r-2.25,0.)*55.)*.7*sunlit;
  vec3 s=vec3(.004,.006,.012)+uB*.03;
  float cl=fbm((p-pc)*14.+uSeed.zw*30.);
  s+=uC*.4*pow(smoothstep(.5,.85,cl),3.)*(.45+.55*vn((p-pc)*260.));
  s+=uB*.07*fbm((p-pc)*7.+t*.002);
  c=mix(c,s,aa(r-2.25));
  c+=uB*lineD(r-2.25,.0016)*.9;
  vec2 hc=vec2(side*.52,.13);
  vec2 d=p-hc;
  float rad=length(d);
  float a=atan(d.y,d.x);
  float done=mix(.4,1.4,uSeed.y)*PI;
  float plated=step(0.,a+PI*.5)*step(a+PI*.5,done);
  float onring=smoothstep(.015,.0,abs(rad-.25));
  c=mix(c,vec3(.006,.008,.014),onring*plated*.95);
  c+=uB*lineD(rad-.25,.0016)*.5+uB*lineD(rad-.215,.001)*.35;
  float rib=abs(mod(a,.21)-.105)*rad;
  c+=uA*step(rad,.25)*step(.2,rad)*aa(rib-.0012)*.35*(1.-plated*.7);
  float edgeA=-PI*.5+done;
  float spark=exp(-length(d-vec2(cos(edgeA),sin(edgeA))*.25)*60.)*step(.6,fract(t*.9));
  c+=vec3(1.,.9,.7)*spark*1.4;
  float lights=step(.5,fract(t*.7+h11(floor(a*10.))*3.))*exp(-abs(rad-.25)*230.)*step(.6,h11(floor(a*10.)+1.));
  c+=vec3(1.,.35,.3)*lights*.6;
  float br=abs(p.y-(side*p.x*.5+.2));
  c=mix(c,vec3(.006,.008,.012),aa(br-.004)*step(.15,p.x*side)*step(p.x*side,.88)*step(p.y,.5));
  c+=uA*lineD(br,.0012)*step(.15,p.x*side)*.35;
  return c;
}`,
  },
  {
    id: 'holo-data-ocean',
    name: 'Holographic data-ocean',
    code: /* glsl */ `
const int GSTYLE=2; const int LSTYLE=3;
float swell(float x,float t){ return .008*sin(x*7.+t*.8+uSeed.x*6.)+.005*sin(x*17.-t*.6)+.003*sin(x*31.+t*1.3); }
float groundAt(float x){ return -.2+swell(x,uT); }
vec3 sceneTint(){ return uB; }
vec3 sceneBG(vec2 p,float t){
  float hz=-.2;
  vec3 c=mix(uVoid,uB*.16,smoothstep(.4,hz,p.y));
  c+=uA*.13*exp(-abs(p.y-hz)*14.);
  vec2 sc=vec2(0.,.16);
  float r=length(p-sc);
  float an=atan(p.y-sc.y,p.x-sc.x);
  c+=uA*.18*lineD(r-.33,.0012)+uB*.14*lineD(r-.37,.0009)*step(.5,fract(an*3.+t*.1));
  float cur=pow(vn(vec2(p.x*7.+t*.05,t*.2+uSeed.x*9.)),3.);
  c+=uB*cur*.2*smoothstep(hz,.4,p.y)*(.5+.5*sin(p.y*90.-t*2.));
  c+=stars(p)*.5*smoothstep(hz,.3,p.y);
  float gy=groundAt(p.x);
  if(p.y<gy){
    float dd=max(hz-p.y,.0015)+.002;
    float z=1.6/dd;
    vec2 g=vec2(p.x*z+uSeed.x*41.7,z-t*.6);
    float wx=min(z*px*1.4,.5), wz=min(z*z/1.6*px*1.4,.5);
    float lx=1.-smoothstep(0.,wx,.5-abs(fract(g.x)-.5));
    float lz=1.-smoothstep(0.,wz,.5-abs(fract(g.y)-.5));
    vec2 id=floor(g);
    float pk=step(.93,h21(id+uSeed.xy*50.))*(.5+.5*sin(t*3.+h21(id)*20.));
    float fill=pk*step(.1,fract(g.x))*step(fract(g.x),.9)*step(.1,fract(g.y))*step(fract(g.y),.9);
    float fade=smoothstep(.0,.09,dd);
    vec3 sea=uVoid+uB*.035*(1.-fade*.5);
    sea+=(uA*max(lx,lz)*.5+uC*fill*1.1)*fade;
    sea+=uA*.1*exp(-dd*30.);
    c=sea;
  }
  c+=uA*lineD(p.y-gy,.001)*.8;
  return c;
}`,
  },
  {
    id: 'circuit-megastructure',
    name: 'Circuit-board megastructure',
    code: /* glsl */ `
const int GSTYLE=3; const int LSTYLE=2;
float groundAt(float x){ return -.22; }
vec3 sceneTint(){ return vec3(1.,.8,.3); }
vec3 sceneBG(vec2 p,float t){
  float hz=-.22;
  vec3 c=uVoid+uB*.07*exp(-abs(p.y-hz)*6.);
  vec2 bp=p*vec2(1.,1.)*9.+uSeed.xy*30.;
  vec2 bi=floor(bp), bf=fract(bp)-.5;
  float bh=h21(bi);
  float bt=bh<.4?abs(bf.y):(bh<.8?abs(bf.x):abs(abs(bf.x)-abs(bf.y)));
  c+=uB*.09*(1.-smoothstep(0.,.05,bt))*smoothstep(hz,.3,p.y)*step(.35,h21(bi+3.));
  for(int L=0;L<3;L++){
    float fl=float(L);
    float k=fl/2.;
    if(L>0) c=mix(c,uB*.07+uVoid,.25);
    float sc=mix(5.,11.,k);
    float x=p.x*sc+fl*23.+uSeed.x*40.;
    float id=floor(x), fx=fract(x);
    float H=hz+(.05+.22*pow(h11(id*2.3+fl*5.),1.4))*mix(.9,1.1,k);
    float inside=step(.06,fx)*step(fx,.94)*step(p.y,H)*step(hz,p.y);
    c=mix(c,mix(uB*.05,vec3(0.),k)+vec3(.004),inside);
    float pins=step(.5,fract(p.x*sc*7.))*step(H,p.y)*step(p.y,H+.007)*step(.06,fx)*step(fx,.94);
    c+=uA*pins*.3*(.5+.5*k);
    float rowl=lineD(fract((p.y-hz)*mix(60.,34.,k))-.5,.07)*inside;
    c+=mix(uA,uC,h11(id))*rowl*.3*step(.5,h11(id*3.+floor((p.y-hz)*mix(60.,34.,k))));
    c+=uA*lineD(p.y-H,.0012)*step(.06,fx)*step(fx,.94)*.35;
  }
  if(p.y<hz){
    float dd=hz-p.y;
    float z=1.3/max(dd,.003);
    vec2 g=vec2(p.x*z+uSeed.y*53.3,z+t*.25);
    vec2 id=floor(g), f=fract(g)-.5;
    float h=h21(id+uSeed.xy*10.);
    float w=min(.05+z*px*.9,.4);
    float tr=h<.4?abs(f.y):(h<.8?abs(f.x):abs(abs(f.x)-abs(f.y))*.7);
    float line=1.-smoothstep(w*.5,w,tr);
    float via=step(.9,h)*(1.-smoothstep(.08,.14,length(f)));
    float pulse=step(fract(g.x*.35-t*.5+h*5.),.12)+step(fract(g.y*.35-t*.4+h*3.),.1);
    vec2 cid=floor(g/6.), cf=fract(g/6.);
    float chip=step(.7,h21(cid+uSeed.zw*9.))*(1.-smoothstep(.0,.03,min(min(cf.x,1.-cf.x),min(cf.y,1.-cf.y))-.08));
    float fade=smoothstep(0.,.1,dd);
    vec3 pcb=uVoid+uB*.03+uB*.04*exp(-dd*14.);
    pcb+=(uA*line*.45+uC*pulse*line*.7+uA*via*.7+uB*chip*.25)*fade;
    c=pcb;
  }
  c+=uA*lineD(p.y-hz,.0012)*.6;
  return c;
}`,
  },
  {
    id: 'aurora-ice',
    name: 'Aurora ice world',
    code: /* glsl */ `
const int GSTYLE=2; const int LSTYLE=0;
float groundAt(float x){ return -.215+.02*fbm1(x*3.+uSeed.x*20.); }
vec3 aurora(vec2 p,float t){
  vec3 c=vec3(0.);
  for(int i=0;i<3;i++){
    float fi=float(i);
    float yb=.1+fi*.06+.07*fbm1(p.x*1.6+t*.03+fi*9.+uSeed.x*20.);
    float rays=pow(vn(vec2(p.x*(18.+fi*6.)+fbm1(p.x*2.+t*.05)*4.,t*.1+fi)),2.5);
    float h=smoothstep(yb-.01,yb+.015,p.y)*exp(-(p.y-yb)*(3.5+fi));
    vec3 ac=mix(vec3(.2,1.,.55),mix(uB,uA,fi*.5),fi*.4+.15);
    c+=ac*h*(.15+.85*rays)*.4;
  }
  return c;
}
vec3 sceneTint(){ return vec3(.7,.95,1.); }
vec3 sceneBG(vec2 p,float t){
  vec3 c=mix(uVoid,vec3(.01,.02,.04)+uB*.04,smoothstep(.4,-.2,p.y));
  c+=stars(p)*smoothstep(-.05,.3,p.y);
  c+=aurora(p,t)*smoothstep(-.25,.1,p.y);
  float gy=groundAt(p.x);
  for(int L=0;L<2;L++){
    float fl=float(L);
    float ry=mix(.0,-.14,fl)+mix(.14,.07,fl)*(fbm1((p.x+t*.003*(1.+fl))*mix(2.,3.5,fl)+fl*13.+uSeed.y*30.)-.5)*2.;
    float inside=aa(p.y-ry);
    vec3 body=mix(vec3(.02,.035,.06)+uB*.03,vec3(.006,.01,.016),fl);
    float depth=ry-p.y;
    c=mix(c,body+vec3(.5,.7,.9)*.08*exp(-depth*30.)*(1.-fl),inside);
    c+=vec3(.6,.8,1.)*lineD(p.y-ry,.001)*.4;
  }
  if(p.y<gy){
    vec2 mp=vec2(p.x+.006*sin(p.y*140.+t*.5),2.*gy-p.y);
    vec3 ice=vec3(.008,.016,.026)+uB*.025;
    ice+=aurora(mp,t)*smoothstep(-.25,.1,mp.y)*.45;
    float cn=fbm(p*vec2(5.,10.)+uSeed.xy*30.);
    ice+=vec3(.5,.8,1.)*.05*(1.-smoothstep(0.,.03,abs(cn-.5)));
    c=ice;
  }
  c+=vec3(.6,.85,1.)*lineD(p.y-gy,.0011)*.5;
  return c;
}`,
  },
  {
    id: 'volcanic-forge',
    name: 'Volcanic forge',
    code: /* glsl */ `
const int GSTYLE=3; const int LSTYLE=3;
float groundAt(float x){ return -.235+.03*fbm1(x*2.2+uSeed.x*20.); }
vec3 sceneTint(){ return vec3(1.,.45,.12); }
vec3 sceneBG(vec2 p,float t){
  vec3 lava=vec3(1.,.38,.06);
  vec3 c=mix(vec3(.01,.004,.004),vec3(.1,.026,.01),smoothstep(.3,-.25,p.y));
  float sm=fbm(vec2(p.x*2.,p.y*1.5-t*.03)+uSeed.xy*20.);
  float xv=mix(-.3,.3,uSeed.z);
  c+=lava*.1*sm*smoothstep(.45,-.1,p.y)*exp(-abs(p.x-xv)*2.);
  float peak=.12-abs(p.x-xv)*.85+.02*fbm(vec2(p.x*20.,1.));
  float vol=aa(p.y-peak);
  float glowP=.7+.3*sin(t*.8);
  vec3 vc=vec3(.012,.006,.006);
  float flows=smoothstep(.55,.6,fbm(vec2(p.x*14.+uSeed.w*9.,p.y*4.-t*.02)))*step(.0,peak-p.y)*smoothstep(0.,.05,peak-p.y);
  vc+=lava*flows*.5;
  c=mix(c,vc,vol*step(p.y,peak+.001)*step(-.1,p.y));
  c+=lava*(exp(-length(p-vec2(xv,.12))*14.)*.7*glowP+exp(-length((p-vec2(xv,.12))*vec2(1.,.4))*30.)*.5);
  c+=stars(p)*.2*smoothstep(.2,.5,p.y);
  float ry=-.1+.05*(fbm1(p.x*3.+9.+uSeed.y*20.)-.5)*2.;
  c=mix(c,vec3(.006,.003,.003)+lava*.015,aa(p.y-ry)*step(.0,1.));
  c+=lava*lineD(p.y-ry,.0012)*.25;
  float gy=groundAt(p.x);
  if(p.y<gy){
    vec3 rock=vec3(.01,.005,.004);
    float n=fbm(p*vec2(7.,14.)+uSeed.zw*20.);
    float crack=1.-smoothstep(0.,.035,abs(n-.5));
    float dd=gy-p.y;
    rock+=lava*crack*(.6+.4*sin(t+n*30.))*(.35+.65*exp(-dd*5.));
    rock+=lava*.04*exp(-dd*12.);
    c=rock;
  }
  c+=lava*lineD(p.y-gy,.0011)*.4;
  for(int k=0;k<2;k++){
    float fk=float(k);
    vec2 g=vec2(p.x*(40.+fk*30.),p.y*(18.+fk*10.)-t*(.6+fk*.4));
    vec2 id=floor(g);
    float h=h21(id+fk*13.);
    vec2 o=(h22(id+fk*5.)-.5)*.5;
    float d=length(fract(g)-.5-o);
    c+=lava*step(.8,h)*smoothstep(.07,.0,d)*.8*smoothstep(gy,gy+.1,p.y)*smoothstep(.45,.1,p.y);
  }
  return c;
}`,
  },
  {
    id: 'digital-forest',
    name: 'Digital rain forest',
    code: /* glsl */ `
const int GSTYLE=0; const int LSTYLE=0;
float groundAt(float x){ return -.225; }
vec3 glyphRain(vec2 p,float S,float seed,float t){
  float colId=floor(p.x*S);
  float hs=h11(colId+seed);
  float yy=p.y*S*1.7+t*(.9+hs*1.5);
  float row=floor(yy);
  vec2 uv=vec2(fract(p.x*S),fract(yy));
  vec2 gc=floor(uv*vec2(3.,5.));
  float gl=step(.5,h21(gc+row*3.1+colId*7.))*step(.12,fract(uv.x*3.))*step(.12,fract(uv.y*5.));
  float trail=pow(fract(yy*.07+hs*5.),8.);
  return vec3(gl*trail)*step(.5,hs);
}
vec3 sceneTint(){ return vec3(.3,1.,.5); }
vec3 sceneBG(vec2 p,float t){
  vec3 g=mix(uA,vec3(.35,1.,.6),.55);
  vec3 c=mix(uVoid,uB*.16+vec3(0.,.02,.02),smoothstep(.4,-.25,p.y));
  c+=g*glyphRain(p,38.,1.,t)*.32*smoothstep(-.25,.45,p.y);
  c+=g*glyphRain(p+.1,22.,5.,t*.8)*.2;
  for(int L=0;L<3;L++){
    float fl=float(L);
    float k=fl/2.;
    float sc=mix(5.,11.,k);
    float x=(p.x+t*(.002+.005*k))*sc+fl*19.+uSeed.x*40.;
    float id=floor(x), fx=fract(x)-.5;
    float hh=h11(id*3.1+fl);
    float cx=(hh-.5)*.4;
    float ty=-.225+.11+.14*h11(id+7.)*(1.-.2*k);
    float trunk=step(abs(fx-cx),.025)*step(p.y,ty)*step(-.5,p.y);
    vec2 cp=vec2((fx-cx)/sc*1.5,(p.y-ty)*1.0);
    float cr=.13*(1.-.25*k)+.03*vn(vec2(x*5.,p.y*40.));
    float canopy=aa(length(cp*vec2(1.,1.4))-cr*.55);
    float body=max(trunk,canopy);
    c=mix(c,mix(uB*.04,vec3(0.),k)+vec3(.002,.005,.005),body);
    float rim=lineD(length(cp*vec2(1.,1.4))-cr*.55,.0012)*(.5+.5*sin(t+id));
    c+=g*(rim*.35+trunk*.04)*(.5+.5*k);
    float leaves=step(.9,h21(floor(cp*130.)+id))*canopy;
    c+=g*leaves*.5*(.5+.5*sin(t*2.+id*5.));
  }
  float gy=groundAt(p.x);
  if(p.y<gy){
    float dd=gy-p.y;
    vec3 f=vec3(.004,.008,.008)+uB*.03*exp(-dd*10.);
    f+=g*(1.-smoothstep(0.,.12,abs(fract(p.x*26./(1.+dd*6.)+uSeed.y*5.)-.5)-.44))*.08*exp(-dd*5.);
    f+=g*.05*fbm(vec2(p.x*6.+t*.05,dd*14.));
    c=f;
  }
  c+=g*lineD(p.y-gy,.001)*.3;
  return c;
}`,
  },
  {
    id: 'ringed-planet',
    name: 'Ringed-planet horizon',
    code: /* glsl */ `
const int GSTYLE=1; const int LSTYLE=1;
float groundAt(float x){ return -.25+.018*fbm1(x*5.+uSeed.y*30.)+.006*sin(x*21.); }
vec3 sceneTint(){ return vec3(1.,.8,.5); }
vec4 ringHalf(float rl){
  float m=smoothstep(.42,.43,rl)*(1.-smoothstep(.78,.79,rl));
  float band=.4+.6*fbm1(rl*55.+uSeed.x*10.);
  band*=1.-.85*(smoothstep(.56,.57,rl)*(1.-smoothstep(.6,.61,rl)));
  return vec4(mix(uC,vec3(.9,.8,.7),.3)*band,m*(.2+.4*band));
}
vec3 sceneBG(vec2 p,float t){
  float sgn=uSeed.w<.5?-1.:1.;
  vec3 c=uVoid+stars(p)*1.1;
  c+=uB*.1*fbm(p*2.5+uSeed.xy*20.);
  float R=.2;
  float kk=R/.34;
  vec2 pc=vec2(-sgn*(.36+.1*uSeed.z),.14);
  vec2 d=p-pc;
  mat2 rr=rot(-.35*(uSeed.y-.5)*2.-.18);
  vec2 e=rr*d;
  float rl=length(e*vec2(1.,3.4))/kk;
  vec4 rg=ringHalf(rl);
  if(e.y>0.) c=mix(c,rg.rgb*.7,rg.a);
  float dist=length(d);
  vec3 n=vec3(d/R,sqrt(max(1.-dot(d/R,d/R),0.)));
  vec3 L=normalize(vec3(sgn*.65,.3,.7));
  float diff=max(dot(n,L),0.);
  float band=fbm(vec2(d.y*24.+fbm(d*8.)*2.,d.x*2.5+uSeed.x*9.));
  vec3 pl=mix(uB*.35,uC*.45,band)*(.04+diff*.55);
  pl*=mix(.5,1.,smoothstep(0.,.08,abs(e.y*3.4)-.02));
  c+=uB*exp(-max(dist-R,0.)*60.)*.3;
  c=mix(c,pl,aa(dist-R));
  if(e.y<=0.) c=mix(c,rg.rgb*.8,rg.a);
  float gy=groundAt(p.x);
  vec3 rock=vec3(.008,.009,.012)+uB*.02;
  rock+=uB*.04*fbm(p*vec2(30.,60.));
  float crater=1.-smoothstep(0.,.006,abs(length((fract(p*vec2(9.,18.))-.5)*vec2(1.,.5))-.28)-.01);
  rock+=uB*.04*crater*step(.7,h21(floor(p*vec2(9.,18.))));
  c=mix(c,rock,aa(p.y-gy));
  c+=uB*lineD(p.y-gy,.0012)*.55;
  return c;
}`,
  },
  {
    id: 'bioluminescent-abyss',
    name: 'Bioluminescent abyss',
    code: /* glsl */ `
const int GSTYLE=2; const int LSTYLE=3;
float groundAt(float x){ return -.235+.02*fbm1(x*3.+uSeed.x*20.); }
vec3 sceneTint(){ return vec3(.3,1.,.8); }
vec3 sceneBG(vec2 p,float t){
  vec3 c=mix(vec3(0.,.012,.02)+uB*.02,uB*.14,smoothstep(-.2,.5,p.y)*.7);
  float ray=pow(vn(vec2((p.x+p.y*.45)*9.+t*.04,uSeed.x*10.)),3.);
  c+=uA*.15*ray*smoothstep(-.25,.5,p.y);
  float cau=abs(sin(p.x*60.+fbm(p*8.+t*.1)*8.))*abs(sin(p.y*50.+fbm(p*6.-t*.1)*6.));
  c+=uA*.06*pow(cau,3.)*smoothstep(.1,.5,p.y);
  for(int L=0;L<3;L++){
    float fl=float(L);
    vec2 g=p*vec2(30.+fl*20.,30.+fl*20.)+vec2(0.,-t*(.3+fl*.15))+fl*11.;
    vec2 id=floor(g);
    float h=h21(id);
    float d=length(fract(g)-.5-(h22(id)-.5)*.5);
    c+=vec3(.5,.8,1.)*step(.85,h)*smoothstep(.06,0.,d)*.18/(1.+fl*.5);
  }
  for(int k=0;k<4;k++){
    float fk=float(k);
    vec2 jc=vec2(mix(-.6,.6,h11(fk*5.3+uSeed.x*7.)),.0+.2*h11(fk*2.9+uSeed.y*7.));
    jc.y+=.03*sin(t*.5+fk*3.)+t*0.;
    jc.x+=.03*sin(t*.2+fk*5.);
    float sz=.03+.025*h11(fk*9.1);
    float pulse=.5+.5*sin(t*1.2+fk*2.);
    vec2 jd=(p-jc);
    jd.y/=(1.+.3*pulse);
    float bell=aa(length(jd*vec2(1.,1.5))-sz)*step(0.,jd.y+sz*.1);
    vec3 jcol=mix(uA,uC,h11(fk*3.));
    c+=jcol*bell*(.12+.1*pulse);
    c+=jcol*lineD(length(jd*vec2(1.,1.5))-sz,.0009)*step(0.,jd.y)*.5;
    c+=jcol*exp(-length(p-jc)*18.)*.1;
    for(int tt=0;tt<6;tt++){
      float ft=float(tt);
      float ox=(ft-2.5)*sz*.32;
      float len=sz*(3.+2.*h11(ft+fk*7.));
      float yy=jc.y-p.y;
      float wob=.006*sin(yy*60.-t*2.+ft+fk);
      c+=jcol*lineD(p.x-(jc.x+ox+wob),.0007)*step(0.,yy)*step(yy,len)*(1.-yy/len)*.35;
    }
  }
  float gy=groundAt(p.x);
  for(int L=0;L<2;L++){
    float fl=float(L);
    float x=p.x*mix(22.,34.,fl)+fl*7.+uSeed.y*20.;
    float id=floor(x), fx=fract(x)-.5;
    float hk=gy+.04+.12*h11(id+fl*3.);
    float sw=.012*sin(t*.8+id+p.y*18.);
    float stalk=step(abs(fx+sw*20.),.04)*step(p.y,hk)*step(h11(id*2.1),.55)*step(gy-.05,p.y);
    c=mix(c,vec3(.0,.006,.008)+uB*.02*fl,stalk);
    c+=uA*lineD(fx+sw*20.-.04,.003)*step(p.y,hk)*step(gy,p.y)*.0;
  }
  if(p.y<gy){
    float dd=gy-p.y;
    vec3 sb=vec3(.0,.006,.008)+uB*.02*exp(-dd*14.);
    vec2 g=p*vec2(60.,60.);
    vec2 id=floor(g);
    sb+=mix(uA,uC,h11(id.x))*step(.93,h21(id))*smoothstep(.2,0.,length(fract(g)-.5))*.6*(.6+.4*sin(t*1.5+h21(id)*20.));
    c=sb;
  }
  c+=uA*lineD(p.y-gy,.001)*.25;
  return c;
}`,
  },
  {
    id: 'twin-sun-dunes',
    name: 'Twin-sun dunes',
    code: /* glsl */ `
const int GSTYLE=0; const int LSTYLE=0;
float groundAt(float x){ return -.225+.02*sin(x*3.+uSeed.x*6.)+.012*sin(x*7.3+uSeed.y*6.); }
vec3 sceneTint(){ return vec3(1.,.55,.3); }
vec3 sceneBG(vec2 p,float t){
  vec3 warm=vec3(1.,.42,.2), mag=vec3(.8,.18,.5), ind=vec3(.1,.06,.3);
  warm=mix(warm,uC,.2); mag=mix(mag,uB,.2);
  float sgn=uSeed.w<.5?-1.:1.;
  vec3 c=mix(uVoid+ind*.12,mag*.2+warm*.09,pow(smoothstep(.55,-.1,p.y),1.6));
  c+=ind*.25*smoothstep(.1,.5,p.y);
  c+=stars(p)*smoothstep(.1,.4,p.y);
  vec2 s1=vec2(sgn*mix(.1,.34,uSeed.z),.09);
  vec2 s2=s1+vec2(-sgn*.13,.075);
  float d1=length(p-s1), d2=length(p-s2);
  c+=warm*(exp(-d1*7.)*.28+exp(-d1*40.)*.4);
  c+=mix(mag,vec3(.8,.9,1.),.5)*(exp(-d2*12.)*.16+exp(-d2*70.)*.25);
  c=mix(c,vec3(1.,.82,.6)*.95,aa(d1-.05));
  c=mix(c,vec3(.8,.88,1.)*.85,aa(d2-.02));
  for(int L=0;L<4;L++){
    float fl=float(L);
    float k=fl/3.;
    if(L>0) c=mix(c,mag*.14+warm*.04,.12);
    float f1=mix(1.8,4.5,k), f2=mix(4.1,9.7,k);
    float sh=t*.003*(.4+k);
    float ph1=(p.x+sh)*f1+fl*3.+uSeed.x*6.;
    float ph2=(p.x+sh)*f2+fl*7.;
    float ry=mix(-.02,-.22,k)+.035*sin(ph1)+.018*sin(ph2);
    if(L==3) ry=groundAt(p.x);
    float inside=aa(p.y-ry);
    float slope=cos(ph1)*.035*f1+cos(ph2)*.018*f2;
    float lit=smoothstep(-.1,.1,slope*sgn);
    vec3 body=mix(mag*.2+ind*.1,vec3(.004,.003,.007),pow(k,.8));
    body+=warm*lit*.09*(1.-.5*k);
    body+=mag*.03*fbm(vec2(p.x*20.+t*.02*(fl+1.),p.y*60.));
    c=mix(c,body,inside);
    c+=warm*lineD(p.y-ry,.0012)*(.7-.4*k)*(.25+.75*lit);
  }
  float sand=pow(vn(vec2(p.x*4.-t*.35,p.y*70.)),6.);
  c+=warm*sand*.08*smoothstep(-.25,-.1,p.y);
  return c;
}`,
  },
  {
    id: 'storm-cloud-sea',
    name: 'Storm world · cloud sea',
    code: /* glsl */ `
const int GSTYLE=3; const int LSTYLE=1;
float groundAt(float x){ return -.21+.025*fbm1(x*2.5+uSeed.x*30.); }
vec3 sceneTint(){ return vec3(.6,.7,1.); }
vec3 sceneBG(vec2 p,float t){
  float cyc=floor(t/4.5+uSeed.y*9.);
  float loc=fract(t/4.5+uSeed.y*9.);
  float strike=step(h11(cyc),.8)*exp(-loc*14.)*(.6+.4*sin(loc*90.));
  float bx=mix(-.6,.6,h11(cyc+2.));
  vec3 cool=mix(uB,vec3(.75,.85,1.),.5);
  vec3 c=mix(uVoid,uB*.24,smoothstep(.5,-.15,p.y));
  c+=stars(p)*.3*smoothstep(.2,.5,p.y);
  c+=cool*strike*.5*exp(-abs(p.x-bx)*2.)*smoothstep(-.1,.4,p.y);
  for(int L=0;L<3;L++){
    float fl=float(L);
    float k=fl/2.;
    float sh=(p.x+t*.004*(fl+1.))*(1.8+k*1.5)+fl*7.+uSeed.x*9.;
    float top=mix(.27,-.02,k)+.09*(fbm1(sh)-.5)*2.;
    float inside=smoothstep(0.,.012,top-p.y);
    float tex=fbm(vec2(sh*1.3,p.y*5.+fl*3.));
    vec3 cc=mix(uB*.2,vec3(.01,.012,.02),k)*(.55+.9*tex);
    cc+=cool*.24*exp(-(top-p.y)*26.)*(1.-.3*k)*(.5+.8*tex);
    cc+=cool*strike*.9*exp(-abs(p.x-bx)*2.2)*(.35+.65*tex)*(1.-.4*k);
    c=mix(c,cc,inside);
  }
  float bxx=bx+.04*sin(p.y*30.+cyc)+.02*sin(p.y*77.+cyc*3.);
  float bolt=exp(-abs(p.x-bxx)*700.)*step(p.y,.4)*step(-.12,p.y)*strike;
  c+=vec3(.8,.88,1.)*bolt*1.3+cool*exp(-abs(p.x-bxx)*45.)*strike*.25*step(p.y,.4)*step(-.12,p.y);
  float gy=groundAt(p.x);
  if(p.y<gy){
    float dd=gy-p.y;
    float cd=fbm(vec2(p.x*3.+t*.015,dd*14.)+uSeed.zw*10.);
    vec3 sea=vec3(.01,.012,.018)+uB*.09*cd*exp(-dd*6.);
    sea+=cool*strike*.45*exp(-abs(p.x-bx)*2.)*cd;
    c=sea;
  }
  c+=cool*lineD(p.y-gy,.0013)*.4;
  return c;
}`,
  },
  {
    id: 'crystal-cavern',
    name: 'Crystal cavern',
    code: /* glsl */ `
const int GSTYLE=3; const int LSTYLE=0;
float groundAt(float x){ return -.23+.015*fbm1(x*4.+uSeed.x*20.); }
vec3 shards(vec2 p,float gy){
  vec3 c=vec3(0.);
  float sc=7.;
  float x=p.x*sc+uSeed.x*30.;
  float id0=floor(x);
  for(int dx=-1;dx<=1;dx++){
    float id=id0+float(dx);
    for(int s=0;s<3;s++){
      float fs=float(s);
      float hh=h11(id*3.7+fs*11.1);
      if(hh<.35) continue;
      float cx=(id+.3+.4*h11(id+fs*2.3)-uSeed.x*30.)/sc;
      float hgt=.05+.17*h11(id*1.3+fs*5.7)*(1.-.25*fs);
      float w=.016+.012*h11(id+fs*8.1);
      vec2 q=vec2(p.x-cx,p.y-gy);
      float tilt=(h11(id*2.1+fs)-.5)*.5;
      q.x-=tilt*q.y;
      float d=max(abs(q.x)-w*(1.-clamp(q.y/hgt,0.,1.)),max(-q.y,q.y-hgt));
      vec3 sc2=mix(uA,mix(uB,uC,h11(id+fs)),h11(id*5.+fs));
      float body=aa(d);
      float facet=.55+.45*sign(q.x);
      c+=sc2*body*(.14+.2*(1.-q.y/hgt))*facet;
      c+=sc2*aa(abs(d)-px*.9)*.45;
      c+=sc2*exp(-length(q-vec2(0.,hgt*.55))*30.)*.08;
    }
  }
  return c;
}
vec3 sceneTint(){ return vec3(.9,.4,1.); }
vec3 sceneBG(vec2 p,float t){
  vec3 c=mix(vec3(.01,.006,.016),uB*.08+vec3(.004,.004,.012),smoothstep(.5,-.2,p.y));
  c+=uB*.05*fbm(p*vec2(4.,3.)+uSeed.xy*20.);
  float ceil_=.5-(.1+.2*fbm1(p.x*3.+uSeed.y*20.))-.1*abs(fract(p.x*6.+uSeed.z*9.)-.5)*h11(floor(p.x*6.+uSeed.z*9.))*2.;
  c=mix(c,vec3(.003,.003,.006)+uB*.02,aa(ceil_-p.y)*.0+aa(ceil_-p.y));
  c+=uB*lineD(p.y-ceil_,.0012)*.18;
  float sh=pow(vn(vec2((p.x-p.y*.4)*6.+uSeed.x*9.,t*.03)),3.);
  c+=mix(uA,vec3(1.),.4)*.12*sh*smoothstep(-.25,.4,p.y)*smoothstep(.55,.0,p.y+.2);
  vec2 dm=p*vec2(60.,60.)+vec2(0.,-t*.5);
  vec2 id=floor(dm);
  c+=vec3(.8,.9,1.)*step(.9,h21(id))*smoothstep(.07,0.,length(fract(dm)-.5-(h22(id)-.5)*.4))*.12;
  float gy=groundAt(p.x);
  c+=shards(p,gy);
  if(p.y<gy){
    float dd=gy-p.y;
    vec3 f=vec3(.005,.004,.009)+uB*.03*exp(-dd*10.);
    f+=shards(vec2(p.x,gy+dd*.9),gy)*.45*exp(-dd*5.)*(.7+.3*sin(p.x*90.+t));
    c=f;
  }
  c+=uA*lineD(p.y-gy,.001)*.25;
  return c;
}`,
  },
  {
    id: 'dyson-forge',
    name: 'Dyson swarm · star forge',
    code: /* glsl */ `
const int GSTYLE=1; const int LSTYLE=1;
float groundAt(float x){ return -.215-.07*x*x; }
vec3 sceneTint(){ return vec3(1.,.85,.4); }
vec3 sceneBG(vec2 p,float t){
  float sgn=uSeed.w<.5?-1.:1.;
  vec2 sc=vec2(sgn*mix(.12,.34,uSeed.z),.17);
  vec2 d=p-sc;
  float r=length(d);
  float an=atan(d.y,d.x);
  vec3 c=uVoid+stars(p)*.9;
  c+=uB*.07*fbm(p*2.2+uSeed.xy*20.);
  float rays=pow(vn(vec2(an*5.+t*.1,r*3.)),3.);
  vec3 sunc=mix(uC,vec3(1.,.9,.7),.45);
  c+=sunc*(exp(-r*8.)*.35+exp(-r*3.)*.1*(.5+rays));
  float prom=fbm(vec2(an*3.,r*30.-t*.4));
  c+=sunc*smoothstep(.5,.9,prom)*exp(-abs(r-.062)*40.)*.5*step(.06,r);
  vec3 disc=sunc*(.7+.3*fbm(d*60.+t*.05));
  c=mix(c,disc*1.1,aa(r-.06));
  for(int k=0;k<3;k++){
    float fk=float(k);
    float tilt=.5+fk*.35+uSeed.y*.3;
    mat2 rm=rot(tilt+fk);
    vec2 e=rm*d;
    float rl=length(e*vec2(1.,2.2+fk*.8));
    float R=.12+fk*.065;
    float ra=atan(e.y*(2.2+fk*.8),e.x);
    float seg=step(.18,fract(ra*(5.+fk*3.)/PI+t*.02*(1.+fk)));
    float band=aa(abs(rl-R)-.0045-.0012*fk)*seg;
    float front=smoothstep(-.2,.6,e.y*(2.2+fk*.8));
    vec3 pc=mix(vec3(.004,.005,.008),sunc*.55,front*(1.-rl*.8));
    c=mix(c,pc,band*.95);
    c+=uA*aa(abs(abs(rl-R)-.0045)-px*.7)*seg*.15;
  }
  float gy=groundAt(p.x);
  float inside=aa(p.y-gy);
  vec3 plat=vec3(.008,.009,.014)+uB*.03*exp(-max(gy-p.y,0.)*10.);
  float bm=step(.6,h11(floor(p.x*20.)+uSeed.w*30.))*(.012+.04*h11(floor(p.x*20.)*1.9))*step(.35,fract(p.x*20.))*step(fract(p.x*20.),.65);
  c=mix(c,plat,aa(p.y-gy-bm));
  c+=sunc*lineD(p.y-gy,.0012)*.3;
  c+=vec3(1.,.8,.5)*step(.84,h21(floor(vec2(p.x*150.,(p.y-gy)*150.))))*step(0.,p.y-gy)*step(p.y-gy,bm)*.6;
  return c;
}`,
  },
]
