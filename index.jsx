import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as THREE from "three";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell, ReferenceLine } from "recharts";
import { Ship, DollarSign, Flame, Anchor, Clock, TrendingUp, TrendingDown, CheckCircle, MapPin, Gauge, Thermometer, Navigation, ChevronRight, Send, Layers, Eye, Play, Pause, Scissors, Info, BookOpen, ChevronDown, ChevronUp } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════
const C = {
  bg: "#050a14", s: "#0b1222", s2: "#101c2e", s3: "#162440",
  b: "#1a2744", b2: "#243556",
  t: "#e4e9f2", tm: "#6882a8", td: "#3d5478",
  cy: "#00c8ff", cyD: "#00c8ff30", cyG: "#00c8ff18",
  rd: "#ff4757", rdD: "#ff475730",
  gn: "#00d68f", gnD: "#00d68f30",
  am: "#ffa726", amD: "#ffa72630",
  pu: "#b388ff",
};
const FR_COLORS = [[0.32,0.42,0.62],[0.30,0.52,0.38],[0.45,0.55,0.30],[0.58,0.48,0.22],[0.65,0.35,0.18],[0.58,0.22,0.14]];
const FR_LABELS = ["FR0 · Clean","FR1 · Light Biofilm","FR2 · Medium Slime","FR3 · Heavy Slime","FR4 · Light Calcareous","FR5 · Heavy Calcareous"];
const FR_DRAG = [0,15,35,60,95,193];

// ═══════════════════════════════════════════════════════════════════
// VESSEL DATA
// ═══════════════════════════════════════════════════════════════════
const VESSELS = [
  { id:"svitzer-fremantle", name:"Svitzer Fremantle", type:"Harbor Tug", loa:32, beam:12, draft:5.5, cb:0.55, cm:0.92, cwp:0.78, displacement:1188, coatingAge:540, fuelRate:180, fuelType:"MDO", fuelPrice:2.0, homePort:"Fremantle, WA", mmsi:"503001234", imo:"9881275", idleRatio:0.55, harborRatio:0.30, transitRatio:0.15, maxSpeed:13, econSpeed:10, propDiameter:2.2, numProps:2, hasRudder:true, hasBulb:false },
  { id:"hmas-perth", name:"HMAS Perth", type:"ANZAC Class FFH", loa:118, beam:14.8, draft:4.35, cb:0.48, cm:0.82, cwp:0.72, displacement:3600, coatingAge:380, fuelRate:580, fuelType:"F76", fuelPrice:2.10, homePort:"Fleet Base West, WA", mmsi:"503000015", imo:"9087628", idleRatio:0.40, harborRatio:0.20, transitRatio:0.40, maxSpeed:27, econSpeed:18, propDiameter:3.8, numProps:1, hasRudder:true, hasBulb:true },
  { id:"coral-adventurer", name:"Coral Adventurer", type:"Expedition Vessel", loa:63, beam:14, draft:3.2, cb:0.52, cm:0.88, cwp:0.75, displacement:1503, coatingAge:720, fuelRate:260, fuelType:"MDO", fuelPrice:2.0, homePort:"Cairns, QLD", mmsi:"503005678", imo:"9838644", idleRatio:0.35, harborRatio:0.15, transitRatio:0.50, maxSpeed:15, econSpeed:12, propDiameter:1.8, numProps:2, hasRudder:true, hasBulb:false },
  { id:"svitzer-cottesloe", name:"Svitzer Cottesloe", type:"Harbor Tug", loa:30, beam:11, draft:5.2, cb:0.54, cm:0.91, cwp:0.77, displacement:960, coatingAge:420, fuelRate:160, fuelType:"MDO", fuelPrice:2.0, homePort:"Fremantle, WA", mmsi:"503001045", imo:"1045057", idleRatio:0.58, harborRatio:0.28, transitRatio:0.14, maxSpeed:12.5, econSpeed:9, propDiameter:2.0, numProps:2, hasRudder:true, hasBulb:false },
];
const CO2_FACTOR = { MDO: 3.206, F76: 3.206, VLSFO: 3.151, HFO: 3.114 };
const FUEL_DENSITY = { MDO: 0.85, F76: 0.84, VLSFO: 0.87, HFO: 0.99 };

// ═══════════════════════════════════════════════════════════════════
// PHYSICS ENGINE
// ═══════════════════════════════════════════════════════════════════
function calcWettedSurface(L,B,T,Cb,Cm,Cwp){return L*(2*T+B)*Math.sqrt(Cm)*(0.453+0.4425*Cb-0.2862*Cm-0.003467*(B/T)+0.3696*Cwp)}
function calcReynolds(v,L){return(v*L)/1.19e-6}
function calcITTC57Cf(Re){return Re<1e5?0.005:0.075/Math.pow(Math.log10(Re)-2,2)}
function calcFr(v,L){return v/Math.sqrt(9.81*L)}
function calcCrOverCf(Fr){return Fr<=0?0:0.05+1.8/(1+Math.exp(-18*(Fr-0.22)))}
function calcPropEff(sr){const s=Math.max(0.05,Math.min(1.2,sr));return 0.35+0.30*Math.sin(s*Math.PI*0.75)}
function calcSpeedSupp(kn){if(kn<=0)return 1;if(kn<3)return 0.85;return Math.max(0.05,1-0.7*(1/(1+Math.exp(-0.8*(kn-7)))))}
function initFouling(age,sst=22){const tf=Math.exp((sst-20)*0.04);const gr=0.006*tf;return 5/(1+(5/0.1-1)*Math.exp(-gr*age*0.3))}

// ═══════════════════════════════════════════════════════════════════
// SIMULATION
// ═══════════════════════════════════════════════════════════════════
function generateVoyageData(vessel,days=365,cleanDay=-1,skipAdj=0){
  const data=[];const rng=seedRandom(vessel.id.length*137+42);
  const startDate=new Date("2025-01-01");
  const portLat=vessel.homePort.includes("Cairns")?-16.92:-32.05;
  const portLon=vessel.homePort.includes("Cairns")?145.77:115.74;
  const wsa=calcWettedSurface(vessel.loa,vessel.beam,vessel.draft,vessel.cb,vessel.cm,vessel.cwp);
  const co2F=CO2_FACTOR[vessel.fuelType]||3.206;
  const fD=FUEL_DENSITY[vessel.fuelType]||0.85;
  const avgSst=vessel.homePort.includes("Cairns")?26.5:20.5;
  let fouling=initFouling(vessel.coatingAge,avgSst);
  let cumCost=0,cumCO2=0;
  for(let d=0;d<days;d++){
    const date=new Date(startDate);date.setDate(date.getDate()+d);const month=date.getMonth();
    if(d===cleanDay)fouling=Math.max(0,fouling*0.05);
    const baseSst=vessel.homePort.includes("Cairns")?26.5:20.5;
    const sstA=vessel.homePort.includes("Cairns")?2.5:2.8;
    const sst=baseSst+sstA*Math.cos(month*2*Math.PI/12)+(rng()-0.5)*0.6;
    const r=rng();let act,spd,hrs;
    if(r<vessel.idleRatio){act="idle";spd=0;hrs=0}
    else if(r<vessel.idleRatio+vessel.harborRatio){act="harbor_ops";spd=3+rng()*5;hrs=6+rng()*10}
    else{act="transit";spd=vessel.econSpeed*(0.8+rng()*0.25);hrs=10+rng()*12}
    const drift=act==="transit"?0.1:0.015;
    const lat=portLat+(rng()-0.5)*drift*2+(act==="transit"?Math.sin(d*0.07)*0.04:0);
    const lon=portLon+(rng()-0.5)*drift*2.5-(act==="transit"?Math.cos(d*0.05)*0.03:0);
    const tF=Math.exp((sst-20)*0.04);const sF=calcSpeedSupp(spd);
    const cF=Math.min(2.5,1+(vessel.coatingAge+d)/1600);
    const satF=Math.max(0,1-Math.pow(fouling/5.2,1.5));
    const cal=1+skipAdj*0.1;
    fouling=Math.min(5,Math.max(0,fouling+0.006*tF*sF*cF*satF*cal));
    const sMs=spd*0.5144;const Re=calcReynolds(sMs,vessel.loa);const Cf=calcITTC57Cf(Re);
    const Fr=calcFr(sMs,vessel.loa);
    const fi=Math.min(4,Math.floor(fouling));const ff=fouling-fi;
    const fricIncPct=FR_DRAG[fi]+ff*(FR_DRAG[Math.min(5,fi+1)]-FR_DRAG[fi]);
    const crCf=calcCrOverCf(Fr);
    const totResIncPct=spd>0?fricIncPct/(1+crCf+0.05):0;
    const sr=spd/vessel.maxSpeed;const pEff=calcPropEff(sr);
    const fuelPenPct=spd>0?totResIncPct*(0.65/Math.max(0.3,pEff)):0;
    const extraCostHr=vessel.fuelRate*vessel.fuelPrice*(fuelPenPct/100);
    const dayCost=extraCostHr*hrs;cumCost+=dayCost;
    const extraLitres=vessel.fuelRate*(fuelPenPct/100)*hrs;
    const dayCO2=extraLitres*fD*co2F/1000;cumCO2+=dayCO2;
    data.push({day:d,date:date.toISOString().slice(0,10),month:date.toLocaleString("default",{month:"short"}),
      sst:+sst.toFixed(1),activity:act,avgSpeed:+spd.toFixed(1),hoursActive:+hrs.toFixed(1),lat,lon,
      fouling:+fouling.toFixed(3),frRating:Math.min(5,Math.round(fouling)),
      frictionIncrease:+fricIncPct.toFixed(1),totalResistanceIncrease:+totResIncPct.toFixed(1),
      fuelPenaltyPct:+fuelPenPct.toFixed(1),dailyExtraCost:Math.round(dayCost),
      cumulativeCost:Math.round(cumCost),dailyCO2:+dayCO2.toFixed(2),cumulativeCO2:+cumCO2.toFixed(1),
      heading:Math.round(rng()*360),wsa:Math.round(wsa),Re:Re.toExponential(2),Cf:Cf.toFixed(6),Fr:+Fr.toFixed(3)});
  }
  return data;
}
function seedRandom(seed){let s=Math.abs(seed)||1;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646}}

// ═══════════════════════════════════════════════════════════════════
// 3D HULL
// ═══════════════════════════════════════════════════════════════════
function HullScene({foulingState,vessel,width,height}){
  const mountRef=useRef(null);const sceneData=useRef(null);
  const mouseRef=useRef({isDown:false,lastX:0,lastY:0,rotY:0.4,rotX:-0.15});
  const animRef=useRef(null);
  const createHull=useCallback((L,B,T,Cb)=>{
    const st=56,rn=32,pos=[],col=[],idx=[];
    const cbS=Cb/0.50;
    for(let i=0;i<=st;i++){const t=i/st;const z=(t-0.5)*L;
      const bs=0.5+(1-cbS)*0.3;let bf;
      if(t<0.08)bf=Math.pow(t/0.08,bs)*0.45;else if(t<0.18)bf=0.45+0.50*Math.pow((t-0.08)/0.10,0.8);
      else if(t<0.55)bf=0.95+0.05*Math.sin(((t-0.18)/0.37)*Math.PI/2);
      else if(t<0.82)bf=1-0.12*Math.pow((t-0.55)/0.27,1.2+cbS*0.3);
      else bf=0.88-0.40*Math.pow((t-0.82)/0.18,0.65);
      const hb=(B/2)*bf;let df;
      if(t<0.1)df=0.35+0.55*(t/0.1);else if(t<0.7)df=0.9+0.1*Math.sin(((t-0.1)/0.6)*Math.PI);
      else df=1-0.12*Math.pow((t-0.7)/0.3,1.1);
      const lD=T*df;const fBase=1.6+cbS*1.2;let full;
      if(t<0.12)full=1.2+(fBase-1.2)*(t/0.12);else if(t<0.55)full=fBase+0.8*cbS*Math.sin(((t-0.12)/0.43)*Math.PI/2);
      else full=(fBase+0.8*cbS)-1.2*Math.pow((t-0.55)/0.45,0.75);
      full=Math.max(1.2,full);
      for(let j=0;j<=rn;j++){const s=j/rn;const a=s*Math.PI;const ca=Math.cos(a);const sa=Math.sin(a);
        const e=2/full;const x=hb*Math.sign(ca)*Math.pow(Math.abs(ca),e);
        const y=-lD*Math.pow(Math.abs(sa),0.7+0.2*(full/4));pos.push(x,y,z);col.push(0.32,0.42,0.62);}}
    for(let i=0;i<st;i++)for(let j=0;j<rn;j++){const a=i*(rn+1)+j;const b=a+rn+1;idx.push(a,b,a+1,b,b+1,a+1)}
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();return g;
  },[]);
  useEffect(()=>{
    if(!mountRef.current||width<50||height<50)return;const el=mountRef.current;const S=vessel.loa;
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x030810);
    scene.fog=new THREE.Fog(0x030810,S*1.2,S*4);
    const camera=new THREE.PerspectiveCamera(42,width/height,0.1,S*6);
    camera.position.set(S*0.35,S*0.15,S*0.45);camera.lookAt(0,-vessel.draft*0.3,0);
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setSize(width,height);renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.1;el.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0x2244aa,0.45));
    const key=new THREE.DirectionalLight(0xffffff,0.95);key.position.set(S*0.6,S*0.8,S*0.7);key.castShadow=true;scene.add(key);
    scene.add(new THREE.DirectionalLight(0x3366aa,0.3).translateX(-S*0.5));
    scene.add(new THREE.DirectionalLight(0x00aaff,0.2).translateZ(-S));
    const hullGeo=createHull(vessel.loa,vessel.beam,vessel.draft,vessel.cb);
    const hull=new THREE.Mesh(hullGeo,new THREE.MeshPhongMaterial({vertexColors:true,shininess:50,specular:new THREE.Color(0x223344),side:THREE.DoubleSide}));
    hull.castShadow=true;scene.add(hull);
    // Deck
    const beamAt=t=>{const bs2=0.5+(1-vessel.cb/0.5)*0.3;if(t<0.08)return Math.pow(t/0.08,bs2)*0.45;if(t<0.18)return 0.45+0.50*Math.pow((t-0.08)/0.1,0.8);if(t<0.55)return 0.95+0.05*Math.sin(((t-0.18)/0.37)*Math.PI/2);if(t<0.82)return 1-0.12*Math.pow((t-0.55)/0.27,1.2+(vessel.cb/0.5)*0.3);return 0.88-0.40*Math.pow((t-0.82)/0.18,0.65)};
    const ds=new THREE.Shape();for(let i=0;i<=50;i++){const t=i/50;const x=(vessel.beam/2)*beamAt(t)*0.93;const z=(t-0.5)*vessel.loa;i===0?ds.moveTo(z,x):ds.lineTo(z,x)}
    for(let i=50;i>=0;i--){const t=i/50;ds.lineTo((t-0.5)*vessel.loa,-(vessel.beam/2)*beamAt(t)*0.93)}
    const dm=new THREE.Mesh(new THREE.ShapeGeometry(ds),new THREE.MeshPhongMaterial({color:0x2a3a4a,shininess:15}));
    dm.rotation.x=-Math.PI/2;dm.rotation.z=-Math.PI/2;dm.position.y=0.08;scene.add(dm);
    // Superstructure
    const sH=S*0.055,sL=S*0.16,sW=vessel.beam*0.55;
    const sup=new THREE.Mesh(new THREE.BoxGeometry(sW,sH,sL),new THREE.MeshPhongMaterial({color:0x506878}));
    sup.position.set(0,sH/2+0.15,S*0.05);sup.castShadow=true;scene.add(sup);
    const br=new THREE.Mesh(new THREE.BoxGeometry(sW*0.72,sH*0.55,sL*0.4),new THREE.MeshPhongMaterial({color:0x607888}));
    br.position.set(0,sH+sH*0.55/2+0.15,S*0.06);scene.add(br);
    scene.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(vessel.beam*0.05,vessel.beam*0.07,sH*1.4,8),new THREE.MeshPhongMaterial({color:0x333333})),{position:new THREE.Vector3(0,sH*1.6+0.15,S*0.03)}));
    // Waterline ring
    const wl=new THREE.Mesh(new THREE.TorusGeometry(S*0.55,S*0.003,4,64),new THREE.MeshBasicMaterial({color:0xcc2222,transparent:true,opacity:0.7}));
    wl.rotation.x=Math.PI/2;wl.position.y=-0.05;scene.add(wl);
    // Props
    const pg=new THREE.Group();const pR=vessel.propDiameter/2;
    for(let p=0;p<vessel.numProps;p++){
      const xO=vessel.numProps===1?0:(p===0?-vessel.beam*0.22:vessel.beam*0.22);
      pg.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(pR*0.25,12,8),new THREE.MeshPhongMaterial({color:0xaa8844,shininess:80})),{position:new THREE.Vector3(xO,-vessel.draft*0.7,-S*0.47)}));
      const sh=new THREE.Mesh(new THREE.CylinderGeometry(pR*0.08,pR*0.08,S*0.08,8),new THREE.MeshPhongMaterial({color:0x888888}));
      sh.rotation.x=Math.PI/2;sh.position.set(xO,-vessel.draft*0.7,-S*0.44);pg.add(sh);
      for(let b=0;b<4;b++){const bs3=new THREE.Shape();bs3.moveTo(0,0);bs3.quadraticCurveTo(pR*0.3,pR*0.15,pR*0.9,pR*0.05);bs3.quadraticCurveTo(pR*0.5,-pR*0.1,0,0);
        const bm=new THREE.Mesh(new THREE.ShapeGeometry(bs3),new THREE.MeshPhongMaterial({color:0xaa8844,shininess:60,side:THREE.DoubleSide}));
        bm.position.set(xO,-vessel.draft*0.7,-S*0.47);bm.rotation.z=b*Math.PI/2;bm.rotation.y=0.3;pg.add(bm)}}
    scene.add(pg);
    // Rudder
    if(vessel.hasRudder){const rd=new THREE.Mesh(new THREE.BoxGeometry(vessel.draft*0.06,vessel.draft*0.6,vessel.draft*0.3),new THREE.MeshPhongMaterial({color:0xcc3333}));rd.position.set(0,-vessel.draft*0.5,-S*0.49);scene.add(rd)}
    if(vessel.hasBulb){const bl=new THREE.Mesh(new THREE.SphereGeometry(vessel.beam*0.12,16,12),new THREE.MeshPhongMaterial({color:0x445566}));bl.scale.set(0.6,0.8,1.5);bl.position.set(0,-vessel.draft*0.6,S*0.50);scene.add(bl)}
    // Water
    const wGeo=new THREE.PlaneGeometry(S*3.5,S*3.5,50,50);
    const water=new THREE.Mesh(wGeo,new THREE.MeshPhongMaterial({color:0x081828,transparent:true,opacity:0.5,shininess:100,specular:new THREE.Color(0x1166aa),side:THREE.DoubleSide}));
    water.rotation.x=-Math.PI/2;scene.add(water);
    // Particles
    const pC=250;const pGeo2=new THREE.BufferGeometry();const pP=new Float32Array(pC*3);
    for(let i=0;i<pC;i++){pP[i*3]=(Math.random()-0.5)*S*2.5;pP[i*3+1]=-Math.random()*vessel.draft*4;pP[i*3+2]=(Math.random()-0.5)*S*2.5}
    pGeo2.setAttribute("position",new THREE.Float32BufferAttribute(pP,3));
    const pts=new THREE.Points(pGeo2,new THREE.PointsMaterial({color:0x3366aa,size:S*0.004,transparent:true,opacity:0.35}));scene.add(pts);
    sceneData.current={scene,camera,renderer,hull,hullGeo,water,pts,pC,pg};
    let time=0;const animate=()=>{animRef.current=requestAnimationFrame(animate);time+=0.004;
      const mr=mouseRef.current;if(!mr.isDown)mr.rotY+=0.0015;
      const piv=new THREE.Vector3(0,-vessel.draft*0.25,0);const dist=S*0.7;
      camera.position.set(piv.x+dist*Math.sin(mr.rotY)*Math.cos(mr.rotX),piv.y+dist*Math.sin(mr.rotX)+S*0.1,piv.z+dist*Math.cos(mr.rotY)*Math.cos(mr.rotX));
      camera.lookAt(piv);
      const wp=water.geometry.attributes.position;for(let i=0;i<wp.count;i++){wp.setY(i,Math.sin(wp.getX(i)*0.25+time*1.8)*S*0.003+Math.cos(wp.getZ(i)*0.18+time*1.3)*S*0.002)}wp.needsUpdate=true;
      const pp=pts.geometry.attributes.position;for(let i=0;i<pC;i++){let y=pp.getY(i)+S*0.00008;if(y>0)y=-vessel.draft*4;pp.setY(i,y);pp.setX(i,pp.getX(i)+Math.sin(time+i*0.7)*S*0.00005)}pp.needsUpdate=true;
      pg.children.forEach(c=>{if(c.geometry?.type==="ShapeGeometry")c.rotation.z+=0.02});
      renderer.render(scene,camera)};animate();
    const onDown=e=>{const p=e.touches?e.touches[0]:e;mouseRef.current={...mouseRef.current,isDown:true,lastX:p.clientX,lastY:p.clientY}};
    const onUp=()=>{mouseRef.current.isDown=false};
    const onMove=e=>{if(!mouseRef.current.isDown)return;e.preventDefault();const p=e.touches?e.touches[0]:e;
      mouseRef.current.rotY+=(p.clientX-mouseRef.current.lastX)*0.005;
      mouseRef.current.rotX=Math.max(-0.7,Math.min(0.7,mouseRef.current.rotX+(p.clientY-mouseRef.current.lastY)*0.005));
      mouseRef.current.lastX=p.clientX;mouseRef.current.lastY=p.clientY};
    const dom=renderer.domElement;
    dom.addEventListener("mousedown",onDown);dom.addEventListener("mouseup",onUp);dom.addEventListener("mouseleave",onUp);dom.addEventListener("mousemove",onMove);
    dom.addEventListener("touchstart",onDown,{passive:false});dom.addEventListener("touchend",onUp);dom.addEventListener("touchmove",onMove,{passive:false});
    return()=>{cancelAnimationFrame(animRef.current);dom.removeEventListener("mousedown",onDown);dom.removeEventListener("mouseup",onUp);dom.removeEventListener("mouseleave",onUp);dom.removeEventListener("mousemove",onMove);dom.removeEventListener("touchstart",onDown);dom.removeEventListener("touchend",onUp);dom.removeEventListener("touchmove",onMove);renderer.dispose();if(el.contains(dom))el.removeChild(dom)};
  },[vessel,width,height,createHull]);
  useEffect(()=>{if(!sceneData.current)return;const{hullGeo}=sceneData.current;const ca=hullGeo.attributes.color;const pa=hullGeo.attributes.position;
    for(let i=0;i<=56;i++){const t=i/56;for(let j=0;j<=32;j++){const idx=i*33+j;const s=j/32;const y=pa.getY(idx);
      let zm=1;const nd=-y/vessel.draft;if(nd>0.85)zm=1.25;else if(nd>0.3)zm=1;else if(nd>0)zm=0.85;else zm=0.15;
      if(t<0.08||t>0.90)zm*=1.35;if(Math.abs(s-0.5)<0.12)zm*=1.15;
      const lf=Math.min(5,foulingState*zm);const fi=Math.min(4,Math.floor(lf));const ff=lf-fi;
      const r=FR_COLORS[fi][0]+ff*(FR_COLORS[fi+1][0]-FR_COLORS[fi][0]);
      const g=FR_COLORS[fi][1]+ff*(FR_COLORS[fi+1][1]-FR_COLORS[fi][1]);
      const b=FR_COLORS[fi][2]+ff*(FR_COLORS[fi+1][2]-FR_COLORS[fi][2]);
      const n1=(Math.sin(i*7.3+j*11.7)*0.5+0.5)*0.06;const n2=(Math.sin(i*3.1+j*17.3)*0.5+0.5)*0.04;
      ca.setXYZ(idx,Math.min(1,r+n1),Math.min(1,g+n2),Math.min(1,b-n1*0.5))}}ca.needsUpdate=true;
  },[foulingState,vessel]);
  return <div ref={mountRef} style={{width,height,cursor:"grab",touchAction:"none"}}/>;
}

// ═══════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════
function Kpi({icon:Icon,label,value,unit,color,sub}){
  return(<div style={{background:`linear-gradient(145deg,${C.s}ee,${C.s2}cc)`,border:`1px solid ${C.b}`,borderRadius:10,padding:"12px 14px",position:"relative",overflow:"hidden",minWidth:0}}>
    <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${color}aa,transparent)`}}/>
    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:4}}><Icon size={12} color={C.tm}/><span style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:0.8,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span></div>
    <div style={{display:"flex",alignItems:"baseline",gap:3,flexWrap:"wrap"}}><span style={{fontSize:22,fontWeight:700,color,fontFamily:"monospace",letterSpacing:-0.5}}>{value}</span>{unit&&<span style={{fontSize:10,color:C.tm}}>{unit}</span>}</div>
    {sub&&<div style={{fontSize:9,color:C.td,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div>}
  </div>);
}

function AISMap({data,currentDay,vessel}){
  const ref=useRef(null);
  useEffect(()=>{const cv=ref.current;if(!cv)return;const ctx=cv.getContext("2d");const w=cv.width,h=cv.height;
    ctx.fillStyle=C.bg;ctx.fillRect(0,0,w,h);
    ctx.strokeStyle=C.b+"40";ctx.lineWidth=0.5;for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(0,h/5*i);ctx.lineTo(w,h/5*i);ctx.stroke();ctx.beginPath();ctx.moveTo(w/5*i,0);ctx.lineTo(w/5*i,h);ctx.stroke()}
    if(!data.length)return;const sl=data.slice(0,currentDay+1);const lats=sl.map(d=>d.lat);const lons=sl.map(d=>d.lon);const pd=0.015;
    const mnLa=Math.min(...lats)-pd,mxLa=Math.max(...lats)+pd,mnLo=Math.min(...lons)-pd*1.5,mxLo=Math.max(...lons)+pd*1.5;const m=12;
    const toX=lo=>m+((lo-mnLo)/(mxLo-mnLo))*(w-m*2);const toY=la=>h-m-((la-mnLa)/(mxLa-mnLa))*(h-m*2);
    ctx.beginPath();sl.forEach((d,i)=>{const px=toX(d.lon),py=toY(d.lat);i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)});
    ctx.strokeStyle=C.cy+"25";ctx.lineWidth=1;ctx.stroke();
    sl.forEach((d,i)=>{const px=toX(d.lon),py=toY(d.lat);const ic=i===currentDay;const al=ic?1:0.12+(i/currentDay)*0.35;
      ctx.beginPath();ctx.arc(px,py,ic?5:1.5,0,Math.PI*2);
      ctx.fillStyle=d.activity==="idle"?`rgba(255,167,38,${al})`:d.activity==="harbor_ops"?`rgba(0,200,255,${al})`:`rgba(0,214,143,${al})`;ctx.fill();
      if(ic){ctx.strokeStyle=C.cy;ctx.lineWidth=2;ctx.stroke()}});
    ctx.font="bold 10px monospace";ctx.fillStyle=C.tm;ctx.fillText(vessel.homePort,m,h-4);
    ctx.fillText(`${sl[currentDay]?.lat.toFixed(3)}°S, ${sl[currentDay]?.lon.toFixed(3)}°E`,m,12);
  },[data,currentDay,vessel]);
  return <canvas ref={ref} width={300} height={210} style={{borderRadius:8,border:`1px solid ${C.b}`,width:"100%",display:"block"}}/>;
}

function FBar({val}){const pct=(val/5)*100;const fr=Math.min(5,Math.round(val));const col=fr<=1?C.gn:fr<=3?C.am:C.rd;
  return(<div><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,color:C.tm}}>Hull Condition</span><span style={{fontSize:10,fontWeight:700,color:col}}>{FR_LABELS[fr]}</span></div>
    <div style={{height:7,borderRadius:4,background:C.s,overflow:"hidden",position:"relative"}}><div style={{width:`${pct}%`,height:"100%",borderRadius:4,transition:"width 0.4s",background:`linear-gradient(90deg,${C.gn},${C.am},${C.rd})`}}/>{[1,2,3,4].map(i=><div key={i} style={{position:"absolute",left:`${i*20}%`,top:0,bottom:0,width:1,background:C.b}}/>)}</div>
    <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>{[0,1,2,3,4,5].map(i=><span key={i} style={{fontSize:7,color:C.td}}>FR{i}</span>)}</div></div>);
}

// Collapsible doc section
function DocSection({title,children,defaultOpen=false}){
  const[open,setOpen]=useState(defaultOpen);
  return(<div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,marginBottom:10,overflow:"hidden"}}>
    <button onClick={()=>setOpen(!open)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:"transparent",border:"none",color:C.t,cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left"}}>
      {title}{open?<ChevronUp size={16} color={C.tm}/>:<ChevronDown size={16} color={C.tm}/>}</button>
    {open&&<div style={{padding:"4px 16px 16px",fontSize:12,lineHeight:1.7,color:C.tm}}>{children}</div>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN APPLICATION
// ═══════════════════════════════════════════════════════════════════
export default function App(){
  const[vi,setVi]=useState(0);const[day,setDay]=useState(120);const[tab,setTab]=useState("twin");
  const[playing,setPlaying]=useState(false);const[cleanDay,setCleanDay]=useState(-1);
  const[skipperData,setSkipperData]=useState([]);const[skipperForm,setSkipperForm]=useState({speed:"",fuel:"",fouling:"FR2",notes:""});
  const[cw,setCw]=useState(0);const containerRef=useRef(null);const playRef=useRef(null);
  const mob=cw<680;const tablet=cw<960&&!mob;
  const vessel=VESSELS[vi];

  const skipperAdj=useMemo(()=>{if(skipperData.length<2)return 0;const fr=skipperData.filter(r=>r.fuel&&r.day);if(!fr.length)return 0;let d=0;fr.forEach(r=>{parseFloat(r.fuel)>vessel.fuelRate?d+=0.5:d-=0.3});return Math.max(-2,Math.min(2,d/fr.length))},[skipperData,vessel]);
  const voyageData=useMemo(()=>generateVoyageData(vessel,365,cleanDay,skipperAdj),[vessel,cleanDay,skipperAdj]);
  const baselineData=useMemo(()=>cleanDay>=0?generateVoyageData(vessel,365,-1,skipperAdj):null,[vessel,cleanDay,skipperAdj]);
  const td=voyageData[day]||voyageData[0];
  const monthlyData=useMemo(()=>{const mo={};voyageData.forEach(d=>{const k=d.date.slice(0,7);if(!mo[k])mo[k]={month:d.month,cost:0,co2:0,fouling:0,sst:0,speed:0,n:0,idle:0};mo[k].cost+=d.dailyExtraCost;mo[k].co2+=d.dailyCO2;mo[k].fouling=d.fouling;mo[k].sst+=d.sst;mo[k].speed+=d.avgSpeed;mo[k].n++;if(d.activity==="idle")mo[k].idle++});return Object.values(mo).map(m=>({...m,sst:+(m.sst/m.n).toFixed(1),speed:+(m.speed/m.n).toFixed(1),idlePct:Math.round(m.idle/m.n*100),cost:Math.round(m.cost),co2:+(m.co2).toFixed(1),fouling:+m.fouling.toFixed(2)}))},[voyageData]);
  const fleetData=useMemo(()=>VESSELS.map(v=>{const vd=generateVoyageData(v,365);return{vessel:v,latest:vd[364]}}),[]);
  const cleanCost=vessel.type.includes("Tug")?8000:vessel.type.includes("ANZAC")?35000:18000;
  const monthPenalty=td.cumulativeCost/Math.max(1,day)*30;
  const roiDays=monthPenalty>0?Math.round(cleanCost/(monthPenalty/30)):999;

  // Scene sizing — correct for container padding (mobile 8+8=16, desktop 16+16=32)
  const sceneW=cw<50?400:Math.max(260,mob?cw-16:Math.min(cw-326,1000));
  const sceneH=Math.max(180,Math.min(mob?260:460,sceneW*0.55));

  useEffect(()=>{if(playing){playRef.current=setInterval(()=>setDay(d=>d>=364?(setPlaying(false),364):d+1),80)}else clearInterval(playRef.current);return()=>clearInterval(playRef.current)},[playing]);
  useEffect(()=>{const fn=()=>{if(containerRef.current)setCw(containerRef.current.offsetWidth)};fn();window.addEventListener("resize",fn);return()=>window.removeEventListener("resize",fn)},[]);
  const handleSkipper=()=>{if(!skipperForm.speed&&!skipperForm.fuel)return;setSkipperData(p=>[...p,{...skipperForm,day,date:td.date,ts:Date.now()}]);setSkipperForm({speed:"",fuel:"",fouling:"FR2",notes:""})};

  const tabs=[
    {id:"twin",label:"Twin",mLabel:"Twin",icon:Ship},{id:"voyage",label:"Voyage",mLabel:"Voy",icon:Navigation},
    {id:"cost",label:"Cost Impact",mLabel:"Cost",icon:DollarSign},{id:"fleet",label:"Fleet",mLabel:"Fleet",icon:Layers},
    {id:"input",label:"Skipper Input",mLabel:"Input",icon:Send},{id:"docs",label:"Documentation",mLabel:"Docs",icon:BookOpen},
  ];
  const ttS={backgroundColor:C.s,border:`1px solid ${C.b}`,borderRadius:8,fontSize:11,color:C.t};
  const grid=(cols,mobCols="1fr")=>({display:"grid",gridTemplateColumns:mob?mobCols:cols,gap:mob?8:10});

  return(
    <div style={{background:C.bg,minHeight:"100vh",color:C.t,fontFamily:"'Segoe UI',system-ui,sans-serif",overflowX:"hidden"}}>
      {/* HEADER */}
      <div style={{background:`linear-gradient(180deg,${C.s2},${C.bg})`,borderBottom:`1px solid ${C.b}`,padding:mob?"8px 12px":"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:30,height:30,borderRadius:6,background:`linear-gradient(135deg,${C.cy},#0066bb)`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ship size={16} color="#fff"/></div>
          <div><div style={{fontSize:mob?12:14,fontWeight:700}}>MARINE<span style={{color:C.cy}}>STREAM</span></div>
            <div style={{fontSize:8,color:C.tm,letterSpacing:2,textTransform:"uppercase"}}>Digital Twin Platform</div></div>
        </div>
        <select value={vi} onChange={e=>{setVi(+e.target.value);setDay(120);setCleanDay(-1);setPlaying(false)}}
          style={{background:C.s,border:`1px solid ${C.b}`,borderRadius:6,color:C.t,padding:"6px 8px",fontSize:mob?10:12,cursor:"pointer",outline:"none",maxWidth:mob?160:300,minWidth:0}}>
          {VESSELS.map((v,i)=><option key={v.id} value={i}>{mob?v.name:`${v.name} — ${v.type}`}</option>)}
        </select>
        {!mob&&<div style={{display:"flex",alignItems:"center",gap:12,fontSize:10,color:C.tm,flexWrap:"wrap"}}>
          <span>IMO {vessel.imo}</span><span>MMSI {vessel.mmsi}</span>
          <span>WSA {Math.round(calcWettedSurface(vessel.loa,vessel.beam,vessel.draft,vessel.cb,vessel.cm,vessel.cwp))}m²</span>
          <span style={{color:C.gn}}>● LIVE</span>
        </div>}
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:0,padding:mob?"0 2px":"0 16px",background:C.s,borderBottom:`1px solid ${C.b}`,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            display:"flex",alignItems:"center",gap:mob?3:5,padding:mob?"7px 6px":"9px 12px",fontSize:mob?9:11,fontWeight:500,
            color:tab===t.id?C.cy:C.tm,background:tab===t.id?C.cyG:"transparent",
            border:"none",borderBottom:`2px solid ${tab===t.id?C.cy:"transparent"}`,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,
          }}><t.icon size={mob?12:13}/><span>{mob?t.mLabel:t.label}</span></button>
        ))}
      </div>

      <div ref={containerRef} style={{padding:mob?"10px 8px":"14px 16px"}}>

        {/* ═══════ DIGITAL TWIN ═══════ */}
        {tab==="twin"&&(<div>
          <div style={{...grid("repeat(auto-fit,minmax(145px,1fr))","repeat(2,1fr)"),marginBottom:mob?8:12}}>
            <Kpi icon={DollarSign} label="YTD Excess" value={`$${td.cumulativeCost.toLocaleString()}`} color={C.rd} sub={`$${td.dailyExtraCost}/day`}/>
            <Kpi icon={Flame} label="CO₂" value={td.cumulativeCO2.toFixed(1)} unit="t" color={C.am} sub={`${td.dailyCO2.toFixed(2)}t/day`}/>
            <Kpi icon={Gauge} label="Drag" value={`+${td.totalResistanceIncrease}%`} color={C.pu} sub={`${td.fuelPenaltyPct}% fuel`}/>
            <Kpi icon={Clock} label="Clean ROI" value={roiDays} unit="d" color={C.gn} sub={`$${cleanCost.toLocaleString()}`}/>
            {!mob&&<Kpi icon={Thermometer} label="SST" value={td.sst} unit="°C" color={C.cy} sub={vessel.homePort}/>}
            {!mob&&<Kpi icon={Info} label="Confidence" value={skipperData.length>5?"±10%":skipperData.length>2?"±20%":"±30%"} color={skipperData.length>2?C.gn:C.am} sub={`${skipperData.length} reports`}/>}
          </div>

          {/* 3D + Side — stack on mobile */}
          <div style={{display:"flex",gap:mob?0:12,marginBottom:mob?8:12,flexDirection:mob?"column":"row"}}>
            <div style={{flex:"1 1 auto",minWidth:0,background:C.s,borderRadius:10,border:`1px solid ${C.b}`,overflow:"hidden",position:"relative",marginBottom:mob?8:0}}>
              <div style={{position:"absolute",top:8,left:8,zIndex:10,background:`${C.bg}cc`,borderRadius:6,padding:"5px 9px",border:`1px solid ${C.b}`,backdropFilter:"blur(8px)",maxWidth:"70%"}}>
                <div style={{fontSize:mob?11:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{vessel.name}</div>
                <div style={{fontSize:mob?8:10,color:C.tm}}>{vessel.type} · {vessel.loa}m × {vessel.beam}m · Cb {vessel.cb}</div>
              </div>
              {!mob&&<div style={{position:"absolute",top:8,right:8,zIndex:10,background:`${C.bg}cc`,borderRadius:6,padding:"4px 8px",border:`1px solid ${C.b}`,fontSize:9,color:C.tm}}><Eye size={10} style={{marginRight:3}}/>Drag to rotate</div>}
              {cw>50&&<HullScene foulingState={td.fouling} vessel={vessel} width={sceneW} height={sceneH}/>}
              <div style={{position:"absolute",bottom:8,left:8,right:8,zIndex:10,background:`${C.bg}dd`,borderRadius:6,padding:mob?6:10,border:`1px solid ${C.b}`,backdropFilter:"blur(8px)"}}><FBar val={td.fouling}/></div>
            </div>

            {/* Side panel */}
            <div style={{display:"flex",flexDirection:mob?"row":"column",gap:mob?8:10,...(mob?{overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:4}:{}),width:mob?"100%":280,flexShrink:0}}>
              <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?8:10,minWidth:mob?200:0,flexShrink:0}}>
                <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:5,fontWeight:600}}><MapPin size={10} style={{marginRight:3}}/>AIS Track</div>
                <AISMap data={voyageData} currentDay={day} vessel={vessel}/><div style={{display:"flex",gap:8,marginTop:4,fontSize:8}}><span style={{color:"#ffa726"}}>● Idle</span><span style={{color:"#00c8ff"}}>● Harbor</span><span style={{color:"#00d68f"}}>● Transit</span></div>
              </div>
              <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?8:10,fontSize:10,minWidth:mob?170:0,flexShrink:0}}>
                <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:5,fontWeight:600}}><Anchor size={10} style={{marginRight:3}}/>Physics</div>
                {[["WSA",`${td.wsa}m²`],["Re",td.Re],["Fr",td.Fr],["Cf (ITTC-57)",td.Cf],["Coating",`${vessel.coatingAge+day}d`],["Fuel",vessel.fuelType]].map(([k,v])=>(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",borderBottom:`1px solid ${C.b}22`}}><span style={{color:C.tm,fontSize:9}}>{k}</span><span style={{fontFamily:"monospace",fontSize:9}}>{v}</span></div>))}
              </div>
              <div style={{background:C.s,borderRadius:10,border:`1px solid ${cleanDay>=0?C.gn+"66":C.b}`,padding:mob?8:10,minWidth:mob?190:0,flexShrink:0}}>
                <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:5,fontWeight:600}}><Scissors size={10} style={{marginRight:3}}/>Clean Scenario</div>
                {cleanDay<0?<button onClick={()=>setCleanDay(day)} style={{width:"100%",padding:7,borderRadius:6,border:"none",cursor:"pointer",background:`linear-gradient(135deg,${C.gn},#008855)`,color:"#fff",fontSize:10,fontWeight:600}}>Simulate Clean Day {day+1}</button>
                :<div><div style={{fontSize:10,color:C.gn,fontWeight:600,marginBottom:4}}>✓ Clean Day {cleanDay+1}</div>
                  {baselineData&&<div style={{fontSize:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{color:C.tm}}>Without:</span><span style={{color:C.rd,fontFamily:"monospace"}}>${baselineData[364].cumulativeCost.toLocaleString()}</span></div>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{color:C.tm}}>With clean:</span><span style={{color:C.gn,fontFamily:"monospace"}}>${(voyageData[364].cumulativeCost+cleanCost).toLocaleString()}</span></div>
                    <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px solid ${C.b}`,paddingTop:4,fontWeight:600}}><span>Saving:</span><span style={{color:C.gn,fontFamily:"monospace"}}>${Math.max(0,baselineData[364].cumulativeCost-voyageData[364].cumulativeCost-cleanCost).toLocaleString()}</span></div>
                  </div>}
                  <button onClick={()=>setCleanDay(-1)} style={{marginTop:5,width:"100%",padding:5,borderRadius:5,border:`1px solid ${C.b}`,cursor:"pointer",background:C.s2,color:C.tm,fontSize:9}}>Reset</button>
                </div>}
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?"10px 12px":"12px 16px",marginBottom:mob?8:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,flexWrap:"wrap",gap:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>setPlaying(p=>!p)} style={{background:C.cy,border:"none",borderRadius:5,width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                  {playing?<Pause size={12} color="#fff"/>:<Play size={12} color="#fff"/>}</button>
                <span style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,fontWeight:600}}>Timeline</span>
              </div>
              <span style={{fontSize:mob?10:12,fontFamily:"monospace",color:C.cy,fontWeight:600}}>{td.date} · Day {day+1} · {td.activity.replace("_"," ")}{td.avgSpeed>0&&` · ${td.avgSpeed}kn`}</span>
            </div>
            <input type="range" min={0} max={364} value={day} onChange={e=>{setDay(+e.target.value);setPlaying(false)}} style={{width:"100%",accentColor:C.cy,cursor:"pointer"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.td,marginTop:2}}>
              <span>Jan</span><span>Mar</span><span>May</span><span>Jul</span><span>Sep</span><span>Nov</span><span>Dec</span>
            </div>
          </div>

          {/* Charts */}
          <div style={grid("1fr 1fr")}>
            <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
              <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>Fouling & SST</div>
              <ResponsiveContainer width="100%" height={mob?140:170}>
                <AreaChart data={monthlyData}><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.rd} stopOpacity={0.35}/><stop offset="100%" stopColor={C.rd} stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.b}/><XAxis dataKey="month" tick={{fontSize:8,fill:C.tm}}/><YAxis yAxisId="l" tick={{fontSize:8,fill:C.tm}} domain={[0,5]}/><YAxis yAxisId="r" orientation="right" tick={{fontSize:8,fill:C.tm}}/><Tooltip contentStyle={ttS}/>
                  <Area yAxisId="l" type="monotone" dataKey="fouling" stroke={C.rd} fill="url(#fg)" strokeWidth={2} name="FR"/><Line yAxisId="r" type="monotone" dataKey="sst" stroke={C.cy} strokeWidth={1.5} dot={false} name="SST°C"/>
                </AreaChart></ResponsiveContainer>
            </div>
            <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
              <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>Monthly Excess Cost</div>
              <ResponsiveContainer width="100%" height={mob?140:170}>
                <BarChart data={monthlyData}><CartesianGrid strokeDasharray="3 3" stroke={C.b}/><XAxis dataKey="month" tick={{fontSize:8,fill:C.tm}}/><YAxis tick={{fontSize:8,fill:C.tm}} tickFormatter={v=>`$${v>=1000?(v/1000).toFixed(0)+"k":v}`}/><Tooltip contentStyle={ttS} formatter={v=>[`$${v.toLocaleString()}`,"Cost"]}/>
                  <Bar dataKey="cost" radius={[3,3,0,0]}>{monthlyData.map((_,i)=><Cell key={i} fill={i<4?C.am:C.rd}/>)}</Bar>
                </BarChart></ResponsiveContainer>
            </div>
          </div>
        </div>)}

        {/* ═══════ VOYAGE ═══════ */}
        {tab==="voyage"&&(<div>
          <div style={{...grid("1fr 1fr 1fr","1fr 1fr"),marginBottom:mob?8:12}}>
            <Kpi icon={Navigation} label="Active Days" value={voyageData.filter(d=>d.activity!=="idle").length} color={C.cy} sub={`${voyageData.filter(d=>d.activity==="idle").length} idle`}/>
            <Kpi icon={Gauge} label="Avg Speed" value={(voyageData.filter(d=>d.avgSpeed>0).reduce((a,d)=>a+d.avgSpeed,0)/Math.max(1,voyageData.filter(d=>d.avgSpeed>0).length)).toFixed(1)} unit="kn" color={C.gn}/>
            <Kpi icon={Thermometer} label="Avg SST" value={(voyageData.reduce((a,d)=>a+d.sst,0)/voyageData.length).toFixed(1)} unit="°C" color={C.am}/>
          </div>
          <div style={{...grid("1fr 1fr"),marginBottom:mob?8:12}}>
            <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
              <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>Speed Profile</div>
              <ResponsiveContainer width="100%" height={mob?150:190}><AreaChart data={voyageData.filter((_,i)=>i%3===0)}>
                <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.cy} stopOpacity={0.25}/><stop offset="100%" stopColor={C.cy} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.b}/><XAxis dataKey="date" tick={{fontSize:7,fill:C.tm}} tickFormatter={v=>v.slice(5)} interval={20}/><YAxis tick={{fontSize:8,fill:C.tm}}/><Tooltip contentStyle={ttS}/>
                <ReferenceLine x={td.date} stroke={C.cy} strokeDasharray="3 3"/><Area type="monotone" dataKey="avgSpeed" stroke={C.cy} fill="url(#sg)" strokeWidth={1.5} name="Speed(kn)"/>
              </AreaChart></ResponsiveContainer></div>
            <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
              <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>Activity Mix</div>
              <ResponsiveContainer width="100%" height={mob?150:190}><PieChart><Pie data={[{name:"Idle",value:voyageData.filter(d=>d.activity==="idle").length},{name:"Harbor",value:voyageData.filter(d=>d.activity==="harbor_ops").length},{name:"Transit",value:voyageData.filter(d=>d.activity==="transit").length}]} cx="50%" cy="50%" innerRadius={mob?30:45} outerRadius={mob?55:75} paddingAngle={3} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>{[C.am,C.cy,C.gn].map((c,i)=><Cell key={i} fill={c}/>)}</Pie><Tooltip contentStyle={ttS}/></PieChart></ResponsiveContainer></div>
          </div>
          <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
            <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>SST · Idle% · Fouling Correlation</div>
            <ResponsiveContainer width="100%" height={mob?150:190}><LineChart data={monthlyData}><CartesianGrid strokeDasharray="3 3" stroke={C.b}/><XAxis dataKey="month" tick={{fontSize:8,fill:C.tm}}/><YAxis yAxisId="l" tick={{fontSize:8,fill:C.tm}}/><YAxis yAxisId="r" orientation="right" tick={{fontSize:8,fill:C.tm}}/><Tooltip contentStyle={ttS}/><Legend wrapperStyle={{fontSize:9}}/>
              <Line yAxisId="l" type="monotone" dataKey="sst" stroke={C.cy} strokeWidth={2} name="SST°C"/><Line yAxisId="l" type="monotone" dataKey="idlePct" stroke={C.am} strokeWidth={2} name="Idle%" strokeDasharray="5 5"/><Line yAxisId="r" type="monotone" dataKey="fouling" stroke={C.rd} strokeWidth={2} name="FR"/>
            </LineChart></ResponsiveContainer></div>
        </div>)}

        {/* ═══════ COST ═══════ */}
        {tab==="cost"&&(<div>
          <div style={{...grid("repeat(4,1fr)","repeat(2,1fr)"),marginBottom:mob?8:12}}>
            <Kpi icon={DollarSign} label="Annual Excess" value={`$${voyageData[364].cumulativeCost.toLocaleString()}`} color={C.rd}/>
            <Kpi icon={Flame} label="Annual CO₂" value={voyageData[364].cumulativeCO2.toFixed(1)} unit="t" color={C.am}/>
            <Kpi icon={CheckCircle} label="Clean Cost" value={`$${cleanCost.toLocaleString()}`} color={C.gn}/>
            <Kpi icon={TrendingDown} label="Net Saving" value={`$${Math.max(0,voyageData[364].cumulativeCost-cleanCost*2).toLocaleString()}`} color={C.gn} sub="2× clean/yr"/>
          </div>
          <div style={{...grid("2fr 1fr"),marginBottom:mob?8:12}}>
            <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
              <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>Cumulative Cost</div>
              <ResponsiveContainer width="100%" height={mob?180:230}><AreaChart data={voyageData.filter((_,i)=>i%4===0)}>
                <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.rd} stopOpacity={0.3}/><stop offset="100%" stopColor={C.rd} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.b}/><XAxis dataKey="date" tick={{fontSize:7,fill:C.tm}} tickFormatter={v=>v.slice(5)} interval={10}/><YAxis tick={{fontSize:8,fill:C.tm}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/><Tooltip contentStyle={ttS} formatter={v=>[`$${v.toLocaleString()}`,""]}/>
                <ReferenceLine x={td.date} stroke={C.cy} strokeDasharray="3 3"/>{cleanDay>=0&&<ReferenceLine x={voyageData[cleanDay]?.date} stroke={C.gn} strokeWidth={2}/>}
                <Area type="monotone" dataKey="cumulativeCost" stroke={C.rd} fill="url(#cg)" strokeWidth={2} name="Excess"/>
              </AreaChart></ResponsiveContainer></div>
            <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
              <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>ROI</div>
              {[["Daily penalty",`$${td.dailyExtraCost}/d`,C.rd],["Monthly",`$${Math.round(monthPenalty).toLocaleString()}/mo`,C.rd],["Clean cost",`$${cleanCost.toLocaleString()}`,C.cy],["Payback",`${roiDays}d`,C.gn],["12-mo saving",`$${Math.max(0,voyageData[364].cumulativeCost-cleanCost*2).toLocaleString()}`,C.gn]].map(([l,v,c])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 8px",borderRadius:5,background:C.s2,marginBottom:4}}><span style={{fontSize:10,color:C.tm}}>{l}</span><span style={{fontSize:11,fontWeight:700,fontFamily:"monospace",color:c}}>{v}</span></div>))}
              <div style={{marginTop:8,padding:8,borderRadius:5,background:td.fouling>2.5?C.rdD:td.fouling>1.5?C.amD:C.gnD,border:`1px solid ${td.fouling>2.5?C.rd:td.fouling>1.5?C.am:C.gn}44`}}>
                <div style={{fontSize:10,fontWeight:600,color:td.fouling>2.5?C.rd:td.fouling>1.5?C.am:C.gn}}>{td.fouling>2.5?"⚠ CLEAN NOW":td.fouling>1.5?"SCHEDULE 60 DAYS":"✓ OK"}</div>
                <div style={{fontSize:10,lineHeight:1.4,marginTop:2}}>{td.fouling>2.5?`$${td.dailyExtraCost}/day excess.`:td.fouling>1.5?"Nearing intervention point.":"Monitor 90 days."}</div>
              </div></div>
          </div>
          <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?10:14}}>
            <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>CO₂ — CII Impact</div>
            <ResponsiveContainer width="100%" height={mob?130:170}><AreaChart data={voyageData.filter((_,i)=>i%4===0)}>
              <defs><linearGradient id="c2g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.am} stopOpacity={0.25}/><stop offset="100%" stopColor={C.am} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.b}/><XAxis dataKey="date" tick={{fontSize:7,fill:C.tm}} tickFormatter={v=>v.slice(5)} interval={10}/><YAxis tick={{fontSize:8,fill:C.tm}}/><Tooltip contentStyle={ttS}/>
              <Area type="monotone" dataKey="cumulativeCO2" stroke={C.am} fill="url(#c2g)" strokeWidth={2} name="CO₂(t)"/>
            </AreaChart></ResponsiveContainer></div>
        </div>)}

        {/* ═══════ FLEET ═══════ */}
        {tab==="fleet"&&(<div>
          <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1,marginBottom:12,fontWeight:600}}>Fleet — {VESSELS.length} Vessels</div>
          <div style={{display:"grid",gridTemplateColumns:`repeat(auto-fit,minmax(${mob?200:270}px,1fr))`,gap:mob?8:14,marginBottom:mob?8:14}}>
            {fleetData.map(({vessel:v,latest},idx)=>{const fr=Math.min(5,Math.round(latest.fouling));return(
              <div key={v.id} onClick={()=>{setVi(idx);setTab("twin");setDay(364)}}
                style={{background:C.s,borderRadius:10,border:`1px solid ${vi===idx?C.cy:C.b}`,padding:mob?10:14,cursor:"pointer",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:fr<=1?C.gn:fr<=3?C.am:C.rd}}/>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <div><div style={{fontSize:mob?11:13,fontWeight:600}}>{v.name}</div><div style={{fontSize:9,color:C.tm}}>{v.type}</div></div>
                  <div style={{padding:"2px 6px",borderRadius:4,fontSize:9,fontWeight:600,background:fr<=1?C.gnD:fr<=3?C.amD:C.rdD,color:fr<=1?C.gn:fr<=3?C.am:C.rd,whiteSpace:"nowrap",height:"fit-content"}}>{FR_LABELS[fr]}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,fontSize:10}}>
                  {[["Excess",`$${latest.cumulativeCost.toLocaleString()}`,C.rd],["CO₂",`${latest.cumulativeCO2.toFixed(1)}t`,C.am],["Drag",`+${latest.totalResistanceIncrease}%`,C.pu],["Coating",`${v.coatingAge+365}d`,C.t]].map(([l,val,c])=>(
                    <div key={l} style={{padding:"5px 7px",borderRadius:4,background:C.s2}}><div style={{color:C.tm,fontSize:8}}>{l}</div><div style={{fontWeight:700,fontFamily:"monospace",color:c}}>{val}</div></div>))}
                </div>
                <div style={{marginTop:6}}><FBar val={latest.fouling}/></div>
                <div style={{display:"flex",justifyContent:"flex-end",marginTop:4,fontSize:9,color:C.cy}}>View <ChevronRight size={12}/></div>
              </div>)})}
          </div>
          <div style={grid("repeat(3,1fr)")}>
            {[["Fleet Excess",`$${fleetData.reduce((s,f)=>s+f.latest.cumulativeCost,0).toLocaleString()}`,C.rd,"Annual"],["Fleet CO₂",`${fleetData.reduce((s,f)=>s+f.latest.cumulativeCO2,0).toFixed(1)}t`,C.am,"Avoidable"],["Saving","~65%",C.gn,"With proactive cleaning"]].map(([l,v,c,sub])=>(
              <div key={l} style={{background:`linear-gradient(135deg,${c}18,${C.s})`,borderRadius:10,border:`1px solid ${c}33`,padding:mob?12:18,textAlign:"center"}}>
                <div style={{fontSize:9,color:C.tm,textTransform:"uppercase",letterSpacing:1}}>{l}</div>
                <div style={{fontSize:mob?22:30,fontWeight:700,fontFamily:"monospace",color:c,margin:"4px 0"}}>{v}</div>
                <div style={{fontSize:10,color:C.tm}}>{sub}</div></div>))}
          </div>
        </div>)}

        {/* ═══════ SKIPPER INPUT ═══════ */}
        {tab==="input"&&(<div>
          <div style={grid("1fr 1fr")}>
            <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?12:18}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>Ground Truth Collection</div>
              <div style={{fontSize:11,color:C.tm,marginBottom:14,lineHeight:1.5}}>
                Reported data calibrates the model automatically.
                {skipperAdj!==0&&<span style={{color:skipperAdj>0?C.rd:C.gn,fontWeight:600}}> Adjustment: {skipperAdj>0?"+":""}{(skipperAdj*10).toFixed(0)}% growth.</span>}
              </div>
              {[{l:"Speed (kn)",k:"speed",ph:"e.g., 8.5"},{l:"Fuel (L/hr)",k:"fuel",ph:`Baseline: ${vessel.fuelRate}`}].map(({l,k,ph})=>(
                <label key={k} style={{display:"block",marginBottom:8,fontSize:11}}><span style={{color:C.tm,display:"block",marginBottom:2}}>{l}</span>
                  <input type="number" step="0.1" placeholder={ph} value={skipperForm[k]} onChange={e=>setSkipperForm(p=>({...p,[k]:e.target.value}))}
                    style={{width:"100%",padding:"7px 10px",borderRadius:6,background:C.s2,border:`1px solid ${C.b}`,color:C.t,fontSize:12,outline:"none",boxSizing:"border-box"}}/></label>))}
              <label style={{display:"block",marginBottom:8,fontSize:11}}><span style={{color:C.tm,display:"block",marginBottom:2}}>Condition</span>
                <select value={skipperForm.fouling} onChange={e=>setSkipperForm(p=>({...p,fouling:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:6,background:C.s2,border:`1px solid ${C.b}`,color:C.t,fontSize:12,outline:"none",boxSizing:"border-box"}}>
                  {FR_LABELS.map((l,i)=><option key={i} value={`FR${i}`}>{l}</option>)}</select></label>
              <label style={{display:"block",marginBottom:8,fontSize:11}}><span style={{color:C.tm,display:"block",marginBottom:2}}>Notes</span>
                <textarea rows={2} placeholder="e.g., Heavy growth on sea chests..." value={skipperForm.notes} onChange={e=>setSkipperForm(p=>({...p,notes:e.target.value}))}
                  style={{width:"100%",padding:"7px 10px",borderRadius:6,resize:"vertical",background:C.s2,border:`1px solid ${C.b}`,color:C.t,fontSize:12,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/></label>
              <button onClick={handleSkipper} style={{width:"100%",padding:9,borderRadius:6,border:"none",cursor:"pointer",background:`linear-gradient(135deg,${C.cy},#0066bb)`,color:"#fff",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Send size={13}/>Submit</button>
            </div>
            <div>
              <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?12:18,marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Calibration Accuracy</div>
                {[{r:"0",c:"±30%",cl:C.rd,l:"Model-only"},{r:"1-2",c:"±20%",cl:C.am,l:"Initial"},{r:"3-5",c:"±15%",cl:C.am,l:"Good"},{r:"6+",c:"±10%",cl:C.gn,l:"Strong"},{r:"Dive",c:"±5%",cl:C.gn,l:"Gold standard"}].map(({r,c,cl,l})=>(
                  <div key={r} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",borderRadius:5,background:C.s2,marginBottom:3}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:cl,flexShrink:0}}/><div style={{flex:1,fontSize:10}}><span style={{fontWeight:500}}>{r}</span> <span style={{color:C.tm}}>{l}</span></div>
                    <span style={{fontSize:11,fontFamily:"monospace",fontWeight:600,color:cl}}>{c}</span></div>))}
              </div>
              <div style={{background:C.s,borderRadius:10,border:`1px solid ${C.b}`,padding:mob?12:18}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Reports ({skipperData.length})</div>
                {skipperData.length===0?<div style={{fontSize:11,color:C.tm,textAlign:"center",padding:12}}>No reports yet.</div>
                :skipperData.map((r,i)=>(<div key={i} style={{padding:6,borderRadius:5,background:C.s2,border:`1px solid ${C.b}`,fontSize:10,marginBottom:3}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>Day {r.day+1}</span><span style={{color:C.gn}}>✓</span></div>
                  <div style={{color:C.tm}}>{r.speed&&`${r.speed}kn`} {r.fuel&&`· ${r.fuel}L/hr`} · {r.fouling}</div></div>))}
              </div>
            </div>
          </div>
        </div>)}

        {/* ═══════ DOCUMENTATION ═══════ */}
        {tab==="docs"&&(<div style={{maxWidth:800}}>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:mob?16:20,fontWeight:700,marginBottom:4}}>MarineStream Digital Twin</div>
            <div style={{fontSize:12,color:C.tm,lineHeight:1.6}}>Technical documentation covering the fouling simulation model, data requirements, physics engine, and operational guide.</div>
          </div>

          <DocSection title="1. What Is This?" defaultOpen={true}>
            <p>This application creates a <strong style={{color:C.t}}>parametric digital twin</strong> of a vessel's hull and simulates biofouling accumulation over time. It ingests operational profiles (speed, activity, location), environmental data (sea surface temperature), and vessel characteristics to predict hull condition, drag penalties, excess fuel consumption, and CO₂ emissions.</p>
            <p>It is <em>not</em> a CFD simulation. It is a calibrated parametric model — fast enough to run interactively, accurate enough (±10-30% depending on calibration) to support commercial maintenance decisions.</p>
          </DocSection>

          <DocSection title="2. How to Use It">
            <p style={{color:C.t,fontWeight:600}}>Quick Start:</p>
            <p>Select a vessel from the header dropdown. The Digital Twin tab loads immediately with a 3D hull, KPI dashboard, and 365-day simulation. Use the timeline slider or press Play to watch fouling accumulate over a year.</p>
            <p style={{color:C.t,fontWeight:600,marginTop:8}}>Tab Guide:</p>
            <p><strong style={{color:C.cy}}>Digital Twin</strong> — The main view. 3D hull rotates on drag/touch. Fouling colours update as you scrub the timeline. The side panel shows the AIS track, physics parameters (WSA, Re, Cf), and the Cleaning Scenario simulator. Click "Simulate Clean" at any timeline position to compare costs with vs without cleaning.</p>
            <p><strong style={{color:C.cy}}>Voyage Analysis</strong> — Speed profiles, activity breakdown (idle/harbor/transit), and the SST-idle-fouling correlation chart. Use this to understand which operational patterns drive fouling growth.</p>
            <p><strong style={{color:C.cy}}>Cost Impact</strong> — The money tab. Cumulative excess fuel cost, CO₂ trajectory, cleaning ROI calculator, and the auto-generated maintenance recommendation (Clean Now / Schedule / Monitor). This is the board presentation slide.</p>
            <p><strong style={{color:C.cy}}>Fleet Overview</strong> — All vessels at a glance. Click any card to jump to its twin. Shows total fleet excess cost and emissions — the aggregate case for proactive maintenance.</p>
            <p><strong style={{color:C.cy}}>Skipper Input</strong> — Ground truth collection. Skippers or engineers enter observed speed, fuel burn, and hull condition. When fuel burn diverges from model predictions, the growth rate auto-calibrates. Each report tightens accuracy from ±30% toward ±10%.</p>
            <p style={{color:C.t,fontWeight:600,marginTop:8}}>Board Presentation Tips:</p>
            <p>1. Start on the Digital Twin tab with HMAS Perth. Press Play — the hull darkens from blue to brown over the year. Pause at Day 250. 2. Click "Simulate Clean" at Day 120 to show the intervention scenario. 3. Switch to Cost Impact to show the dollar savings. 4. Switch to Fleet to show the aggregate problem. 5. Finish on Skipper Input to explain the calibration moat.</p>
          </DocSection>

          <DocSection title="3. How the Fouling Model Works">
            <p style={{color:C.t,fontWeight:600,marginBottom:4}}>Growth Equation (daily):</p>
            <div style={{background:C.s2,padding:12,borderRadius:6,fontFamily:"monospace",fontSize:11,marginBottom:10,overflowX:"auto"}}>
              ΔFouling = 0.006 × T_factor × Speed_suppression × Coating_factor × Saturation × Calibration
            </div>
            <p><strong style={{color:C.t}}>Temperature factor:</strong> Exponential relationship — each degree above 20°C increases growth rate by ~4%. Correctly models Southern Hemisphere seasonality (peaks Jan-Feb in Perth/Cairns, troughs Jul-Aug).</p>
            <p><strong style={{color:C.t}}>Speed suppression:</strong> Continuous sigmoid function. Stationary hull = full growth (1.0). At 7 knots, boundary layer shear begins removing biofilm (~50% suppression). Above 15 knots, only calcareous growth persists (~5% growth rate).</p>
            <p><strong style={{color:C.t}}>Coating degradation:</strong> Linear increase from 1.0 at application to 2.5× at ~4.4 years. Reflects antifouling biocide depletion — the single strongest predictor of fouling severity (Floerl et al., 2005).</p>
            <p><strong style={{color:C.t}}>Saturation:</strong> Logistic carrying capacity at FR5. Growth decelerates as available colonisation surface reduces. Uses power-law saturation (exponent 1.5) for steeper transition from rapid growth to plateau.</p>
            <p><strong style={{color:C.t}}>Initial condition:</strong> Fouling state is initialised from coating age, not from zero. A 720-day-old coating starts at approximately FR1.5.</p>
          </DocSection>

          <DocSection title="4. Resistance & Cost Physics">
            <p>The drag penalty calculation chain:</p>
            <div style={{background:C.s2,padding:12,borderRadius:6,fontSize:11,marginBottom:10,lineHeight:1.8}}>
              <div><strong style={{color:C.cy}}>1.</strong> <strong style={{color:C.t}}>Wetted Surface Area</strong> — Holtrop-Mennen: S = L(2T+B)√Cm × (0.453 + 0.4425Cb − 0.2862Cm − 0.003467(B/T) + 0.3696Cwp)</div>
              <div><strong style={{color:C.cy}}>2.</strong> <strong style={{color:C.t}}>Reynolds Number</strong> — Re = V×L / ν (ν = 1.19×10⁻⁶ m²/s for seawater)</div>
              <div><strong style={{color:C.cy}}>3.</strong> <strong style={{color:C.t}}>Clean friction</strong> — ITTC-57: Cf = 0.075 / (log₁₀(Re) − 2)²</div>
              <div><strong style={{color:C.cy}}>4.</strong> <strong style={{color:C.t}}>Fouling ΔCf</strong> — FR scale interpolation (0% at FR0 to +193% at FR5, UoM validated)</div>
              <div><strong style={{color:C.cy}}>5.</strong> <strong style={{color:C.t}}>Wave resistance ratio</strong> — Smooth sigmoid f(Fr), replaces step function</div>
              <div><strong style={{color:C.cy}}>6.</strong> <strong style={{color:C.t}}>Total resistance increase</strong> — ΔR_T = ΔCf / (1 + Cr/Cf + Ca/Cf)</div>
              <div><strong style={{color:C.cy}}>7.</strong> <strong style={{color:C.t}}>Propulsive efficiency</strong> — Speed-dependent curve peaking at ~65% design speed</div>
              <div><strong style={{color:C.cy}}>8.</strong> <strong style={{color:C.t}}>Fuel penalty</strong> — ΔFuel = ΔR_T × (0.65 / η_prop)</div>
              <div><strong style={{color:C.cy}}>9.</strong> <strong style={{color:C.t}}>CO₂</strong> — Fuel-type specific: MDO 3.206, F-76 3.206, HFO 3.114 kg CO₂/kg fuel</div>
            </div>
          </DocSection>

          <DocSection title="5. FR Rating Scale (Validated)">
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{borderBottom:`2px solid ${C.b}`}}>{["Rating","Description","ΔCf (friction)","Validation"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left",color:C.t,fontWeight:600}}>{h}</th>)}</tr></thead>
                <tbody>{[["FR0","Clean hull, new coating","+0%","Baseline"],["FR1","Light biofilm / slime","+15%","Research calibrated"],["FR2","Medium slime film","+35%","Research calibrated"],["FR3","Heavy slime, light weed","+60%","Research calibrated"],["FR4","Light calcareous growth","+95%","Rio Tinto tug study"],["FR5","Heavy calcareous / barnacles","+193%","Coral Adventurer study"]].map(([r,d,f,v],i)=>
                  <tr key={r} style={{borderBottom:`1px solid ${C.b}22`,background:i%2===0?C.s2:"transparent"}}><td style={{padding:"5px 8px",fontWeight:600,color:FR_COLORS[i]?`rgb(${FR_COLORS[i].map(c=>Math.round(c*255)).join(",")})`:C.t}}>{r}</td><td style={{padding:"5px 8px"}}>{d}</td><td style={{padding:"5px 8px",fontFamily:"monospace",color:C.am}}>{f}</td><td style={{padding:"5px 8px",color:C.tm}}>{v}</td></tr>)}</tbody>
              </table>
            </div>
          </DocSection>

          <DocSection title="6. Data Requirements">
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{borderBottom:`2px solid ${C.b}`}}>{["Data","Minimum","Ideal","Source"].map(h=><th key={h} style={{padding:"5px 8px",textAlign:"left",color:C.t,fontWeight:600}}>{h}</th>)}</tr></thead>
                <tbody>{[["Vessel dimensions","L, B, T, type","+Cb, Cm, Cwp, displacement","MarineStream"],["AIS history","3 months","12+ months, 5min resolution","AIS provider"],["Sea surface temp","Monthly regional avg","Daily, 0.25° grid","NOAA OISST"],["Coating info","Type + application date","+system, DFT readings","Vessel records"],["Inspections","1 per vessel","Quarterly with FR ratings","Franmarine"],["Fuel baseline","Estimated (Holtrop)","Actual noon report data","Operator"],["Fuel price","Fixed assumption","Live bunker prices","Ship & Bunker"]].map(([d,mn,id,src],i)=>
                  <tr key={d} style={{borderBottom:`1px solid ${C.b}22`,background:i%2===0?C.s2:"transparent"}}><td style={{padding:"5px 8px",fontWeight:500,color:C.t}}>{d}</td><td style={{padding:"5px 8px"}}>{mn}</td><td style={{padding:"5px 8px"}}>{id}</td><td style={{padding:"5px 8px",color:C.cy}}>{src}</td></tr>)}</tbody>
              </table>
            </div>
          </DocSection>

          <DocSection title="7. Confidence & Calibration">
            <p>Model accuracy depends on ground truth calibration data:</p>
            <p><strong style={{color:C.rd}}>No calibration (±30%):</strong> Pure model prediction from vessel parameters and environmental data. Suitable for fleet-level estimates and trend analysis, not individual vessel decisions.</p>
            <p><strong style={{color:C.am}}>Skipper reports (±15-20%):</strong> When skippers report actual fuel burn rates, the model detects divergence from predictions and adjusts the growth rate coefficient. 3-5 reports bring meaningful improvement.</p>
            <p><strong style={{color:C.gn}}>Dive inspection (±5-10%):</strong> A single Franmarine inspection with FR ratings per zone provides direct ground truth. The model recalibrates all growth parameters to match observed conditions. This is Franmarine's competitive advantage — pure software companies cannot generate this data.</p>
          </DocSection>

          <DocSection title="8. 3D Hull Visualisation">
            <p>The hull is parametrically generated from vessel dimensions using superellipse cross-sections. The block coefficient (Cb) drives section fullness — a tug with Cb 0.55 has visibly fuller midship sections than a frigate at Cb 0.48.</p>
            <p><strong style={{color:C.t}}>Fouling zones:</strong> The colour overlay varies by hull zone. Bottom flat plates (highest multiplier 1.25×), bow/stern niche areas (1.35× — these foul fastest due to low flow), waterline (0.85×), keel centreline (1.15×), and above-waterline (0.15× — minimal).</p>
            <p><strong style={{color:C.t}}>Features:</strong> Twin/single propellers with spinning blades, rudder, bulbous bow (where applicable), boot-topping waterline stripe, animated water surface, and underwater particles. Touch-enabled for tablet presentations.</p>
          </DocSection>

          <DocSection title="9. Cleaning Scenario Simulator">
            <p>Click "Simulate Clean" on any timeline day to model a 95% fouling removal event. The system runs a parallel 365-day simulation without cleaning and compares the two trajectories. The resulting delta shows net annual savings after deducting cleaning cost.</p>
            <p>This is the key board presentation tool — it directly answers "what is hull cleaning worth to us in dollars?"</p>
          </DocSection>

          <DocSection title="10. Known Limitations">
            <p>• <strong style={{color:C.t}}>No stochastic biological events.</strong> Mass barnacle settlement from spawning events cannot be predicted. Model shows smooth growth; reality has step changes.</p>
            <p>• <strong style={{color:C.t}}>No species composition.</strong> The FR scale abstracts all fouling into a roughness equivalent. Different species at the same FR have different drag characteristics.</p>
            <p>• <strong style={{color:C.t}}>Niche areas modelled as multipliers, not separately.</strong> Sea chest fouling, propeller roughness, and rudder fouling contribute disproportionately to performance loss but are approximated, not independently modelled.</p>
            <p>• <strong style={{color:C.t}}>Loading condition not dynamic.</strong> Ballast vs laden draft changes are not yet simulated day-by-day. The Gold Standard paper showed dramatically different speed-fuel exponents for different loading states.</p>
            <p>• <strong style={{color:C.t}}>AIS data is simulated.</strong> This MVP generates synthetic voyage data. Production version requires live AIS feed integration (Datalastic, AISStream, or equivalent).</p>
          </DocSection>

          <DocSection title="11. Roadmap">
            <p><strong style={{color:C.cy}}>Phase 2 — AIS Integration:</strong> Connect to live AIS. Map positions to NOAA SST API. Replace simulated voyage profiles with real operational data.</p>
            <p><strong style={{color:C.cy}}>Phase 3 — Calibration Loop:</strong> Integrate Franmarine inspection reports as ground truth. Bayesian parameter update when model predictions diverge from observed FR states.</p>
            <p><strong style={{color:C.cy}}>Phase 4 — MarineStream Production:</strong> Multi-vessel dashboard, automated cleaning schedule optimisation, regulatory compliance reporting (IMO CII), export for client proposals.</p>
          </DocSection>

          <DocSection title="12. References">
            <p style={{fontSize:11,lineHeight:1.8}}>
              • Uzun et al. (2019) — Time-dependent biofouling growth model, ~32% frictional resistance increase validated over 1 year<br/>
              • Demirel et al. (2017) — Fouling roughness to drag increment modelling<br/>
              • Floerl et al. (2005) — Coating age as strongest predictor, classification tree analysis on 783 vessels<br/>
              • Holtrop & Mennen (1982) — Statistical resistance prediction method<br/>
              • ITTC (1957) — Friction line for smooth hull baseline<br/>
              • University of Melbourne / AQUAMARS — FR0-FR5 drag coefficients, validated on Coral Adventurer and Rio Tinto tug<br/>
              • Mittendorf et al. (2023) — Incremental learning neural network for fouling concept drift (digital twin approach)<br/>
              • Nikolaidis et al. (2024) — ML regression: ~11.3% power increase at advanced fouling, Extra Trees at 1.1% error<br/>
              • Degiuli et al. (2023) — Deterministic fouling & cost model, optimal cleaning interval computation
            </p>
          </DocSection>
        </div>)}

      </div>

      {/* FOOTER */}
      <div style={{borderTop:`1px solid ${C.b}`,padding:mob?"8px 10px":"10px 20px",display:"flex",justifyContent:"space-between",fontSize:8,color:C.td,flexWrap:"wrap",gap:4}}>
        <span>MarineStream Digital Twin v3.0 · Franmarine Underwater Services · Confidential</span>
        <span>Holtrop-Mennen WSA · ITTC-57 · Logistic growth + SST(SH) · UoM FR coefficients</span>
      </div>
    </div>
  );
}
