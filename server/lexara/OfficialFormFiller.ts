import { PDFDocument } from 'pdf-lib';
import { patchDocument, PatchType, TextRun } from 'docx';
import type { OfficialLegalForm } from './OfficialLegalFormResolver';

const MAX_FORM_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 8_000;

export interface OfficialFormField {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'option' | 'unknown';
  requiredValue?: string;
}
export interface InspectedOfficialForm {
  sourceUrl: string; contentType: 'pdf' | 'docx'; bytes: Buffer;
  fields: OfficialFormField[]; fillable: boolean;
}
async function download(url: string): Promise<Buffer> {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),DOWNLOAD_TIMEOUT_MS);
  try {
    const response=await fetch(url,{signal:controller.signal,redirect:'follow',headers:{'User-Agent':'LegalWhat/1.0 official-form-retriever'}});
    if(!response.ok) throw new Error('Official form download failed with HTTP '+response.status);
    const length=Number(response.headers.get('content-length')||0);
    if(length>MAX_FORM_BYTES) throw new Error('Official form exceeds maximum size');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>MAX_FORM_BYTES) throw new Error('Official form exceeds maximum size');
    return bytes;
  } finally { clearTimeout(timer); }
}
export async function inspectOfficialForm(form: OfficialLegalForm): Promise<InspectedOfficialForm> {
  if(!form.verifiedOfficial || !form.url || (form.contentType!=='pdf' && form.contentType!=='docx')) throw new Error('No verified downloadable official form is available');
  const bytes=await download(form.url);
  if(form.contentType==='docx') return {sourceUrl:form.url,contentType:'docx',bytes,fields:[],fillable:true};
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false});
  const fields: OfficialFormField[]=[];
  try {
    for(const field of pdf.getForm().getFields()){
      const name=field.getName(); const kind=field.constructor.name.toLowerCase();
      fields.push({name,type:kind.includes('text')?'text':kind.includes('check')?'checkbox':kind.includes('radio')?'radio':kind.includes('dropdown')?'dropdown':kind.includes('option')?'option':'unknown'});
    }
  } catch {}
  return {sourceUrl:form.url,contentType:'pdf',bytes,fields,fillable:fields.length>0};
}
export async function fillOfficialPdf(inspected: InspectedOfficialForm, values: Record<string,string|boolean>, flatten=true): Promise<Buffer> {
  if(inspected.contentType!=='pdf') throw new Error('Official form is not a PDF');
  const pdf=await PDFDocument.load(inspected.bytes); const form=pdf.getForm();
  for(const field of form.getFields()){
    const value=values[field.getName()]; if(value===undefined||value===null) continue;
    const kind=field.constructor.name.toLowerCase();
    try {
      if(kind.includes('text')) (field as any).setText(String(value));
      else if(kind.includes('check')) value ? (field as any).check() : (field as any).uncheck();
      else if(kind.includes('radio')||kind.includes('dropdown')||kind.includes('option')) (field as any).select(String(value));
    } catch {}
  }
  if(flatten) form.flatten();
  return Buffer.from(await pdf.save());
}
export async function fillOfficialDocx(inspected: InspectedOfficialForm, values: Record<string,string>): Promise<Buffer> {
  if(inspected.contentType!=='docx') throw new Error('Official form is not DOCX');
  const patches: Record<string,any>={};
  for(const [key,value] of Object.entries(values)) patches[key]={type:PatchType.PARAGRAPH,children:[new TextRun({text:value})]};
  return Buffer.from(await patchDocument({outputType:'nodebuffer',data:inspected.bytes,keepOriginalStyles:true,patches}));
}
