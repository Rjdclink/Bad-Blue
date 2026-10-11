const assert = require('node:assert/strict');
const path = require('node:path');
// Manual lifecycle tests. See docs/SPECTRA_MAP_REVIEW_2026-10-10.md for optional test dependencies.
const fs = require('node:fs');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const toolsRoot = process.env.SPECTRA_MAP_TEST_TOOLS || root;
const toolRequire = createRequire(path.join(toolsRoot, 'package.json'));
const esbuild = toolRequire('esbuild');
const React = toolRequire('react');
const {create, act} = toolRequire('react-test-renderer');
const FakeTimers = toolRequire('@sinonjs/fake-timers');
const output = fs.mkdtempSync(path.join(toolsRoot, '.spectra-map-qa-'));
class Events {
  constructor() { this.events = new Map(); }
  on(name, ...args) { const fn=args.at(-1); const list=this.events.get(name)||[]; list.push(fn);this.events.set(name,list);return this; }
  off(name, fn) { if (!name) this.events.clear(); else this.events.set(name,(this.events.get(name)||[]).filter(x=>x!==fn));return this; }
  emit(name, data={}) { for(const fn of [...(this.events.get(name)||[])]) fn(data); }
  addEventListener(name, fn) { this.on(name, fn); }
  removeEventListener(name, fn) { this.off(name, fn); }
}
const gpuMaps=[], rasterMaps=[], tiles=[];
let throwGpu=false;
class GpuMap extends Events {
  constructor(options) { super(); if(throwGpu)throw Error('No WebGL'); this.options=options;this.canvas=new Events(); this.sources={};this.setStyle(options.style);gpuMaps.push(this); }
  setStyle(style) { this.loaded=false;this.style=typeof style==='string'?{version:8,sources:{},layers:[]}:structuredClone(style);this.sources={};for(const [id,s]of Object.entries(this.style.sources))this.addSource(id,s); }
  getStyle(){return this.style;}
  isStyleLoaded(){return this.loaded;}
  addControl(){}
  getCanvas(){return this.canvas;}
  addSource(id,s){this.style.sources[id]=s;this.sources[id]={...s,setData(d){this.data=d;},setTiles(t){this.tiles=t;}};}
  getSource(id){return this.sources[id];}
  removeSource(id){delete this.sources[id];delete this.style.sources[id];}
  addLayer(layer,before){const i=this.style.layers.findIndex(x=>x.id===before);this.style.layers.splice(i<0?this.style.layers.length:i,0,layer);}
  getLayer(id){return this.style.layers.find(x=>x.id===id);}
  removeLayer(id){this.style.layers=this.style.layers.filter(x=>x.id!==id);}
  setLayoutProperty(id,k,v){const l=this.getLayer(id);l.layout={...l.layout,[k]:v};}
  setPaintProperty(){}
  setTerrain(value){this.terrain=value;}
  easeTo(){}
  getPitch(){return 0;}
  getBearing(){return 0;}
  resize(){}
  remove(){this.removed=true;this.events.clear();}
}
class Popup { remove(){} }
class RasterMap extends Events {
  constructor(){super();this.layers=new Set();this.attributions=new Map();rasterMaps.push(this);}
  invalidateSize(){}
  removeLayer(l){if(this.layers.delete(l))l.emit('remove');}
  remove(){for(const l of [...this.layers])this.removeLayer(l);this.removed=true;this.events.clear();}
}
class Tile extends Events {
  constructor(url,options){super();this.url=url;this.options=options;tiles.push(this);}
  addTo(map){
    map.layers.add(this);
    const credit=this.options.attribution;
    if(credit){
      map.attributions.set(credit,(map.attributions.get(credit)||0)+1);
      // Leaflet's attribution control listens to the layer's remove event.
      this.on('remove',()=>{const count=map.attributions.get(credit)-1;if(count)map.attributions.set(credit,count);else map.attributions.delete(credit);});
    }
    return this;
  }
}
global.__testGpu={Map:GpuMap,Popup,NavigationControl:class{},ScaleControl:class{}};
global.__testLeaflet={map:()=>new RasterMap(),control:{zoom:()=>({addTo(){}}),scale:()=>({addTo(){}})},layerGroup:()=>({addTo(){return this;},clearLayers(){}}),tileLayer:(...args)=>new Tile(...args)};
global.ResizeObserver=class{observe(){}disconnect(){}};
const clock=FakeTimers.install({toFake:['setTimeout','clearTimeout','Date']});
const noop=()=>{};
const nodeMock=()=>({addEventListener:noop,removeEventListener:noop,replaceChildren:noop});
const base={currentFrame:null,trail:[],futurecast:[],candidateLocations:[],mapMode:'satellite',isLive:false,lockOnTarget:false,layers:{satellite:true,earthObservation:false,trail:false,heatmap:false,markers:false,futurecast:false,reticle:false,weather:false,terrain:false,buildings:false,uncertainty:false,streetImagery:false}};
fs.writeFileSync(path.join(output,'fake-gpu.cjs'),'module.exports=global.__testGpu');fs.writeFileSync(path.join(output,'fake-leaflet.cjs'),'module.exports=global.__testLeaflet');
function bundle(entry,name){return esbuild.build({entryPoints:[path.join(root,entry)],outfile:path.join(output,name+'.cjs'),bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],define:{'import.meta.env':'{}'},plugins:[{name:'mocks',setup(b){b.onResolve({filter:/\.css$/},()=>({path:'empty',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));b.onResolve({filter:/^(maplibre-gl|leaflet)$/},args=>({path:path.join(output,args.path==='leaflet'?'fake-leaflet.cjs':'fake-gpu.cjs')}));}}]});}
let view,pass=0;
function mount(Component,props=base){act(()=>{view=create(React.createElement(Component,props),{createNodeMock:nodeMock});});}
function tick(n){act(()=>clock.tick(n));}
function emit(map,event,data){act(()=>{if(event==='style.load')map.loaded=true;map.emit(event,data);});}
function unmount(){act(()=>view.unmount());assert.equal(clock.countTimers(),0,'Unmount leaks no deadlines');}
function test(name,fn){tiles.length=0;rasterMaps.length=0;gpuMaps.length=0;throwGpu=false;fn();pass++;console.log('PASS',name);}
(async()=>{
await bundle('client/src/components/geoconsole/MapLibreIntelligenceMap.tsx','gpu-component');
await bundle('client/src/components/geoconsole/RasterIntelligenceMap.tsx','raster-component');
const Gpu=require(path.join(output,'gpu-component.cjs')).default, Raster=require(path.join(output,'raster-component.cjs')).default;
test('NASA is present at construction without a target',()=>{mount(Gpu);const m=gpuMaps[0];assert.equal(m.options.style.sources['spectra-satellite'].maxzoom,8);assert.deepEqual(m.options.center,[0,20]);unmount();});
test('Stalled startup releases GPU and opens raster in 10 seconds',()=>{mount(Gpu);tick(9999);assert.equal(rasterMaps.length,0);tick(1);assert.equal(rasterMaps.length,1);assert.ok(gpuMaps[0].removed);assert.match(tiles[0].url,/BlueMarble/);unmount();});
test('Default style error recovers instead of blank panel',()=>{mount(Gpu);emit(gpuMaps[0],'error',{error:Error('Style failed')});assert.equal(rasterMaps.length,1);unmount();});
test('No WebGL opens NASA raster immediately',()=>{throwGpu=true;mount(Gpu);assert.equal(rasterMaps.length,1);assert.match(tiles[0].url,/BlueMarble/);unmount();});
test('Successful initialization cancels startup timeout',()=>{mount(Gpu);emit(gpuMaps[0],'style.load');tick(15000);assert.equal(rasterMaps.length,0);unmount();});
test('Unrestored graphics context falls back',()=>{mount(Gpu);const m=gpuMaps[0];emit(m,'style.load');act(()=>m.canvas.emit('webglcontextlost',{preventDefault(){}}));tick(10000);assert.equal(rasterMaps.length,1);assert.ok(m.removed);unmount();});
test('Restored graphics context cancels fallback',()=>{mount(Gpu);const m=gpuMaps[0];emit(m,'style.load');act(()=>m.canvas.emit('webglcontextlost',{preventDefault(){}}));tick(9000);act(()=>m.canvas.emit('webglcontextrestored'));tick(2000);assert.equal(rasterMaps.length,0);unmount();});
test('Style mode change rearms deadline',()=>{mount(Gpu);const m=gpuMaps[0];emit(m,'style.load');act(()=>view.update(React.createElement(Gpu,{...base,mapMode:'street'})));tick(10000);assert.equal(rasterMaps.length,1);unmount();});
test('Replacement style restores overlays before all tiles load',()=>{mount(Gpu);const m=gpuMaps[0];emit(m,'style.load');act(()=>view.update(React.createElement(Gpu,{...base,mapMode:'street'})));assert.equal(m.loaded,false);act(()=>m.emit('style.load'));assert.ok(m.getSource('spectra-satellite'));assert.ok(m.getLayer('spectra-candidate-area'));tick(15000);assert.equal(rasterMaps.length,0);unmount();});
test('Satellite fallback updates zoom and attribution',()=>{mount(Gpu);const m=gpuMaps[0];emit(m,'style.load');for(let i=0;i<3;i++)emit(m,'error',{sourceId:'spectra-satellite'});const s=m.getSource('spectra-satellite');assert.equal(s.maxzoom,19);assert.match(s.attribution,/Esri/);assert.equal(m.getLayer('spectra-satellite').type,'raster');unmount();});
test('3D terrain and buildings survive the inline NASA style',()=>{const p={...base,layers:{...base.layers,terrain:true,buildings:true}};mount(Gpu,p);const m=gpuMaps[0];assert.equal(m.options.pitch,52);emit(m,'style.load');assert.equal(m.terrain.source,'spectra-terrain-dem');assert.equal(m.getLayer('spectra-buildings-3d').type,'fill-extrusion');assert.equal(m.getSource('spectra-buildings-source').url,'https://tiles.openfreemap.org/planet');emit(m,'error',{sourceId:'spectra-buildings-source'});assert.equal(m.getLayer('spectra-buildings-3d').layout.visibility,'none');assert.equal(m.getLayer('spectra-satellite').layout.visibility,'visible');unmount();});
test('A 3D request still shows NASA on browsers without WebGL',()=>{throwGpu=true;mount(Gpu,{...base,layers:{...base.layers,terrain:true,buildings:true}});assert.match(tiles[0].url,/BlueMarble/);act(()=>tiles[0].emit('tileload'));assert.match(JSON.stringify(view.toJSON()),/3D unavailable in this browser/);unmount();});
test('NASA raster success cancels its deadline',()=>{mount(Raster);assert.equal(tiles[0].options.maxNativeZoom,8);act(()=>tiles[0].emit('tileload'));tick(15000);assert.equal(tiles.length,1);assert.match(JSON.stringify(view.toJSON()),/August 2004/);unmount();});
test('Raster style switching releases old provider credits',()=>{
  mount(Raster,{...base,mapMode:'hybrid'});
  const m=rasterMaps[0];
  assert.equal(m.attributions.size,2);
  act(()=>view.update(React.createElement(Raster,{...base,mapMode:'street',layers:{...base.layers,satellite:false}})));
  assert.deepEqual([...m.attributions.keys()],['&copy; OpenStreetMap contributors']);
  act(()=>view.update(React.createElement(Raster,base)));
  assert.equal(m.attributions.size,1);
  assert.match([...m.attributions.keys()][0],/NASA/);
  unmount();
  assert.equal(m.attributions.size,0);
});
test('Raster provider fallback releases the failed provider credit',()=>{
  mount(Raster);
  const m=rasterMaps[0];
  tick(10000);
  assert.deepEqual([...m.attributions.keys()],['Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community']);
  unmount();
  assert.equal(m.attributions.size,0);
});
test('Raster outages terminate with honest unavailable state',()=>{mount(Raster);tick(10000);assert.match(tiles[1].url,/arcgisonline/);tick(10000);assert.match(tiles[2].url,/openstreetmap/);tick(10000);assert.match(JSON.stringify(view.toJSON()),/temporarily unavailable/);tick(10000);assert.equal(tiles.length,3);unmount();});
test('Three raster errors advance provider and clear old listeners',()=>{mount(Raster);const old=tiles[0];act(()=>{old.emit('tileerror');old.emit('tileerror');old.emit('tileerror');});assert.equal(old.events.size,0);assert.match(tiles[1].options.attribution,/Esri/);assert.equal(tiles[1].options.zIndex,0);unmount();});
console.log(`${pass} lifecycle tests passed`);
clock.uninstall();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  clock.uninstall();
  fs.rmSync(output,{recursive:true,force:true});
});
