// Web Worker: executes original CroPatella Python sampling functions IN THE BROWSER.
// No model processing, STL data or uploaded files are sent to a server.
// Runtime packages (numpy, trimesh, Pyodide) load from a public CDN on first use.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/pyodide.mjs";

let pyodide;
let initialized;
const PYODIDE_URL='https://cdn.jsdelivr.net/pyodide/v0.29.5/full/';

async function initialize(){
  self.postMessage({type:'loading'});
  pyodide=await loadPyodide({indexURL:PYODIDE_URL});
  await pyodide.loadPackage(['numpy']);

  const response = await fetch(
    new URL('./vendor/trimesh.zip', import.meta.url),
    {cache:'no-store'}
  );

  if (!response.ok) {
    throw new Error('Missing local trimesh package');
  }

  await pyodide.unpackArchive(
    await response.arrayBuffer(),
    'zip',
    {extractDir:'/home/pyodide'}
  );

  pyodide.runPython(
    "import sys; sys.path.insert(0, '/home/pyodide'); import trimesh"
  );
  const code=await fetch(new URL('./model.py',import.meta.url)).then(r=>{
    if(!r.ok)throw new Error('Could not load model.py');return r.text();
  });
  await pyodide.runPythonAsync(code);
  self.postMessage({type:'ready'});
}
initialized=initialize().catch(e=>{
  self.postMessage({type:'init_error',error:String(e?.message||e)});
  throw e;
});
self.onmessage=async event=>{
  if(event.data.type!=='process')return;
  const {id,bytes}=event.data;
  try{
    await initialized;
    pyodide.FS.writeFile('/tmp/cropatella_input.stl',new Uint8Array(bytes));
    const output=pyodide.runPython(`import json
with open('/tmp/cropatella_input.stl','rb') as _f:
    _result=process_stl_data(_f.read())
json.dumps(_result)`);
    self.postMessage({type:'result',id,result:JSON.parse(output)});
  }catch(e){self.postMessage({type:'error',id,error:String(e?.message||e)});}
};
