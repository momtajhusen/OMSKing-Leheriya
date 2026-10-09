const PlatformPricing = require('../models/PlatformPricing');
const { HttpError } = require('../utils/httpError');

const DEFAULT_SLABS = [
  { upTo: 1000, ratePaise: 200 },
  { upTo: 5000, ratePaise: 150 },
  { upTo: 20000, ratePaise: 100 },
  { upTo: null, ratePaise: 75 },
];

function rupees(paise) {
  return Math.round(paise) / 100;
}

function toPaise(rupee) {
  return Math.round(Number(rupee) * 100);
}

function publicSlab(slab, index, slabs) {
  const prev = index === 0 ? 0 : slabs[index - 1].upTo;
  const label = slab.upTo == null
    ? `${(prev + 1).toLocaleString('en-IN')} and above`
    : index === 0
      ? `Up to ${slab.upTo.toLocaleString('en-IN')}`
      : `${(prev + 1).toLocaleString('en-IN')} – ${slab.upTo.toLocaleString('en-IN')}`;
  return { upTo: slab.upTo, rate: rupees(slab.ratePaise), label };
}

function present(doc) {
  const slabs = doc.slabs || [];
  const lowest = slabs.reduce((min, slab) => Math.min(min, slab.ratePaise), slabs[0]?.ratePaise || 0);
  return {
    minimumMonthly: rupees(doc.minimumMonthlyPaise),
    lowestRate: rupees(lowest),
    slabs: slabs.map(publicSlab),
  };
}

function quoteOrders(orderCount, doc) {
  const orders = Math.max(0, Math.floor(Number(orderCount) || 0));
  const slabs = doc.slabs || [];
  const slab = slabs.find((row) => row.upTo == null || orders <= row.upTo) || slabs[slabs.length - 1];
  const ratePaise = slab?.ratePaise || 0;
  const usagePaise = orders * ratePaise;
  const billPaise = Math.max(doc.minimumMonthlyPaise || 0, usagePaise);
  return {
    orders,
    rate: rupees(ratePaise),
    usage: rupees(usagePaise),
    minimumMonthly: rupees(doc.minimumMonthlyPaise || 0),
    adjustment: rupees(billPaise - usagePaise),
    bill: rupees(billPaise),
  };
}

async function ensurePricing() {
  let doc = await PlatformPricing.findOne({ key: 'default' });
  if (!doc) {
    doc = await PlatformPricing.create({
      key: 'default',
      minimumMonthlyPaise: 100000,
      slabs: DEFAULT_SLABS,
    });
  }
  return doc;
}

function parseSlabs(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) {
    throw new HttpError(400, 'Add between 1 and 8 order slabs');
  }
  const slabs = raw.map((row, index) => {
    const last = index === raw.length - 1;
    const upTo = last || row.upTo === '' || row.upTo == null ? null : Number(row.upTo);
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) {
      throw new HttpError(400, 'Each slab needs a per-order rate above 0');
    }
    if (!last && (!Number.isInteger(upTo) || upTo < 1)) {
      throw new HttpError(400, 'Each slab except the last needs an order limit');
    }
    return { upTo, ratePaise: toPaise(rate) };
  });
  for (let i = 1; i < slabs.length; i += 1) {
    if (slabs[i].upTo != null && slabs[i - 1].upTo != null && slabs[i].upTo <= slabs[i - 1].upTo) {
      throw new HttpError(400, 'Order limits must increase from one slab to the next');
    }
  }
  if (slabs[slabs.length - 1].upTo != null) {
    throw new HttpError(400, 'The last slab covers every order above the previous limit');
  }
  return slabs;
}

async function savePricing(body) {
  const minimum = Number(body.minimumMonthly);
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 10000000) {
    throw new HttpError(400, 'Minimum monthly charge must be 0 or more');
  }
  const slabs = parseSlabs(body.slabs);
  const doc = await ensurePricing();
  doc.minimumMonthlyPaise = toPaise(minimum);
  doc.slabs = slabs;
  await doc.save();
  return doc;
}

module.exports = { ensurePricing, present, quoteOrders, savePricing, DEFAULT_SLABS };
