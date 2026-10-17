import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { InspectedOfficialForm } from './OfficialFormFiller';

export interface FlatFormAnchor { page: number; label: string; x: number; y: number; width: number; height: number; confidence: number; }
export interface FlatFormLayout { anchors: FlatFormAnchor[]; verified: boolean; method: 'text-coordinates'|'ocr-coordinates'|'unavailable'; }

const MIN_CONFIDENCE=0.86;
export function validateFlatFormLayout(layout: FlatFormLayout): FlatFormLayout {
  const anchors=layout.anchors.filter(a=>Number.isInteger(a.page)&&Number.isFinite(a.x)&&Number.isFinite(a.y)
    &&Number.isFinite(a.width)&&Number.isFinite(a.height)&&a.page>=0&&a.x>=0&&a.y>=0
    &&a.width>0&&a.height>0&&a.confidence>=MIN_CONFIDENCE&&Boolean(a.label.trim()));
  const uniqueLabels=new Set(anchors.map(a=>a.label.trim().toLowerCase())).size===anchors.length;
  return {...layout,anchors,verified:layout.verified===true&&anchors.length>0&&anchors.length===layout.anchors.length&&uniqueLabels};
}
export async function overlayFlatOfficialPdf(inspected: InspectedOfficialForm, layout: FlatFormLayout, values: Record<string,string>): Promise<Buffer> {
  if(inspected.contentType!=='pdf'||inspected.fillable) throw new Error('Flat official PDF required');
  const verified=validateFlatFormLayout(layout);
  if(!verified.verified) throw new Error('Flat-form field coordinates are not verified');
  const pdf=await PDFDocument.load(inspected.bytes); const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(const anchor of verified.anchors){
    const value=values[anchor.label]; if(value===undefined) continue;
    const page=pdf.getPages()[anchor.page];
    if(!page) throw new Error('The verified field refers to a missing form page');
    const {width:pageWidth,height:pageHeight}=page.getSize();
    if(anchor.x+anchor.width>pageWidth || anchor.y+anchor.height>pageHeight)
      throw new Error('The verified field extends beyond the court form page');
    const size=Math.max(7,Math.min(11,anchor.height*0.65));
    if(/[\r\n]/.test(String(value))||font.widthOfTextAtSize(String(value),size)>anchor.width)
      throw new Error('A form value does not fit its verified field; manual review is required: '+anchor.label);
    page.drawText(String(value),{x:anchor.x,y:pageHeight-anchor.y-anchor.height,size,font});
  }
  return Buffer.from(await pdf.save());
}
