// Isolated instrumentation: no changes to production modules on disk.
// node scripts/benchmark-contact.mjs [engine-snapshot.ts] [diagnostic-input.json]
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const enginePath = resolve('src/geometry/multi-piece-nesting-engine.ts').replaceAll('\\','/');
const source = readFileSync(process.argv[2] ?? enginePath,'utf8');
const metrics = () => ({generated:0,exact:0,contact:0});
globalThis.__nestBench = metrics();
const server = await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{
  name:'isolated-nesting-measurement',enforce:'pre',
  transform(code,id) {
    if(id === enginePath) return source
      .replace('  const profile = input.diagnosticProfiling','  globalThis.__nestBench = {generated:0,exact:0,contact:0}; const measuredStart=performance.now();\n  const profile = input.diagnosticProfiling')
      .replaceAll('yield { x, y, variant, rejected };','globalThis.__nestBench.generated++; yield { x, y, variant, rejected };')
      .replace('  // Phase 2 starts', '  const requiredMeasurement={...globalThis.__nestBench,ms:performance.now()-measuredStart,evaluated:diagnostics.candidatePlacementsTested,translations:diagnostics.polygonTranslations,transforms:diagnostics.polygonTransforms}; const fillerStart=performance.now();\n  // Phase 2 starts')
      .replace('  const result: MultiNestingResult = {','  globalThis.__nestBench.required=requiredMeasurement; globalThis.__nestBench.filler={ms:performance.now()-fillerStart,...Object.fromEntries(["generated","exact","contact"].map(k=>[k,globalThis.__nestBench[k]-requiredMeasurement[k]])),evaluated:diagnostics.candidatePlacementsTested-requiredMeasurement.evaluated,translations:diagnostics.polygonTranslations-requiredMeasurement.translations,transforms:diagnostics.polygonTransforms-requiredMeasurement.transforms};\n  const result: MultiNestingResult = {');
    if(id.endsWith('/polygon-collision.ts')) return code.replace('  if (first.length < 3', '  globalThis.__nestBench.exact++;\n  if (first.length < 3');
    if(id.endsWith('/polygon-contact.ts')) return code.replace('  for (let i = 0;', '  globalThis.__nestBench.contact++;\n  for (let i = 0;');
  },
}]});
const rect=(w,h,x=0,y=0)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
try {
  const {nestMultiplePieces:nest}=await server.ssrLoadModule(enginePath);
  const inputs=[['rectangles96',{canvas:{width:1480,height:1000},scanStepMm:10,pieces:Array.from({length:96},(_,i)=>({id:String(i),kind:'garment',polygon:rect(103,137),allowedRotations:[0,180]}))}]];
  if(process.argv[3]) {
    const capture=JSON.parse(readFileSync(process.argv[3],'utf8'));
    // Explicit diagnostic sample, not the user's uncaptured production batch.
    const pieces=capture.pieces.filter((_,i)=>i%10===0).slice(0,9).map(p=>({...p,kind:'garment'}));
    pieces.push({id:'benchmark-png',kind:'free-png',polygon:rect(100,100),collisionComponents:[rect(80,70,0,30),rect(10,10,90,0)],allowedRotations:[0,90,-90,180]});
    inputs.push(['sample9-plus-synthetic-png',{...capture,pieces,diagnosticProfiling:false,fillers:[{definitionId:'benchmark-png',requiredPieceId:'benchmark-png',priority:1,mode:'normal'}]}]);
  }
  for(const [label,input] of inputs) {
    const start=performance.now(), result=nest(input);
    console.log(JSON.stringify({label,ms:performance.now()-start,...globalThis.__nestBench,layouts:result.layouts.length,heights:result.layouts.map(l=>l.usedHeight),extras:result.extraCount??0}));
  }
} finally {await server.close();}
