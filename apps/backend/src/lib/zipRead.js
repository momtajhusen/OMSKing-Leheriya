const zlib = require('zlib');

const END_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Files of a zip (stored or deflate entries), read through its central directory. */
function zipEntries(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === END_SIG) { end = i; break; }
  }
  if (end < 0) return [];
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count && at + 46 <= buf.length && buf.readUInt32LE(at) === CENTRAL_SIG; i += 1) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const skip = nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const local = buf.readUInt32LE(at + 42);
    at += 46 + skip;
    if (buf.readUInt32LE(local) !== LOCAL_SIG) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: zlib.inflateRawSync(raw) });
  }
  return out;
}

const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 4).toString('latin1') === '%PDF';

/** The shipping label PDF from a downloaded document: the PDF itself, or the label file inside a zip; else null. */
function labelPdfFrom(buf) {
  if (isPdf(buf)) return buf;
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== LOCAL_SIG) return null;
  const pdfs = zipEntries(buf).filter((entry) => isPdf(entry.data));
  return (pdfs.find((entry) => /label/i.test(entry.name)) || pdfs[0])?.data || null;
}

module.exports = { zipEntries, labelPdfFrom };
