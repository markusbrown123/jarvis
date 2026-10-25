/**
 * Shared GLSL for every backdrop scene: noise helpers, the world layers that
 * turn hub data into scenery (games, leads, jobs, allowance, needs, finance)
 * and the grade that keeps the whole thing dark enough to read HUD text over.
 *
 * A scene supplies `GSTYLE`, `LSTYLE`, `groundAt(x)` and `sceneBG(p, t)`;
 * `buildFragment` stitches prelude + scene + layers + main together.
 */

export const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uT;
uniform vec4 uSeed;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uVoid;
uniform int uOct;
uniform float uAct;
uniform float uLive;
uniform vec4 uGames[16];
uniform float uLeads[64];
uniform vec3 uJobs[16];
uniform vec2 uFin[8];
uniform vec4 uFuel;
uniform vec4 uNeed;
uniform vec4 uCount;
uniform vec3 uCam;
uniform float uFade;

#define PI 3.14159265359

float px;
float asp;
vec3 eA;

float h11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 h22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y);
}
float fbm(vec2 p){
  float a=.5, s=0.;
  mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<6;i++){ if(i>=uOct) break; s+=a*vn(p); p=m*p; a*=.5; }
  return s/.96875;
}
float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h11(i),h11(i+1.),f); }
float fbm1(float x){
  float a=.5, s=0.;
  for(int i=0;i<5;i++){ if(i>=uOct) break; s+=a*n1(x); x=x*2.03+17.1; a*=.5; }
  return s/.96875;
}
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float aa(float d){ return 1.-smoothstep(-px,px,d); }
float lineD(float d,float w){ return 1.-smoothstep(w-px,w+px,abs(d)); }
float sdBox(vec2 p, vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.))+min(max(d.x,d.y),0.); }
float starf(vec2 p,float cells,float thr,float sz){
  vec2 g=p*cells; vec2 id=floor(g); vec2 f=fract(g)-.5;
  float h=h21(id+uSeed.x*40.);
  if(h<thr) return 0.;
  vec2 o=(h22(id+7.7)-.5)*.6;
  float d=length(f-o);
  float m=(h-thr)/(1.-thr);
  float tw=.65+.35*sin(uT*(.8+2.*h)+h*60.);
  return smoothstep(sz*(.4+m),0.,d)*tw*(.35+.65*m);
}
vec3 stars(vec2 p){
  float s=starf(p,70.,.80,.12)+1.3*starf(p+3.1,32.,.85,.11)+1.7*starf(p+8.,13.,.90,.075);
  return vec3(.8,.86,1.)*s*.8;
}
`

export const LAYERS = /* glsl */ `
// ------------------------------------------------------------------ games
// A game is a structure standing on the scene's ground line. Its lit height is
// task progress; the dim scaffold above it is the work still to do.
vec4 stTower(vec2 q,float H,float full,float bw,float pres,float hs,float t){
  vec3 em=vec3(0.);
  float body=aa(sdBox(q-vec2(0.,H*.5),vec2(bw,H*.5)));
  body=max(body,aa(sdBox(q-vec2(0.,H*.78),vec2(bw*.62,H*.28))));
  vec2 c=vec2(q.x+bw,q.y)/vec2(bw*.5,.0105);
  vec2 wid=floor(c); vec2 wf=fract(c);
  float win=step(.22,wf.x)*step(wf.x,.78)*step(.25,wf.y)*step(wf.y,.78);
  float on=step(.4,h21(wid+hs*50.));
  float within=step(abs(q.x),bw)*step(0.,q.y)*step(q.y,H);
  float tw=.75+.25*sin(t*2.+h21(wid)*30.);
  em+=mix(eA,vec3(1.,.9,.72),h21(wid+5.))*win*on*within*tw*.5;
  em+=eA*exp(-abs(q.y-H)*220.)*step(abs(q.x),bw*1.15)*pres*(.6+.4*sin(t*4.+hs*9.));
  float sd=sdBox(q-vec2(0.,full*.5),vec2(bw,full*.5));
  float above=step(H,q.y);
  float rows=1.-smoothstep(0.,px*1.2,min(fract(q.y/.022),1.-fract(q.y/.022))*.022);
  em+=eA*above*(aa(abs(sd)-px*.8)*.24+rows*step(abs(q.x),bw)*step(q.y,full)*.07);
  em+=eA*aa(sdBox(q-vec2(0.,H+.014),vec2(px*.7,.014)))*.6;
  em+=eA*exp(-length(q-vec2(0.,H))*34.)*.3*pres;
  return vec4(em,body);
}
vec4 stRocket(vec2 q,float H,float full,float bw,float pres,float hs,float t){
  vec3 em=vec3(0.);
  float hn=max(H,.025);
  float prof=bw*.7*(1.-pow(clamp(q.y/hn,0.,1.),2.6));
  float dB=max(abs(q.x)-prof,max(-q.y,q.y-hn));
  float dF=max(abs(q.x)-(prof+bw*.55*clamp(1.-q.y/.05,0.,1.)),max(-q.y,q.y-.05));
  float body=max(aa(dB),aa(dF));
  float seg=min(fract(q.y/.024),1.-fract(q.y/.024))*.024;
  em+=eA*(1.-smoothstep(0.,px*1.2,seg))*aa(dB)*.28;
  em+=eA*aa(abs(dB)-px)*.5*step(q.y,hn+px);
  float port=exp(-length(vec2(q.x*1.6,(fract(q.y/.024+.5)-.5)*.024))*340.)*step(q.y,hn*.9)*step(.01,q.y);
  em+=vec3(1.,.9,.7)*port*.7*step(.35,h11(floor(q.y/.024)+hs*20.));
  float full2=full+.018;
  float gx=abs(abs(q.x)-bw*2.3);
  float gantry=aa(gx-px*.7)*step(0.,q.y)*step(q.y,full2);
  float strut=aa(abs(q.y-floor(q.y/.045+.5)*.045)-px*.6)*step(abs(q.x),bw*2.3)*step(0.,q.y)*step(q.y,full2);
  em+=eA*(gantry*.2+strut*.12);
  float ps=-q.y;
  float plume=step(0.,ps)*exp(-ps*mix(40.,16.,uAct))*exp(-pow(q.x/(bw*.55),2.))*pres*(.55+.45*sin(t*38.+hs*30.));
  em+=mix(eA,vec3(1.),.45)*plume*.9;
  em+=eA*exp(-length(q-vec2(0.,hn))*38.)*.3*pres;
  return vec4(em,body);
}
vec4 stCrystal(vec2 q,float H,float full,float bw,float pres,float hs,float t){
  vec3 em=vec3(0.);
  float tw=bw*1.3*(1.-clamp(q.y/full,0.,1.));
  float dC=max(abs(q.x)-tw,max(-q.y,q.y-full));
  float inside=aa(dC);
  float fill=step(q.y,H);
  float facet=.5+.5*sign(q.x);
  em+=eA*inside*fill*(.28+.4*(1.-q.y/max(H,.01)))*(.8+.2*sin(q.y*90.-t*1.5+hs*9.))*(.7+.3*facet);
  em+=eA*aa(abs(dC)-px*.9)*(fill*.9+.26);
  em+=eA*aa(abs(q.x)-px*.6)*inside*.22;
  vec2 q2=q-vec2(bw*1.9,0.);
  float t2=bw*.7*(1.-clamp(q2.y/(full*.55),0.,1.));
  float d2=max(abs(q2.x)-t2,max(-q2.y,q2.y-full*.55));
  em+=eA*aa(abs(d2)-px*.8)*.2;
  em+=eA*exp(-length(q-vec2(0.,H))*28.)*.4*pres;
  return vec4(em,inside*(1.-fill)*.85);
}
vec4 stMast(vec2 q,float H,float full,float bw,float pres,float hs,float t){
  vec3 em=vec3(0.);
  float tw=bw*1.3*(1.-.55*clamp(q.y/full,0.,1.));
  float vis=step(0.,q.y)*step(q.y,full);
  float legs=aa(abs(abs(q.x)-tw)-px*.85)*vis;
  float z=abs(fract(q.y/.03)-.5)*2.;
  float brace=aa(abs(abs(q.x)/tw-z)*tw-px*.6)*step(abs(q.x),tw)*vis;
  float built=step(q.y,H);
  em+=eA*(legs+brace*.7)*(.2+.8*built);
  em+=eA*exp(-abs(q.y-fract(t*.35+hs)*H)*60.)*legs*built*.9;
  em+=eA*exp(-length(q-vec2(0.,H+.006))*44.)*(.5+.5*sin(t*3.+hs*7.))*pres*.8;
  return vec4(em,(legs+brace)*.7);
}

void games(vec2 p, inout vec3 col){
  float span=min(asp*.9,1.7);
  float w=span/14.;
  float fx=(p.x+span*.5)/w;
  int i0=int(floor(fx));
  for(int k=-1;k<=1;k++){
    int i=i0+k;
    if(i<0||i>=14) continue;
    vec4 g=uGames[i];
    float pub=step(1.5,g.w);
    float pres=clamp(g.w-2.*pub,0.,1.);
    float fi=float(i);
    float hs=h11(fi*7.31+uSeed.z*13.);
    float xc=-span*.5+(fi+.5)*w+(hs-.5)*w*.32;
    vec2 q=p-vec2(xc,groundAt(xc));
    if(abs(q.x)>w*.9) continue;
    float bw=w*(.2+.07*h11(fi*3.7+1.));
    float full=.19+.12*h11(fi*5.3+uSeed.w*9.);
    float H=mix(.03,mix(.04,full,clamp(g.x,0.,1.)),pres);
    vec4 r;
    if(GSTYLE==0) r=stTower(q,H,full,bw,pres,hs,uT);
    else if(GSTYLE==1) r=stRocket(q,H,full,bw,pres,hs,uT);
    else if(GSTYLE==2) r=stCrystal(q,H,full,bw,pres,hs,uT);
    else r=stMast(q,H,full,bw,pres,hs,uT);
    col=mix(col,vec3(.004,.006,.01)+uB*.015,r.a*.9*(.4+.6*pres));
    float live=mix(.55,1.,uLive);
    col+=r.rgb*(.22+.78*pres)*live;
    col+=eA*exp(-abs(q.x)*160.)*step(H,q.y)*exp(-(q.y-H)*5.)*g.y*(.5+.5*sin(uT*3.+hs*6.))*.7;
    col+=vec3(1.,.2,.15)*g.z*exp(-length(q-vec2(0.,H))*60.)*(.6+.4*sin(uT*9.));
    col+=vec3(1.,.95,.8)*pub*lineD(length(q-vec2(0.,H+.032))-.011,px*.9)*.8;
  }
}

// ------------------------------------------------------------------ leads
void leads(vec2 p, inout vec3 col){
  float span=min(asp*.92,1.72);
  vec2 cs=vec2(span/16.,.085);
  vec2 o=vec2(-span*.5,.025);
  vec2 gi=floor((p-o)/cs);
  float live=mix(.55,1.,uLive);
  for(int dy=-1;dy<=1;dy++){
    for(int dx=-1;dx<=1;dx++){
      vec2 id=gi+vec2(float(dx),float(dy));
      if(id.x<0.||id.x>=16.||id.y<0.||id.y>=4.) continue;
      float v=uLeads[int(id.x+16.*id.y)];
      if(v<=.004) continue;
      float hh=h21(id+uSeed.xy*31.);
      vec2 base=(id+.5+(h22(id+uSeed.zw*17.)-.5)*.7)*cs+o;
      float site=smoothstep(.55,.7,v);
      float tw=.6+.4*sin(uT*(.9+hh)+hh*50.);
      vec3 lc=mix(eA*.8,vec3(1.,.96,.85),site*.6);
      float I=(.25+.75*v)*tw;
      if(LSTYLE==0){
        vec2 pos=base+.014*vec2(sin(uT*.3+hh*6.),cos(uT*.23+hh*9.));
        float d=length(p-pos);
        col+=lc*(exp(-d*d/(.0019*.0019*(.6+v)))*1.6+exp(-d*34.)*.28)*I*live;
        col+=lc*site*lineD(d-.011-.002*sin(uT*2.+hh*5.),px*.8)*.5*live;
      } else if(LSTYLE==1){
        float dirx=cos(uT*.15+hh*6.);
        vec2 pos=base+vec2(sin(uT*.15+hh*6.)*.05,sin(uT*.4+hh*9.)*.006);
        vec2 s=(p-pos)*vec2(sign(dirx),1.);
        float sz=.005+.004*v;
        float d=max(abs(s.y)-sz*.45*(1.-clamp((s.x+sz)/(2.*sz),0.,1.)),max(-s.x-sz,s.x-sz));
        col+=lc*aa(d)*I*1.1*live;
        float trail=step(s.x,-sz)*exp(-(-s.x-sz)*26.)*exp(-abs(s.y)*500.);
        col+=lc*trail*I*.8*live;
        col+=lc*site*exp(-length(p-pos)*38.)*.35*live;
      } else if(LSTYLE==2){
        vec2 pos=floor(base/.006)*.006;
        float sz=.0016+.0016*v;
        float d=sdBox(p-pos,vec2(sz));
        float fl=step(.25,fract(uT*.2*(.5+hh)+hh*9.));
        col+=lc*(aa(d)*I*(.5+.5*fl)+exp(-length(p-pos)*70.)*.22*v)*live;
        col+=lc*site*lineD(sdBox(p-pos,vec2(sz+.005)),px*.7)*.35*live;
      } else {
        float ph=fract(hh+uT*.012*(.5+hh));
        vec2 pos=base+vec2(.012*sin(uT*.4+hh*8.),(ph-.5)*cs.y*.9);
        float fade=sin(PI*ph);
        float d=length(p-pos);
        float r=.004+.006*v;
        col+=lc*(exp(-d*d/(r*r))*.9+exp(-d*26.)*.18)*I*fade*live;
        col+=lc*site*lineD(d-r*1.8,px*.7)*.4*fade*live;
      }
    }
  }
}

// ------------------------------------------------------------------- jobs
float bezY(float a,float b,float c,float t){ float u=1.-t; return u*u*a+2.*u*t*b+t*t*c; }
void jobs(vec2 p, inout vec3 col){
  int n=int(uCount.z+.5);
  if(n<=0) return;
  float span=min(asp*.9,1.7);
  vec2 hub=vec2(0.,.06);
  for(int j=0;j<16;j++){
    if(j>=n) break;
    vec3 jb=uJobs[j];
    float kind=jb.x;
    float ja=jb.z;
    if(kind<=0.||ja<.004) continue;
    float fj=float(j);
    float sx=jb.y>=0. ? (-span*.5+(jb.y*13.+.5)*(span/14.)) : (h11(fj*2.1+uSeed.x)-.5)*span*.9;
    vec2 A=vec2(sx,groundAt(sx)+.17);
    vec2 hb=vec2(sx>0.?-.13:.13,hub.y);
    float cy=(A.y+hb.y)*.5+.14+.04*sin(fj*1.7);
    float tt=(p.x-A.x)/(hb.x-A.x);
    if(tt<-.02||tt>1.02) continue;
    float yy=bezY(A.y,cy,hb.y,clamp(tt,0.,1.));
    float dyy=abs(bezY(A.y,cy,hb.y,clamp(tt+.01,0.,1.))-bezY(A.y,cy,hb.y,clamp(tt-.01,0.,1.)))/(.02*abs(hb.x-A.x)+1e-4);
    float dv=abs(p.y-yy);
    float d=dv>.05?1.:dv/sqrt(1.+dyy*dyy);
    vec3 jc=eA;
    float spd=.17+.04*mod(fj,3.)+.12*uAct;
    float flow=0.;
    if(kind>1.5&&kind<2.5){ jc=vec3(1.,.62,.15); spd=.04; }
    else if(kind>2.5){ jc=vec3(1.,.25,.2); spd=.07; }
    else if(kind<.9){ spd=.05; }
    float dash=.5+.5*sin((tt*18.-uT*spd*18.)*PI);
    col+=jc*exp(-d*520.)*(.05+.07*dash)*step(0.,tt)*step(tt,1.)*ja;
    for(int m=0;m<3;m++){
      float head=fract(uT*spd+h11(fj*9.3)+float(m)/3.);
      float dd=head-tt;
      if(dd<0.) dd+=1.;
      float trail=exp(-dd*22.)*step(dd,.28);
      flow+=trail*exp(-d*430.);
      vec2 hp=vec2(mix(A.x,hb.x,head),bezY(A.y,cy,hb.y,head));
      float hd=length(p-hp);
      col+=mix(jc,vec3(1.),.5)*(exp(-hd*hd/(.0026*.0026))*1.1+exp(-hd*40.)*.22)*(kind<.9?.3:1.)*ja;
    }
    col+=jc*flow*.85*(kind<.9?.4:1.)*ja;
  }
}

// ------------------------------------------------------------- allowance
void fuel(vec2 p, inout vec3 col){
  float R=min(asp*.28,.5);
  if(abs(p.x)>R+.02) return;
  float gy=groundAt(p.x)-.02;
  float ly=p.y-gy;
  if(abs(ly)>.02) return;
  float f5=uFuel.x, f7=uFuel.y, has=uFuel.z;
  float u=(p.x+R)/(2.*R);
  float cells=28.;
  float cx=floor(u*cells), fx=fract(u*cells);
  float inCell=step(.12,fx)*step(fx,.88);
  float band=aa(abs(ly)-.0034);
  vec3 fc=eA;
  float lvl=has>.5?f5:0.;
  if(has>.5&&lvl<.4) fc=mix(vec3(1.,.62,.15),fc,smoothstep(.2,.4,lvl));
  if(has>.5&&lvl<.2) fc=mix(vec3(1.,.2,.18),vec3(1.,.62,.15),smoothstep(.08,.2,lvl));
  if(has<.5) fc=eA*.5;
  float lit=smoothstep(0.,1.,clamp((lvl*cells-cx),0.,1.));
  float shimmer=.75+.25*sin(u*40.-uT*2.4);
  float pulse=lvl<.2 ? (.6+.4*sin(uT*5.)) : 1.;
  vec3 e=vec3(0.);
  e+=fc*band*inCell*(has>.5 ? (lit*shimmer*pulse*.95+.07) : .05+.04*step(.5,fract(u*cells*.5)));
  e+=fc*exp(-abs(ly)*210.)*lit*inCell*.15;
  float tick=step(abs(u*4.-floor(u*4.+.5)),.02)*step(abs(ly+.0006),.0085);
  e+=eA*tick*.3;
  float end=lineD(abs(p.x)-R-.004,px)*step(abs(ly),.0085);
  e+=eA*end*.4;
  float ly7=ly+.0095;
  float b7=aa(abs(ly7)-.0009)*step(u,1.)*step(0.,u);
  float lit7=step(u,f7)*(has>.5?1.:0.);
  e+=mix(eA,vec3(.6,.7,1.),.4)*b7*(lit7*.6+.07);
  col+=e*mix(.55,1.,uLive);
}

// ----------------------------------------------------------------- beacon
void beacon(vec2 p, inout vec3 col){
  float cnt=uNeed.x;
  if(cnt<.01) return;
  float sgn=uSeed.w<.5?-1.:1.;
  float bx=sgn*(.31+.05*uSeed.y);
  float gy=groundAt(bx);
  float Hm=.15+.018*min(cnt,5.);
  vec2 q=p-vec2(bx,gy);
  vec3 bc=uNeed.y>.5 ? vec3(1.,.2,.3) : vec3(1.,.62,.16);
  float per=uNeed.y>.5 ? 1. : 2.2;
  col=mix(col,vec3(.004,.004,.008),aa(sdBox(q-vec2(0.,Hm*.5),vec2(.0035+.003*(1.-q.y/Hm),Hm*.5)))*.9);
  vec2 lamp=vec2(0.,Hm+.008);
  float dl=length(q-lamp);
  float beat=.55+.45*sin(uT*PI*2./per);
  col+=bc*(exp(-dl*dl/(.005*.005))*1.5+exp(-dl*20.)*.5*beat);
  for(int i=0;i<4;i++){
    if(float(i)>=min(cnt,4.)) break;
    float ph=fract(uT/per+float(i)*.23);
    float r=ph*.2;
    col+=bc*lineD(dl-r,px*1.1+.0006)*(1.-ph)*(1.-ph)*.8;
  }
  float shaft=exp(-abs(q.x)*(90.+400.*(1.-clamp((q.y-Hm)/.3,0.,1.))))*step(Hm,q.y)*exp(-(q.y-Hm)*2.2);
  col+=bc*shaft*.4*beat;
  for(int i=0;i<6;i++){
    if(float(i)>=min(cnt,6.)) break;
    col+=bc*exp(-length(q-vec2(0.,.02+float(i)*.016))*190.)*.9;
  }
  float sweep=exp(-abs(q.y-Hm-.008)*160.)*exp(-abs(q.x)*3.)*pow(.5+.5*sin(uT*2.1),12.);
  col+=bc*sweep*.5;
}

// ---------------------------------------------------------------- finance
void fin(vec2 p, inout vec3 col){
  int n=int(uCount.w+.5);
  if(n<=0) return;
  float step_=.085;
  float x0=-float(n-1)*.5*step_;
  float scan=fract(uT*.16);
  for(int i=0;i<8;i++){
    if(i>=n) break;
    float fi=float(i);
    vec2 np=vec2(x0+fi*step_,.335+.012*cos((fi-float(n-1)*.5)*.8));
    vec2 r=p-np;
    vec2 fv=uFin[i];
    float up=fv.x>0.?1.:0.;
    vec3 nc=up>.5 ? mix(eA,vec3(.35,1.,.75),.55) : vec3(1.,.25,.22);
    float fl=up>.5?1.:(.5+.5*step(.5,fract(uT*3.+fi)));
    float s=.009+.006*fv.y;
    float d=abs(r.x)+abs(r.y)-s;
    col+=nc*(aa(d)*.5+lineD(d,px*.9)*.7+exp(-length(r)*50.)*.35)*fl;
    float ring=lineD(length(r)-s*2.2-.004*sin(uT*1.6+fi),px*.7);
    col+=nc*ring*.3*up;
    if(i<n-1){
      vec2 nn=vec2(x0+(fi+1.)*step_,.335+.012*cos((fi+1.-float(n-1)*.5)*.8));
      float tx=(p.x-np.x)/(nn.x-np.x);
      if(tx>0.&&tx<1.){
        float ly=mix(np.y,nn.y,tx);
        float dl=abs(p.y-ly);
        float dashes=step(.5,fract(tx*5.-uT*.4));
        col+=eA*exp(-dl*600.)*(.12+.14*dashes);
      }
    }
  }
  float chainX=scan*float(n-1)*step_+x0;
  col+=eA*exp(-length(p-vec2(chainX,.335))*60.)*.5;
}

// ------------------------------------------------------------------- main
void main(){
  vec2 fc=gl_FragCoord.xy;
  px=1./uRes.y;
  asp=uRes.x/uRes.y;
  vec2 p=(fc/uRes-.5)*vec2(asp,1.);
  // The orbit camera: the world pans and breathes with the room in front of it.
  p=(p-vec2(0.,-.1))/(1.+uCam.z)+vec2(0.,-.1)-uCam.xy;
  eA=mix(uA,sceneTint(),.38);
  vec3 col=sceneBG(p,uT);

  float xn=abs(p.x)/(asp*.5);
  col*=mix(1.,.6,smoothstep(.36,.78,xn));
  vec2 rc=(p-vec2(0.,.12))*vec2(1.,1.1);
  col*=1.-.32*exp(-dot(rc,rc)/.055);

  games(p,col);
  leads(p,col);
  jobs(p,col);
  fuel(p,col);
  fin(p,col);
  beacon(p,col);

  col=1.-exp(-col*1.3);
  col=max(col,uVoid);
  col*=uFade;
  float vg=1.-.55*smoothstep(.42,1.1,length((fc/uRes-.5)*vec2(1.25,1.)));
  col*=vg;
  col+=(h21(fc+fract(uT)*91.)-.5)/255.;
  fragColor=vec4(col,1.);
}
`

export function buildFragment(sceneCode: string): string {
  return PRELUDE + sceneCode + LAYERS
}
