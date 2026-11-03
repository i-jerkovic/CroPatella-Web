// CroPatella static GitHub Pages frontend — source UI adapted from original Dash app.py
// Exact original Python feature extraction executes client-side using Pyodide in a Web Worker.
const $ = id => document.getElementById(id);
const view = $('stl-viewer');
const camera = {eye:{x:1.25,y:1.25,z:1.25}};
const worker = new Worker(new URL('./worker-hf-5361abcd.mjs', import.meta.url), {type:'module'});
let nextId=0;
const pending=new Map();
let ready=false, mostRecent=0;
let initFailure=null;
const MAX_BYTES=25 * 1024 * 1024;

worker.addEventListener('message', e => {
  const m=e.data;
  if(m.type==='ready') {ready=true;initFailure=null; if(mostRecent===0) setStatus('Upload a patella STL to begin.'); return;}
  if(m.type==='loading') {if(mostRecent===0) setStatus('Preparing local analysis in your browser (first visit may take a little longer)…'); return;}
  if(m.type==='init_error') {initFailure=m.error;setStatus('Could not initialize browser analysis: '+m.error);return;}
  if(m.type==='result' || m.type==='error') {const req=pending.get(m.id); if(req){pending.delete(m.id); (m.type==='result'?req.resolve:req.reject)(m.type==='result'?m.result:new Error(m.error));}}
});
worker.addEventListener('error', e=>{initFailure=e.message||'Worker failed';setStatus('Browser analysis error: '+initFailure)});

function setStatus(s){$('status-text').textContent=s}
function clearInputs(){for(const id of ['centroid-size-text','probability-text','decision-text']) $(id).value='';$('plausibility-text').textContent=''}
function setButtonsBusy(v){for(const id of ['btn-example-f','btn-example-m']) $(id).disabled=v;}
function reset(){mostRecent++; clearInputs(); setStatus('Cleared. Upload a patella STL to begin.');$('upload-stl').value='';emptyPlot();}

function layout(){return {uirevision:'camera',margin:{l:10,r:10,t:10,b:10},scene:{aspectmode:'data',xaxis:{title:'x (mm)'},yaxis:{title:'y (mm)'},zaxis:{title:'z (mm)'},camera},showlegend:false,paper_bgcolor:'#fff'};}
function plotConfig(){return {displayModeBar:true,responsive:true,scrollZoom:false,displaylogo:false}}
function emptyPlot(){if(!window.Plotly){setStatus('Unable to load Plotly (network blocked).');return;}return Plotly.react(view,[],layout(),plotConfig());}

function parseSTL(buffer){
 const dv=new DataView(buffer), bytes=new Uint8Array(buffer), n=bytes.length;
 if(n<15) throw new Error('File too small to be an STL.');
 const count=n>=84?dv.getUint32(80,true):0;
 const binaryValid=count>0 && 84+count*50===n;
 const tris=[];
 if(binaryValid){
   if(count>250000) throw new Error('For browser visualization limit is 250,000 triangles.');
   for(let f=0;f<count;f++){
    const off=84+f*50+12, tri=[];
    for(let j=0;j<3;j++){
      const p=off+j*12;
      const x=dv.getFloat32(p,true),y=dv.getFloat32(p+4,true),z=dv.getFloat32(p+8,true);
      if(![x,y,z].every(Number.isFinite)) throw new Error('Invalid STL coordinates.');
      tri.push([x,y,z]);
    }
    tris.push(tri);
   }
 } else {
   const text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
   if(!/^\s*solid\b/i.test(text))throw new Error('Not a recognized binary or ASCII STL.');
   const reg=/\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
   let match,triplet=[];
   while((match=reg.exec(text))){const v=[+match[1],+match[2],+match[3]];if(!v.every(Number.isFinite)) throw new Error('Invalid STL coordinates');triplet.push(v);if(triplet.length===3){tris.push(triplet);triplet=[];}}
   if(!tris.length||triplet.length) throw new Error('No complete faces found in STL.');
   if(tris.length>250000)throw new Error('For browser visualization limit is 250,000 triangles.');
 }
 const x=[],y=[],z=[],i=[],j=[],k=[];
 tris.forEach((t,f)=>{for(const p of t){x.push(p[0]);y.push(p[1]);z.push(p[2]);}i.push(f*3);j.push(f*3+1);k.push(f*3+2);});
 return {x,y,z,i,j,k};
}

function requestModel(buffer){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({type:'process',id,bytes:buffer},[buffer]);});}

function drawMesh(mesh,result){
  const traces=[{type:'mesh3d',x:mesh.x,y:mesh.y,z:mesh.z,i:mesh.i,j:mesh.j,k:mesh.k,opacity:.55,color:'#2b6cb0',name:'Patella',showscale:false,hoverinfo:'skip'}];
  for(const ep of result.radial_endpoints){traces.push({type:'scatter3d',x:[result.centroid[0],ep[0]],y:[result.centroid[1],ep[1]],z:[result.centroid[2],ep[2]],mode:'lines',line:{color:'rgba(74,85,104,0.35)',width:2},showlegend:false,hoverinfo:'skip'});}
  traces.push({type:'scatter3d',x:[result.centroid[0]],y:[result.centroid[1]],z:[result.centroid[2]],mode:'markers+text',marker:{size:10,color:'#c53030',symbol:'diamond',line:{color:'white',width:2}},text:[`Centroid (${result.centroid_size.toFixed(2)} mm)`],textposition:'top center',textfont:{color:'#1a365d',size:12,family:'Quicksand'},name:'Centroid',showlegend:false,hoverinfo:'skip'});
  return Plotly.react(view,traces,layout(),plotConfig());
}

async function process(buffer,label){
 const token=++mostRecent;
 clearInputs();setStatus(`Processing ${label}…`);
 setButtonsBusy(true);
 try{
  if(!window.Plotly) throw new Error('3D viewer library did not load.');
  const mesh=parseSTL(buffer);
  const result=await requestModel(buffer);
  if(token!==mostRecent)return;
  await drawMesh(mesh,result);
  $('centroid-size-text').value=result.centroid_size.toFixed(2)+' mm';
  $('probability-text').value=result.probability.toFixed(3);
  $('decision-text').value=result.decision;
  $('plausibility-text').textContent=result.plausibility||'';
  setStatus('STL processed.');
  
console.info('Browser libraries:',result.numpy_version,result.trimesh_version);

if(label.startsWith('example_')) {
    const ref = {
        'example_female.stl':[17.509344,0.429177],
        'example_male.stl':[19.423029,0.578290]
    }[label];

    const pass =
        Math.abs(result.centroid_size-ref[0]) < 0.005 &&
        Math.abs(result.probability-ref[1]) < 0.0005;

    console[pass?'info':'error'](
        'CROPATELLA HF PARITY',
        label, pass?'PASS':'FAIL', result
    );

    if(!pass)
        setStatus('HF PARITY FAIL - do not publish.');

    window.croPrevious ??= {};
    const prev = window.croPrevious[label];

    if(prev) {
        const same =
            Math.abs(prev[0]-result.centroid_size)<1e-12 &&
            Math.abs(prev[1]-result.probability)<1e-12;

        console[same?'info':'error'](
            'CROPATELLA REPEATABILITY',
            label, same?'PASS':'FAIL'
        );

        if(!same)
            setStatus('Repeatability FAIL - do not publish.');
    }

    window.croPrevious[label] = [
        result.centroid_size,
        result.probability
    ];
}
}catch(err){if(token===mostRecent){clearInputs();setStatus('Error loading STL: '+(err?.message||String(err)));console.error(err);}}
 finally{if(token===mostRecent)setButtonsBusy(false);}
}

async function fromExample(side){
 try{
  const name=side==='female'?'example_female.stl':'example_male.stl';
  const response=await fetch('assets/'+name,{cache:'no-store'});
  if(!response.ok) throw new Error('Example file not found: '+name+'. Run prepare_from_ubuntu.sh.');
  await process(await response.arrayBuffer(),name);
 }catch(e){setStatus('Error loading example: '+e.message);}
}
$('btn-clear').addEventListener('click',reset);
$('btn-example-f').addEventListener('click',()=>fromExample('female'));
$('btn-example-m').addEventListener('click',()=>fromExample('male'));
$('upload-stl').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>MAX_BYTES){setStatus('Maximum upload size for this browser demo: 25 MB.');return;}await process(await file.arrayBuffer(),file.name);});
const area=$('upload-area');
area.addEventListener('dragover',e=>{e.preventDefault();area.classList.add('dragging')});
area.addEventListener('dragleave',()=>area.classList.remove('dragging'));
area.addEventListener('drop',async e=>{e.preventDefault();area.classList.remove('dragging');const file=e.dataTransfer.files[0];if(!file)return;if(file.size>MAX_BYTES){setStatus('Maximum upload size for this browser demo: 25 MB.');return;}await process(await file.arrayBuffer(),file.name);});
emptyPlot();
