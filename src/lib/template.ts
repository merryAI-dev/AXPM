import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { defaultMapping, fieldLabels } from './report-fields';
export { defaultMapping, fieldLabels } from './report-fields';
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export async function inspectTemplate(buffer: Buffer) {
  if (buffer.length > 10_000_000) throw new Error('보고서 템플릿은 10MB 이하로 업로드해주세요.');
  const w = new ExcelJS.Workbook(); await w.xlsx.load(buffer as never);
  if (!w.worksheets.length) throw new Error('템플릿에 시트가 없습니다.');
  return { sheets: w.worksheets.map(x => x.name), mapping: defaultMapping, imageCount: w.worksheets.reduce((sum,s)=>sum+s.getImages().length,0) };
}
export async function fillTemplate(buffer: Buffer, sheetName: string, mapping: Record<string,string>, fields: Record<string,string>): Promise<Buffer> {
  const w = new ExcelJS.Workbook(); await w.xlsx.load(buffer as never);
  const sheet = w.getWorksheet(sheetName); if (!sheet) throw new Error('템플릿 시트를 찾을 수 없습니다.');
  if (Object.keys(mapping).sort().join() !== Object.keys(defaultMapping).sort().join()) throw new Error('9개 보고서 필드 매핑이 모두 필요합니다.');
  if (new Set(Object.values(mapping)).size !== Object.keys(mapping).length) throw new Error('매핑 셀이 중복되었습니다.');
  for (const [field, addr] of Object.entries(mapping)) {
    if (!/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(addr)) throw new Error(`셀 주소가 올바르지 않습니다: ${field}`);
    const cell = sheet.getCell(addr);
    if (cell.isMerged && cell.master.address !== addr) throw new Error(`${addr}: 병합 영역의 첫 셀 ${cell.master.address}을 지정해주세요.`);
    if (typeof fields[field] !== 'string' || fields[field].length > 32767 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(fields[field])) throw new Error(`${fieldLabels[field]} 내용이 유효하지 않습니다.`);
  }
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await zip.file('xl/workbook.xml')!.async('string');
  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*>/g)].find(x => new RegExp(`name="${escapeXml(sheetName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(x[0]))?.[0];
  const relId = sheetTag?.match(/r:id="([^"]+)"/)?.[1];
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const relation = [...rels.matchAll(/<Relationship\b[^>]*>/g)].find(x => x[0].includes(`Id="${relId}"`))?.[0];
  const target = relation?.match(/Target="([^"]+)"/)?.[1];
  if (!target) throw new Error('템플릿 XML 시트 연결을 확인할 수 없습니다.');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  let xml = await zip.file(path)!.async('string');
  for (const [field, addr] of Object.entries(mapping)) {
    const re = new RegExp(`<c\\b([^>]*\\br="${addr}"[^>]*)(?:\\s*/>|>[\\s\\S]*?</c>)`);
    const match = xml.match(re);
    if (!match) throw new Error(`${addr}: 원본에 존재하는 셀만 매핑할 수 있습니다.`);
    const attrs = match[1].replace(/\s+t="[^"]*"/g, '').replace(/\/$/, '');
    xml = xml.replace(re, () => `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(fields[field])}</t></is></c>`);
  }
  // Patch only mapped cell XML. All other ZIP members, drawings, styles and print settings remain untouched.
  zip.file(path, xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
