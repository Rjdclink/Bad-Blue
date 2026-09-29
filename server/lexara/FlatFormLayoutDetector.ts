import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FlatFormLayout, FlatFormAnchor } from './FlatOfficialFormOverlay';
const exec=promisify(execFile);

function parseTsv(tsv:string): FlatFormAnchor[] {
  const rows=tsv.split(/\r?\n/); if(rows.length<2) return [];
  const head=rows[0].split('\t'); const ix=(n:string)=>head.indexOf(n);
  return rows.slice(1).map(row=>row.split('\t')).filter(c=>c.length>=head.length).map(c=>({
    page:Math.max(0,Number(c[ix('page_num')])-1),label:String(c[ix('text')]||'').trim(),
    x:Number(c[ix('left')]),y:Number(c[ix('top')]),width:Number(c[ix('width')]),height:Number(c[ix('height')]),
    confidence:Math.max(0,Number(c[ix('conf')]))/100,
  })).filter(a=>a.label&&a.width>0&&a.height>0&&a.confidence>=0.70);
}
function fieldCandidates(words:FlatFormAnchor[]):FlatFormAnchor[]{
  const labels=/^(name|address|city|state|zip|county|date|phone|email|case|court|plaintiff|defendant|petitioner|respondent|signature|ssn|dob|employer|amount)$/i;
  return words.filter(w=>labels.test(w.label)).map(w=>({...w,x:w.x+w.width+8,width:Math.max(120,w.width*4),confidence:Math.min(0.99,w.confidence+0.05)}));
}
export async function detectFlatFormLayout(bytes:Buffer, contentType:'pdf'|'image'):Promise<FlatFormLayout>{
  const dir=await mkdtemp(path.join(tmpdir(),'lexara-form-'));
  try{
    const input=path.join(dir,contentType==='pdf'?'input.pdf':'input.png'); await writeFile(input,bytes);
    let image=input;
    if(contentType==='pdf'){ image=path.join(dir,'page'); await exec('pdftoppm',['-f','1','-singlefile','-r','300','-png',input,image]); image+='.png'; }
    const base=path.join(dir,'ocr'); await exec('tesseract',[image,base,'--psm','6','tsv']);
    const words=parseTsv(await readFile(base+'.tsv','utf8')); const anchors=fieldCandidates(words);
    return {anchors,verified:anchors.length>0&&anchors.every(a=>a.confidence>=0.86),method:'ocr-coordinates'};
  } catch { return {anchors:[],verified:false,method:'unavailable'}; }
  finally { await rm(dir,{recursive:true,force:true}).catch(()=>{}); }
}
