const Inventory = require('../models/Inventory');
const Warehouse = require('../models/Warehouse');

const OPEN = new Set(['New', 'Processing', 'Pending', 'Packed', 'Ready to Ship', 'Unfulfillable']);

function closedNote(order) {
  if (order.channel === 'Amazon' || order.channel === 'Myntra') {
    return `${order.channel} courier fulfilled this order.`;
  }
  return '';
}

function paymentView(mode) {
  const text = String(mode || '').trim();
  if (/partial/i.test(text)) return { paymentMode: 'COD', paymentDetail: 'Partially paid' };
  if (/cod|cash on delivery/i.test(text)) return { paymentMode: 'COD', paymentDetail: '' };
  return { paymentMode: text || 'Prepaid', paymentDetail: '' };
}

function take(pool, id, qty) {
  const have = pool.get(id) || 0;
  const used = Math.min(Math.max(0, qty), have);
  pool.set(id, have - used);
  return used;
}

/**
 * Desk view of one open order. Oldest orders consume WH-001 first.
 * Offline stock packs at WH-001. Virtual stock and out-of-stock lines go to a vendor.
 * An unmapped line is Unfulfillable and does not take stock.
 */
function routeOrder(order, physical, virtual) {
  const pay = paymentView(order.paymentMode);
  const base = { ...order, ...pay, mappingFailed: false, routeNote: '' };
  if (!OPEN.has(order.status)) return base;

  const shopify = order.channel === 'Shopify';
  const assignedBySku = {};
  (order.subOrders || []).forEach((sub) => {
    if (!sub.assignedVendor) return;
    assignedBySku[sub.sku] = (assignedBySku[sub.sku] || 0) + Math.max(1, Number(sub.qty) || 1);
  });

  let offlineUnits = 0;
  let vendorUnits = 0;
  let outOfStock = 0;
  let unmapped = false;
  const items = (order.items || []).map((item) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const assigned = Math.min(qty, assignedBySku[item.sku] || 0);
    assignedBySku[item.sku] = Math.max(0, (assignedBySku[item.sku] || 0) - assigned);
    const id = item.masterSkuId ? String(item.masterSkuId) : '';
    if (!id) {
      unmapped = true;
      return { ...item, fulfilmentSource: item.fulfilmentSource || 'Offline', mappingFailed: true };
    }
    const free = qty - assigned;
    const offline = take(physical, id, free);
    let rest = free - offline;
    let virt = 0;
    if (shopify && rest > 0) {
      virt = take(virtual, id, rest);
      rest -= virt;
    }
    offlineUnits += offline;
    vendorUnits += assigned + virt + rest;
    outOfStock += rest;
    let fulfilmentSource = 'Offline';
    if (offline && (assigned + virt + rest)) fulfilmentSource = 'Mixed';
    else if (!offline) fulfilmentSource = 'Virtual';
    return { ...item, fulfilmentSource, mappingFailed: false };
  });

  if (unmapped) {
    return {
      ...base,
      items,
      status: 'Unfulfillable',
      mappingFailed: true,
      routeNote: 'Unmapped SKU. Map it before pack or vendor assign.',
    };
  }

  let offlineRemain = offlineUnits;
  const subOrders = (order.subOrders || []).map((sub) => {
    if (sub.assignedVendor) return { ...sub, fulfilmentSource: 'Virtual' };
    if (offlineRemain > 0) {
      offlineRemain -= Math.max(1, Number(sub.qty) || 1);
      return { ...sub, fulfilmentSource: 'Offline' };
    }
    return { ...sub, fulfilmentSource: 'Virtual' };
  });

  let fulfilmentSource = 'Offline';
  if (offlineUnits && vendorUnits) fulfilmentSource = 'Mixed';
  else if (vendorUnits) fulfilmentSource = 'Virtual';

  let routeNote = 'WH-001 pack';
  if (fulfilmentSource === 'Mixed') {
    routeNote = outOfStock ? 'Split: WH-001 pack and vendor (out of stock).' : 'Split: WH-001 pack and virtual vendor line.';
  } else if (fulfilmentSource === 'Virtual') {
    routeNote = outOfStock ? 'Out of stock at WH-001. Vendor line.' : 'Virtual stock. Vendor line.';
  }

  return { ...base, items, subOrders, fulfilmentSource, routeNote };
}

function applyDeskRules(orders, pools = {}) {
  const physical = new Map(pools.physical || []);
  const virtual = new Map(pools.virtual || []);
  const open = orders
    .map((order, index) => ({ order, index }))
    .filter((row) => OPEN.has(row.order.status))
    .sort((a, b) => String(a.order.createdAt).localeCompare(String(b.order.createdAt)));
  const routed = new Map();
  open.forEach(({ order, index }) => {
    routed.set(index, routeOrder(order, physical, virtual));
  });
  return orders.map((order, index) => routed.get(index) || {
    ...order,
    ...paymentView(order.paymentMode),
    mappingFailed: false,
    routeNote: closedNote(order),
  });
}

async function stockPools(tenantId) {
  const warehouses = await Warehouse.find({ tenantId, status: 'active' }).setOptions({ skipTenantFilter: true });
  const byId = new Map(warehouses.map((row) => [String(row._id), row]));
  const rows = await Inventory.find({ tenantId }).setOptions({ skipTenantFilter: true });
  const physical = new Map();
  const virtual = new Map();
  rows.forEach((row) => {
    const warehouse = byId.get(String(row.warehouseId));
    if (!warehouse) return;
    const available = (row.physicalQty || 0) + (row.virtualQty || 0) - (row.reservedQty || 0);
    if (available <= 0) return;
    const pool = warehouse.type === 'virtual' ? virtual : physical;
    const id = String(row.masterSkuId);
    pool.set(id, (pool.get(id) || 0) + available);
  });
  return { physical, virtual };
}

module.exports = { applyDeskRules, paymentView, stockPools, OPEN };
