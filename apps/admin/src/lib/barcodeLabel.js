const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const START_B = 104;
const STOP = '2331112';

const mmToPt = (mm) => Math.round((mm / 25.4) * 72 * 100) / 100;

export const LABEL_WIDTH_PT = mmToPt(51);
export const LABEL_HEIGHT_PT = mmToPt(25);

export function code128Modules(value) {
  const text = String(value ?? '');
  if (!text || /[^\x20-\x7e]/.test(text)) throw new Error('Barcode must be printable ASCII text');
  const codes = [START_B, ...[...text].map((char) => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, i) => sum + code * (i || 1), 0) % 103;
  return [...codes, checksum]
    .map((code) => CODE128[code])
    .concat(STOP)
    .join('')
    .split('')
    .map(Number);
}

/** Bar positions in module units, for drawing the barcode on screen. Empty when the value cannot be encoded. */
export function barcodeBars(value) {
  let modules;
  try {
    modules = code128Modules(value);
  } catch {
    return { bars: [], width: 0 };
  }
  const bars = [];
  let x = 0;
  modules.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return { bars, width: x };
}

function pdfText(value, max) {
  const text = String(value ?? '').replace(/[^\x20-\x7e]/g, '?');
  const cut = text.length > max ? `${text.slice(0, max - 1)}~` : text;
  return cut.replace(/[\\()]/g, (char) => `\\${char}`);
}

function centeredText(value, size, y, max) {
  const shown = String(value ?? '').length > max ? max : String(value ?? '').length;
  const x = Math.max(2, (LABEL_WIDTH_PT - shown * size * 0.6) / 2);
  return `BT /F1 ${size} Tf ${x.toFixed(2)} ${y} Td (${pdfText(value, max)}) Tj ET`;
}

export function barcodeLabelPdf({ value, name }) {
  const modules = code128Modules(value);
  const total = modules.reduce((sum, w) => sum + w, 0);
  const quiet = 8;
  const unit = Math.min(1.2, (LABEL_WIDTH_PT - quiet * 2) / total);
  let x = (LABEL_WIDTH_PT - unit * total) / 2;
  const bars = [];
  modules.forEach((width, i) => {
    if (i % 2 === 0) bars.push(`${x.toFixed(3)} 17 ${(width * unit).toFixed(3)} 42 re`);
    x += width * unit;
  });
  const content = [
    centeredText(name, 6, 62, 38),
    'q 0 g',
    ...bars,
    'f Q',
    centeredText(value, 8, 6, 28),
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LABEL_WIDTH_PT} ${LABEL_HEIGHT_PT}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

export function printBarcodeLabel({ value, name }) {
  const pdf = barcodeLabelPdf({ value, name });
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  if (!window.open(url, '_blank')) {
    const link = document.createElement('a');
    link.href = url;
    link.download = `barcode-${String(value).replace(/[^\w-]+/g, '_')}.pdf`;
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
