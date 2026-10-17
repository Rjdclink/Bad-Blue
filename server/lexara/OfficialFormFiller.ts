import { PDFDocument } from 'pdf-lib';
import { load } from 'cheerio';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const execFileAsync = promisify(execFile);
import type { OfficialLegalForm } from './OfficialLegalFormResolver';

const MAX_FORM_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 8_000;
const ORIGINAL_CACHE_TTL_MS = 5 * 60_000;
const originalFormCache = new Map<string,{bytes:Buffer;expires:number}>();

export interface OfficialFormField {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'option' | 'unknown';
  requiredValue?: string;
  required?: boolean;
  readOnly?: boolean;
  pageIndex?: number;
  verticalPosition?: number;
}
export interface InspectedOfficialForm {
  sourceUrl: string; contentType: 'pdf' | 'docx'; bytes: Buffer;
  fields: OfficialFormField[]; fillable: boolean;
}
async function download(url: string, trustedDomains?: readonly string[]): Promise<Buffer> {
  // Cache only public original files, never forms populated with user facts.
  // Repeated questions use the same verified version without another download.
  const hit=originalFormCache.get(url);
  if(hit && hit.expires>Date.now()) return Buffer.from(hit.bytes);
  if(hit) originalFormCache.delete(url);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),DOWNLOAD_TIMEOUT_MS);
  try {
    const response=await fetch(url,{signal:controller.signal,redirect:'follow',headers:{'User-Agent':'LegalWhat/1.0 official-form-retriever'}});
    if(!response.ok) throw new Error('Official form download failed with HTTP '+response.status);
    if(!officialHost(response.url || url, trustedDomains)) throw new Error('Official form redirected away from a verified court source');
    const length=Number(response.headers.get('content-length')||0);
    if(length>MAX_FORM_BYTES) throw new Error('Official form exceeds maximum size');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>MAX_FORM_BYTES) throw new Error('Official form exceeds maximum size');
    if(bytes.length<=4*1024*1024){
      originalFormCache.set(url,{bytes,expires:Date.now()+ORIGINAL_CACHE_TTL_MS});
      while(originalFormCache.size>6) originalFormCache.delete(originalFormCache.keys().next().value!);
    }
    return bytes;
  } finally { clearTimeout(timer); }
}
function downloadableType(url: string): 'pdf' | 'docx' | null {
  const clean=url.toLowerCase().split('?')[0].split('#')[0];
  if(clean.endsWith('.pdf')) return 'pdf';
  if(/\/(?:download|embedDocument)\/?$/i.test(clean)) return 'pdf';
  if(clean.endsWith('.docx')) return 'docx';
  return null;
}

function officialHost(url: string, trustedDomains?: readonly string[]): boolean {
  try {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:') return false;
    const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
    if(trustedDomains?.some(domain=>{
      const issuer=domain.toLowerCase().replace(/^www\./,'');
      return host===issuer || host.endsWith('.'+issuer);
    })) return true;
    return host.endsWith('.gov') || host.endsWith('.mil') || host.endsWith('.uscourts.gov')
      || /(?:^|\.)courts?\.[a-z]{2}\.us$/.test(host)
      || (host.endsWith('.us') && /(?:court|judicial|state)/.test(host));
  } catch {
    return false;
  }
}

async function resolveDownloadableOfficialForm(form: OfficialLegalForm): Promise<{ url: string; contentType: 'pdf' | 'docx'; bytes?: Buffer }> {
  if(!form.verifiedOfficial || !form.url || !officialHost(form.url,form.trustedOfficialDomains)) throw new Error('No verified official form source is available');
  const directType=downloadableType(form.url);
  if(directType) return {url:form.url,contentType:directType};
  if(form.contentType!=='html') throw new Error('No verified downloadable official form is available');

  // Courts also serve PDFs at /download and /embedDocument URLs. Detect the
  // actual file before treating an extensionless official response as HTML.
  const sourceBytes=await download(form.url,form.trustedOfficialDomains);
  if (sourceBytes.subarray(0,5).toString('ascii') === '%PDF-') {
    return { url: form.url, contentType: 'pdf', bytes: sourceBytes };
  }
  const html=sourceBytes.toString('utf8');
  const $=load(html);
  const formNumber=String(form.formNumber || '').trim().toLowerCase();
  const titleTokens=String(form.title || form.sourceTitle || '')
    .toLowerCase().split(/[^a-z0-9]+/).filter(token=>token.length>=4).slice(0,12);
  const candidates:Array<{url:string;contentType:'pdf'|'docx';score:number}>=[];
  $('a[href]').each((_index, element)=>{
    const href=String($(element).attr('href') || '').trim();
    if(!href) return;
    let absolute='';
    try { absolute=new URL(href,form.url).toString(); } catch { return; }
    const contentType=downloadableType(absolute);
    if(!contentType || !officialHost(absolute,form.trustedOfficialDomains)) return;
    const label=`${$(element).text()} ${href}`.toLowerCase();
    let score=1;
    if(formNumber && label.includes(formNumber)) score+=20;
    score+=titleTokens.filter(token=>label.includes(token)).length*2;
    if(/\b(form|petition|motion|affidavit|application|summons|decree|order|notice|packet)\b/i.test(label)) score+=2;
    candidates.push({url:absolute,contentType,score});
  });
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  if(!best || best.score<3) throw new Error('Official form page did not expose a confidently matched downloadable form');
  return {url:best.url,contentType:best.contentType};
}

async function inspectDocxFields(bytes: Buffer): Promise<OfficialFormField[]> {
  const dir=await mkdtemp(path.join(tmpdir(),'lexara-docx-inspect-'));
  const input=path.join(dir,'official.docx');
  const unpack=path.join(dir,'unpacked');
  try {
    await writeFile(input,bytes);
    await execFileAsync('unzip',['-q',input,'-d',unpack]);
    const xml=await readFile(path.join(unpack,'word','document.xml'),'utf8');
    const names=new Set<string>();
    for(const match of xml.matchAll(/<w:(?:tag|alias)\b[^>]*w:val="([^"]+)"/gi)) {
      const name=String(match[1]||'').trim();
      if(name && !/^\d+$/.test(name)) names.add(name);
    }
    for(const match of xml.matchAll(/\[\s*([A-Z][A-Z0-9 _/.-]{2,80})\s*\]|{{\s*([A-Za-z][A-Za-z0-9 _/.-]{2,80})\s*}}/g)) {
      const name=String(match[1]||match[2]||'').trim();
      if(name) names.add(name);
    }
    return [...names].slice(0,200).map(name=>({name,type:'text' as const}));
  } catch {
    throw new Error('Official DOCX source did not contain a valid Word document');
  } finally {
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

export async function inspectOfficialForm(form: OfficialLegalForm): Promise<InspectedOfficialForm> {
  const resolved=await resolveDownloadableOfficialForm(form);
  const bytes=resolved.bytes || await download(resolved.url,form.trustedOfficialDomains);
  const contentType = bytes.subarray(0,5).toString('ascii') === '%PDF-' ? 'pdf'
    : bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])) ? 'docx' : resolved.contentType;
  if(contentType==='docx') {
    const fields=await inspectDocxFields(bytes);
    return {sourceUrl:resolved.url,contentType:'docx',bytes,fields,fillable:fields.length>0};
  }
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false});
  const fields: OfficialFormField[]=[];
  const pages=pdf.getPages();
  for(const field of pdf.getForm().getFields()){
    const name=field.getName(); const kind=field.constructor.name.toLowerCase();
    const widget=(field as any).acroField?.getWidgets?.()?.[0];
    const pageRef=widget?.P?.();
    let pageIndex=pageRef ? pages.findIndex(page=>String(page.ref)===String(pageRef)) : -1;
    if(pageIndex<0 && widget?.dict){
      pageIndex=pages.findIndex(page => (page.node.Annots()?.asArray() || [])
        .some(ref => pdf.context.lookup(ref)===widget.dict));
    }
    const rectangle=widget?.getRectangle?.();
    fields.push({
      name,type:kind.includes('text')?'text':kind.includes('check')?'checkbox':kind.includes('radio')?'radio':kind.includes('dropdown')?'dropdown':kind.includes('option')?'option':'unknown',
      required:field.isRequired(),readOnly:field.isReadOnly(),
      pageIndex:pageIndex>=0?pageIndex:undefined,
      verticalPosition:Number.isFinite(rectangle?.y)?rectangle.y:undefined,
    });
  }
  // Ask fields in visual reading order where the issuing PDF records their
  // widget pages. Otherwise preserve the original AcroForm order.
  if(fields.every(field=>field.pageIndex!==undefined && field.verticalPosition!==undefined)){
    fields.sort((a,b)=>(a.pageIndex!-b.pageIndex!)
      || (b.verticalPosition!-a.verticalPosition!));
  }
  return {sourceUrl:resolved.url,contentType:'pdf',bytes,fields,fillable:fields.length>0};
}
export async function fillOfficialPdf(inspected: InspectedOfficialForm, values: Record<string,string|boolean>, flatten=true): Promise<Buffer> {
  if(inspected.contentType!=='pdf') throw new Error('Official form is not a PDF');
  const pdf=await PDFDocument.load(inspected.bytes); const form=pdf.getForm();
  for(const field of form.getFields()){
    const value=values[field.getName()]; if(value===undefined||value===null) continue;
    const kind=field.constructor.name.toLowerCase();
    try {
      if(kind.includes('text')) (field as any).setText(String(value));
      else if(kind.includes('check')) {
        const answer=String(value).trim();
        if(value===true || /^(?:true|yes|on|1|checked)$/i.test(answer)) (field as any).check();
        else if(value===false || /^(?:false|no|off|0|unchecked)$/i.test(answer)) (field as any).uncheck();
        else throw new Error('Unrecognized checkbox response');
      }
      else if(kind.includes('radio')||kind.includes('dropdown')||kind.includes('option')) (field as any).select(String(value));
    } catch {
      throw new Error('An official PDF field could not be filled: '+field.getName());
    }
  }
  if(flatten) form.flatten();
  return Buffer.from(await pdf.save());
}
function escapeXmlText(value: string): string {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
export async function fillOfficialDocx(inspected: InspectedOfficialForm, values: Record<string,string>): Promise<Buffer> {
  if(inspected.contentType!=='docx') throw new Error('Official form is not DOCX');
  const dir=await mkdtemp(path.join(tmpdir(),'lexara-docx-'));
  const input=path.join(dir,'official.docx');
  const out=path.join(dir,'completed.docx');
  const unpack=path.join(dir,'unpacked');
  try {
    await writeFile(input,inspected.bytes);
    await execFileAsync('unzip',['-q',input,'-d',unpack]);
    const documentPath=path.join(unpack,'word','document.xml');
    let xml=await readFile(documentPath,'utf8');
    for(const [key,value] of Object.entries(values)) {
      const escapedKey=key.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
      const safe=escapeXmlText(String(value));
      xml=xml.replace(new RegExp('\\[\\s*'+escapedKey+'\\s*\\]','gi'),safe)
        .replace(new RegExp('{{\\s*'+escapedKey+'\\s*}}','gi'),safe);
      const contentControl=new RegExp(
        '(<w:sdt\\b[\\s\\S]*?<w:(?:tag|alias)\\b[^>]*w:val="'+escapedKey+'"[^>]*>[\\s\\S]*?<w:sdtContent\\b[^>]*>[\\s\\S]*?<w:t\\b[^>]*>)([\\s\\S]*?)(</w:t>)',
        'gi'
      );
      xml=xml.replace(contentControl,(_match,prefix,_oldValue,suffix)=>prefix+safe+suffix);
    }
    await writeFile(documentPath,xml,'utf8');
    await execFileAsync('zip',['-qr',out,'.'],{cwd:unpack});
    return await readFile(out);
  } finally {
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}
