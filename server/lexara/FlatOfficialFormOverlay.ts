import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { InspectedOfficialForm } from './OfficialFormFiller';

export interface FlatFormAnchor { page: number; label: string; x: number; y: number; width: number; height: number; confidence: number; }
export interface FlatFormLayout { anchors: FlatFormAnchor[]; verified: boolean; method: 'text-coordinates'|'ocr-coordinates'|'unavailable'; }

const MIN_CONFIDENCE=0.86;
export function validateFlatFormLayout(layout: FlatFormLayout): FlatFormLayout {
  const anchors=layout.anchors.filter(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)&&a.page>=0&&a.width>0&&a.height>0&&a.confidence>=MIN_CONFIDENCE);
  return {...layout,anchors,verified:anchors.length>0 && anchors.length===layout.anchors.length};
}
export async function overlayFlatOfficialPdf(inspected: InspectedOfficialForm, layout: FlatFormLayout, values: Record<string,string>): Promise<Buffer> {
  if(inspected.contentType!=='pdf'||inspected.fillable) throw new Error('Flat official PDF required');
  const verified=validateFlatFormLayout(layout);
  if(!verified.verified) throw new Error('Flat-form field coordinates are not verified');
  const pdf=await PDFDocument.load(inspected.bytes); const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(const anchor of verified.anchors){
    const value=values[anchor.label]; if(value===undefined) continue;
    const page=pdf.getPage(anchor.page); const pageHeight=page.getHeight();
    const size=Math.max(7,Math.min(11,anchor.height*0.65));
    page.drawText(String(value),{x:anchor.x,y:Math.max(0,pageHeight-anchor.y-anchor.height),size,font,maxWidth:anchor.width,lineHeight:size*1.15});
  }
  return Buffer.from(await pdf.save());
}
