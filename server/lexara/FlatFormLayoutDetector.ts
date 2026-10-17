import { PDFDocument } from 'pdf-lib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FlatFormLayout, FlatFormAnchor } from './FlatOfficialFormOverlay';

const exec=promisify(execFile);
const OCR_DPI=144;
const MAX_FORM_PAGES=12;

function parseTsv(tsv:string, page:number, pageWidth:number, pageHeight:number):FlatFormAnchor[] {
  const rows=tsv.split(/\r?\n/); if(rows.length<2) return [];
  const head=rows[0].split('\t'); const ix=(name:string)=>head.indexOf(name);
  if(['text','left','top','width','height','conf'].some(name=>ix(name)<0)) return [];
  const scale=72/OCR_DPI;
  const labels=/^(name|address|city|state|zip|county|date|phone|email|case|court|plaintiff|defendant|petitioner|respondent|signature|ssn|dob|employer|amount)$/i;
  return rows.slice(1).map(row=>row.split('\t')).filter(columns=>columns.length>=head.length).flatMap(columns=>{
    const label=String(columns[ix('text')]||'').trim().replace(/[:*]+$/,'');
    if(!labels.test(label)) return [];
    const left=Number(columns[ix('left')]); const top=Number(columns[ix('top')]);
    const wordWidth=Number(columns[ix('width')]); const wordHeight=Number(columns[ix('height')]);
    const confidence=Number(columns[ix('conf')])/100;
    if(![left,top,wordWidth,wordHeight,confidence].every(Number.isFinite) || wordWidth<=0 || wordHeight<=0 || confidence<0.70) return [];
    const x=(left+wordWidth+8)*scale; const y=top*scale;
    const width=Math.min(Math.max(120,wordWidth*4)*scale,pageWidth-x-12);
    const height=wordHeight*scale;
    if(x<0 || y<0 || width<35 || y+height>pageHeight) return [];
    return [{page,label,x,y,width,height,confidence}];
  });
}

export async function detectFlatFormLayout(bytes:Buffer, contentType:'pdf'|'image'):Promise<FlatFormLayout>{
  const dir=await mkdtemp(path.join(tmpdir(),'lexara-form-'));
  try{
    const input=path.join(dir,contentType==='pdf'?'input.pdf':'input.png'); await writeFile(input,bytes);
    if(contentType==='image') return {anchors:[],verified:false,method:'unavailable'};
    const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false});
    if(pdf.getPageCount()===0 || pdf.getPageCount()>MAX_FORM_PAGES) return {anchors:[],verified:false,method:'unavailable'};
    const prefix=path.join(dir,'page');
    await exec('pdftoppm',['-f','1','-l',String(pdf.getPageCount()),'-r',String(OCR_DPI),'-png',input,prefix],{timeout:45_000});
    const images=(await readdir(dir)).filter(name=>/^page-\d+\.png$/.test(name)).sort((a,b)=>
      Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0));
    if(images.length!==pdf.getPageCount()) return {anchors:[],verified:false,method:'unavailable'};
    const anchors:FlatFormAnchor[]=[];
    for(const image of images){
      const page=Number(image.match(/-(\d+)\.png$/)?.[1])-1;
      if(!Number.isInteger(page) || page<0 || page>=pdf.getPageCount()) return {anchors:[],verified:false,method:'unavailable'};
      const base=path.join(dir,'ocr-'+page);
      await exec('tesseract',[path.join(dir,image),base,'--psm','6','tsv'],{timeout:30_000});
      const size=pdf.getPage(page).getSize();
      anchors.push(...parseTsv(await readFile(base+'.tsv','utf8'),page,size.width,size.height));
    }
    // Identical visible labels are ambiguous (e.g., two different "Name" fields).
    // Do not put the same value into both fields without a verified field map.
    const uniqueLabels=new Set(anchors.map(anchor=>anchor.label.toLowerCase())).size===anchors.length;
    return {anchors,verified:anchors.length>0&&uniqueLabels&&anchors.every(anchor=>anchor.confidence>=0.86),method:'ocr-coordinates'};
  } catch { return {anchors:[],verified:false,method:'unavailable'}; }
  finally { await rm(dir,{recursive:true,force:true}).catch(()=>{}); }
}
