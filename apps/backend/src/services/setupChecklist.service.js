const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Role = require('../models/Role');
const User = require('../models/User');
const Warehouse = require('../models/Warehouse');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const ChannelConnection = require('../models/ChannelConnection');
const CourierAccount = require('../models/CourierAccount');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const Inventory = require('../models/Inventory');
const InventoryLedger = require('../models/InventoryLedger');
const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const PlatformSetting = require('../models/PlatformSetting');
const PlatformPricing = require('../models/PlatformPricing');
const { decryptObject } = require('../lib/secretBox');
const { platformMailboxFromSettings } = require('./platformSettings.service');

const ROLE_CODES = ['super_admin', 'operations', 'warehouse', 'accounts', 'catalog_manager', 'customer_support', 'vendor'];
const PLACEHOLDER_LOCATIONS = new Set(['shopify-location-a', 'shopify-location-b']);
const OPENING_MOVEMENTS = ['purchase_receipt', 'adjustment_plus', 'virtual_sync'];
const PLACEHOLDER_SECRETS = new Set([
  '',
  'change-me-channel-encryption-key',
  'change-this-access-secret-in-production',
  'change-this-refresh-secret-in-production',
  'dev-access-secret',
  'dev-refresh-secret',
]);

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

function step(fields) {
  return {
    id: fields.id,
    phase: fields.phase,
    phaseLabel: fields.phaseLabel,
    title: fields.title,
    why: fields.why,
    impact: fields.impact,
    detail: fields.detail,
    done: Boolean(fields.done),
    clicks: fields.clicks || [],
    sources: fields.sources || [],
    actionLabel: fields.actionLabel,
    actionPath: fields.actionPath,
  };
}

function pack(audience, steps) {
  const completed = steps.filter((item) => item.done).length;
  const next = steps.find((item) => !item.done);
  return {
    audience,
    completed,
    total: steps.length,
    nextId: next ? next.id : '',
    nextTitle: next ? next.title : '',
    steps,
  };
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function channelReady(row) {
  return Boolean(row && row.status === 'connected' && row.lastTestOk);
}

function secretReady(value) {
  const text = String(value || '').trim();
  return text.length >= 16 && !PLACEHOLDER_SECRETS.has(text);
}

function httpsUrl(value) {
  return String(value || '').trim().toLowerCase().startsWith('https://');
}

async function tenantChecklist(tenantId) {
  const id = new mongoose.Types.ObjectId(String(tenantId));
  const [tenant, roles, owner, warehouses, maps, channels, couriers, masterCount, mappingRows, stocked, opening, imported, reserved, shipped] = await Promise.all([
    Tenant.findById(id),
    skip(Role.find({ tenantId: id, code: { $in: ROLE_CODES } }).select('code')),
    skip(User.findOne({ tenantId: id, status: 'active' }).populate({ path: 'roleId', select: 'code' })),
    skip(Warehouse.find({ tenantId: id })),
    skip(WarehouseLocationMap.find({ tenantId: id, channel: 'shopify' })),
    skip(ChannelConnection.find({ tenantId: id, channel: { $in: ['shopify', 'myntra', 'amazon'] } })),
    skip(CourierAccount.find({ tenantId: id, source: 'own', code: 'delhivery' })),
    skip(MasterSku.countDocuments({ tenantId: id, status: 'active' })),
    skip(SkuMapping.find({ tenantId: id, channel: { $in: ['shopify', 'myntra', 'amazon'] }, isActive: true }).select('channel syncStatus masterSkuId')),
    skip(Inventory.countDocuments({
      tenantId: id,
      $expr: { $gt: [{ $add: ['$physicalQty', '$virtualQty'] }, 0] },
    })),
    skip(InventoryLedger.countDocuments({ tenantId: id, movementType: { $in: OPENING_MOVEMENTS } })),
    skip(Order.countDocuments({ tenantId: id, externalOrderId: { $gt: '' } })),
    skip(InventoryLedger.countDocuments({ tenantId: id, movementType: 'order_reserve' })),
    skip(Shipment.countDocuments({ tenantId: id, status: 'booked', awb: { $gt: '' } })),
  ]);

  const byChannel = Object.fromEntries(channels.map((row) => [row.channel, row]));
  const physical = warehouses.find((row) => row.code === 'WH-001');
  const virtual = warehouses.find((row) => row.code === 'WH-002');
  const legal = tenant?.legalEntity || {};
  const authority = tenant?.settings?.inventoryAuthority === 'shopify' ? 'shopify' : 'oms';
  const courier = courierState(couriers);

  const steps = [
    accessStep(roles, owner),
    companyStep(tenant, legal),
    authorityStep(authority),
    taxStep(tenant),
    warehouseStep(physical, virtual),
    pickupStep(physical),
    shopifyStep(byChannel.shopify),
    locationStep(physical, virtual, maps),
    myntraStep(byChannel.myntra),
    amazonStep(byChannel.amazon),
    courierStep(courier),
    catalogStep(masterCount, mappingRows, byChannel),
    stockStep(authority, stocked, opening),
    pipelineStep(imported, reserved, shipped),
  ];
  return pack('tenant', steps);
}

function accessStep(roles, owner) {
  const codes = new Set(roles.map((row) => row.code));
  const rolesReady = ROLE_CODES.every((code) => codes.has(code));
  const ownerReady = owner?.roleId?.code === 'super_admin' && owner.status === 'active';
  const done = rolesReady && ownerReady;
  return step({
    id: 'access',
    phase: '0',
    phaseLabel: 'Access',
    title: 'Tenant access',
    why: 'Every later record belongs to this company. The owner login and the seven tenant roles are created together.',
    impact: 'Channel keys and stock saved before this company exists have nowhere safe to live.',
    detail: done
      ? 'Merchant Super Admin can sign in. The seven tenant roles are on this company.'
      : 'This company still needs its Merchant Super Admin and the standard roles.',
    clicks: [
      'Sidebar → Users & Roles.',
      'Confirm the Merchant Super Admin user is Active.',
      'The seven roles are created when the company is provisioned: Super Admin, Operations, Warehouse, Accounts, Catalog Manager, Customer Support, and Vendor. Do not type them by hand.',
    ],
    sources: [
      'The owner email comes from Platform → Subscribers → New Tenant, in the Owner email field.',
      'The password is the one set for that owner, or the invite sent to that email.',
    ],
    done,
    actionLabel: 'Open users and roles',
    actionPath: '/users-roles',
  });
}

function companyStep(tenant, legal) {
  const nameOk = String(tenant?.name || '').trim().length >= 2;
  const gstinOk = String(legal.gstin || '').trim().length === 15;
  const panOk = String(legal.pan || '').trim().length === 10;
  const emailOk = String(legal.email || '').includes('@');
  const phoneOk = digits(legal.phone).length >= 10;
  const addressOk = Boolean(String(legal.address || '').trim() && String(legal.city || '').trim() && String(legal.district || '').trim());
  const done = nameOk && gstinOk && panOk && emailOk && phoneOk && addressOk;
  const missing = [
    !nameOk && 'company name',
    !gstinOk && 'a 15-character GSTIN',
    !panOk && 'a 10-character PAN',
    !emailOk && 'support email',
    !phoneOk && 'support phone',
    !addressOk && 'address, city, and district',
  ].filter(Boolean);
  return step({
    id: 'company',
    phase: '1',
    phaseLabel: 'Company',
    title: 'Company and tax identity',
    why: 'Invoices and the seller profile read this identity. The company address is the legal profile. The courier pickup is saved on WH-001 in a later step.',
    impact: 'A missing GSTIN blocks a correct tax invoice. Saving stock before this profile leaves the seller unnamed on documents.',
    detail: done ? 'Company name, GSTIN, PAN, and support contact are saved.' : `Still needed: ${missing.join(', ')}.`,
    clicks: [
      'Sidebar → Settings, then the Company Details tab.',
      'Fill Company Name, GSTIN, PAN, Support Email, Support Phone, Address, City, and District.',
      'Click Save Changes.',
    ],
    sources: [
      'GSTIN (15 characters) and PAN (10 characters) come from the GST registration certificate.',
      'Address, city, and district are the registered business address. This screen has no pincode, and this address is not the courier pickup.',
      'Support Email and Support Phone are the contacts your operators answer.',
    ],
    done,
    actionLabel: 'Open company details',
    actionPath: '/settings?tab=company',
  });
}

function authorityStep(authority) {
  const shopify = authority === 'shopify';
  return step({
    id: 'authority',
    phase: '1',
    phaseLabel: 'Company',
    title: 'Inventory source',
    why: 'This choice decides who writes sellable quantity. Confirm it before opening stock.',
    impact: 'Switching the source after stock is loaded makes the next sync overwrite WH-001.',
    detail: shopify
      ? 'Shopify is master. Location A writes WH-001. Sellable edits in OMS stay closed.'
      : 'OMS is master. Stock you enter is pushed to Shopify, Amazon, and Myntra.',
    clicks: [
      'Sidebar → Settings, then the Inventory source tab.',
      'Choose OMS is master, or Shopify is master.',
      'Click Save inventory source before you enter opening stock.',
    ],
    sources: [
      'Choose OMS is master when staff will type sellable quantity on Inventory.',
      'Choose Shopify is master when Shopify Location A is the sellable quantity. OMS then blocks stock edits and reads Location A into WH-001.',
    ],
    done: authority === 'oms' || authority === 'shopify',
    actionLabel: 'Open inventory source',
    actionPath: '/settings?tab=inventory',
  });
}

function taxStep(tenant) {
  const done = Boolean(tenant?.settings?.taxGst?.configured);
  return step({
    id: 'tax',
    phase: '1',
    phaseLabel: 'Company',
    title: 'GST rates',
    why: 'The default rate and category rates are what a tax invoice uses. The schema default is 18% until you save your own rates.',
    impact: 'Orders can still import. A tax invoice uses the unsaved default until this is saved.',
    detail: done ? 'GST rates are saved for this company.' : 'Save the default GST rate and category rates.',
    clicks: [
      'Sidebar → Settings, then the Tax & GST tab.',
      'Set Default GST Rate (%) and any category rates.',
      'Click Save tax settings.',
    ],
    sources: [
      'Rates come from the GST registration and the accountant’s HSN or category list.',
      'The screen shows 18% until you save. Saving is what marks this step complete.',
    ],
    done,
    actionLabel: 'Open tax settings',
    actionPath: '/settings?tab=tax',
  });
}

function warehouseStep(physical, virtual) {
  const physicalOk = Boolean(
    physical
    && physical.type === 'physical'
    && physical.status === 'active'
    && physical.sellOnShopify
    && physical.sellOnAmazon
    && physical.sellOnMyntra
    && physical.isPickup,
  );
  const virtualOk = Boolean(
    virtual
    && virtual.type === 'virtual'
    && virtual.status === 'active'
    && virtual.sellOnShopify
    && !virtual.sellOnAmazon
    && !virtual.sellOnMyntra
    && !virtual.isPickup,
  );
  return step({
    id: 'warehouses',
    phase: '2',
    phaseLabel: 'Warehouses',
    title: 'Warehouse architecture',
    why: 'WH-001 is the physical godown and the pickup. WH-002 is Shopify virtual stock. Amazon and Myntra read WH-001 only. Channel location ids attach to these codes later.',
    impact: 'Mapping a Shopify location before these two warehouses exist attaches stock to a code the pack desk does not have.',
    detail: physicalOk && virtualOk
      ? 'WH-001 sells on every channel and is the pickup. WH-002 sells on Shopify only.'
      : 'WH-001 must be physical and the pickup. WH-002 must be virtual and Shopify-only.',
    clicks: [
      'Sidebar → Warehouses.',
      'Confirm WH-001 is physical, Active, sells on Shopify, Amazon, and Myntra, and Pickup is Yes.',
      'Confirm WH-002 is virtual, Active, sells on Shopify only, and Pickup is No.',
    ],
    sources: [
      'Both warehouses are created with the company. Confirm them on this page.',
      'Do not copy a Shopify location id or a Myntra warehouse id into these warehouse codes.',
    ],
    done: physicalOk && virtualOk,
    actionLabel: 'Open warehouses',
    actionPath: '/warehouses',
  });
}

function pickupStep(physical) {
  const line1 = String(physical?.address?.line1 || '').trim();
  const pincode = String(physical?.address?.pincode || '').trim();
  const phone = digits(physical?.contactPhone);
  const done = Boolean(line1 && /^\d{6}$/.test(pincode) && phone.length >= 10);
  const missing = [
    !line1 && 'street',
    !/^\d{6}$/.test(pincode) && '6-digit pincode',
    phone.length < 10 && 'phone',
  ].filter(Boolean);
  return step({
    id: 'pickup',
    phase: '2',
    phaseLabel: 'Warehouses',
    title: 'WH-001 pickup address',
    why: 'Shopify self-ship reads the godown street, pincode, and phone. The company profile is a separate address.',
    impact: 'A saved courier token still cannot book a label while this address is empty.',
    detail: done ? 'WH-001 has a street, pincode, and phone.' : `WH-001 still needs ${missing.join(', ')}.`,
    clicks: [
      'Sidebar → Warehouses.',
      'On the WH-001 row, click Pickup address.',
      'Fill street, city, state, the 6-digit pincode, contact person, and phone.',
      'Click Save pickup.',
    ],
    sources: [
      'Street, city, state, and pincode come from the physical godown. Use Shopify Admin → Settings → Locations → the offline shop address, or the pickup location registered on the Delhivery account.',
      'The phone is the number the courier calls at that godown.',
      'Company Details does not store a pincode. Saving the company address does not fill WH-001.',
    ],
    done,
    actionLabel: 'Open warehouses',
    actionPath: '/warehouses',
  });
}

function shopifyStep(row) {
  const done = channelReady(row);
  return step({
    id: 'shopify',
    phase: '3',
    phaseLabel: 'Channels',
    title: 'Shopify connection',
    why: 'Shopify is the first catalog. Its two locations map onto WH-001 and WH-002. Later channels attach to Master SKUs created here.',
    impact: 'Connecting Myntra or Amazon first can create a second identity for the same garment.',
    detail: done ? 'Shopify tested successfully on the environment you selected.' : 'Save the shop URL and app keys, then run the connection test.',
    clicks: [
      'Sidebar → Settings, then Channel Connections.',
      'Choose Shopify.',
      'Fill Shop URL, Client ID, API secret, and Webhook secret. Set API environment to Live or Sandbox.',
      'Click Test connection.',
    ],
    sources: [
      'Shop URL is the *.myshopify.com address from Shopify Admin. The public website address is not the API host.',
      'Client ID, API secret, and Webhook secret come from that shop’s app in the Shopify Dev Dashboard.',
      'COD payment method names are the gateway names Shopify shows on the order, such as Cash on Delivery.',
      'Location A and Location B on this form are not the live map. The next step pulls the real location ids.',
    ],
    done,
    actionLabel: 'Open channel connections',
    actionPath: '/settings?tab=channels',
  });
}

function locationStep(physical, virtual, maps) {
  const primary = maps.find((row) => physical && String(row.warehouseId) === String(physical._id) && row.isPrimaryForChannel);
  const second = maps.find((row) => virtual && String(row.warehouseId) === String(virtual._id) && !row.isPrimaryForChannel);
  const primaryId = String(primary?.externalLocationId || '');
  const secondId = String(second?.externalLocationId || '');
  const real = (value) => value && !PLACEHOLDER_LOCATIONS.has(value);
  const done = real(primaryId) && real(secondId) && primaryId !== secondId;
  let detail = 'Pull Shopify locations so WH-001 and WH-002 leave the placeholder ids.';
  if (done) detail = 'The physical Shopify location is on WH-001. The virtual location is on WH-002.';
  else if (primaryId && secondId && primaryId === secondId) detail = 'Both warehouses currently point at the same Shopify location.';
  return step({
    id: 'locations',
    phase: '3',
    phaseLabel: 'Channels',
    title: 'Shopify location mapping',
    why: 'Reservation uses WH-001 and WH-002. The Shopify location id is only the external key on that warehouse.',
    impact: 'A placeholder map sends virtual quantity to the wrong channel, or leaves physical quantity off Location A.',
    detail,
    clicks: [
      'After Shopify tests successfully, open Sidebar → Bulk import.',
      'On the Shopify card, click Pull live catalog.',
      'Then open Sidebar → Warehouses and read Channel location map.',
      'The offline shop must sit on WH-001. The virtual location must sit on WH-002.',
    ],
    sources: [
      'Location names and ids come from Shopify Admin → Settings → Locations.',
      'The pull replaces the placeholders shopify-location-a and shopify-location-b. Do not put the same id on both warehouses.',
    ],
    done,
    actionLabel: 'Open warehouses',
    actionPath: '/warehouses',
  });
}

function myntraStep(row) {
  const code = String(row?.warehouseCode || '').trim();
  const connected = channelReady(row);
  const codeOk = Boolean(code) && !/^\d+$/.test(code);
  const done = connected && codeOk;
  let detail = 'Save Merchant Id and Secret Key, then run the connection test.';
  if (connected && /^\d+$/.test(code)) detail = 'The warehouse code is only digits. Use the partner warehouse code, the value that contains C and W. The numeric portal id stays a label.';
  else if (connected && !code) detail = 'Add the partner warehouse code. The numeric portal warehouse id is a label.';
  else if (done) detail = 'Myntra tested successfully and the partner warehouse code is saved.';
  return step({
    id: 'myntra',
    phase: '3',
    phaseLabel: 'Channels',
    title: 'Myntra PPMP',
    why: 'Myntra listings attach to Master SKUs that Shopify already created, matched by barcode or seller SKU.',
    impact: 'Myntra orders stay out of the desk until this connection succeeds.',
    detail,
    clicks: [
      'Sidebar → Settings, then Channel Connections.',
      'Choose Myntra PPMP.',
      'Fill Merchant Id, Secret Key, and Warehouse code. The warehouse code contains the letters C and W.',
      'Set API environment, then click Test connection.',
    ],
    sources: [
      'Merchant Id and Secret Key come from the Myntra PPMP partner mail.',
      'Warehouse code is the partner store code, shaped like C…W…. The numeric portal Warehouse ID belongs only in Warehouse ID (portal). Do not put that number in Warehouse code.',
      'Seller ID is a portal label. The token call uses Merchant Id.',
    ],
    done,
    actionLabel: 'Open channel connections',
    actionPath: '/settings?tab=channels',
  });
}

function amazonStep(row) {
  const done = channelReady(row);
  return step({
    id: 'amazon',
    phase: '3',
    phaseLabel: 'Channels',
    title: 'Amazon seller',
    why: 'Amazon is the third catalog so its listings match existing Master SKUs. Use this OMS app. A sandbox token stays on Sandbox.',
    impact: 'Amazon orders and Amazon available-to-sell stay disconnected until the test succeeds.',
    detail: done
      ? 'Amazon tested successfully on the environment you selected.'
      : 'Save the seller id, refresh token, and LWA client id and secret, then run the test.',
    clicks: [
      'Sidebar → Settings, then Channel Connections.',
      'Choose Amazon.',
      'Fill Seller ID, SP-API refresh token, LWA Client ID, and LWA Client Secret.',
      'Set API environment to Sandbox only when the token is a sandbox token. Use Live only with the production token.',
      'Click Test connection.',
    ],
    sources: [
      'Seller ID is the Seller Central merchant token. It starts with A. It is not the Partner Account ID.',
      'The refresh token comes from authorizing this OMS app in Seller Central.',
      'LWA Client ID and LWA Client Secret come from this OMS developer app. Do not paste another product’s client id, or a sandbox token, into Live.',
      'India marketplace id is A21TJRUUN4KGV when Marketplace ID is left blank.',
    ],
    done,
    actionLabel: 'Open channel connections',
    actionPath: '/settings?tab=channels',
  });
}

function courierState(rows) {
  const active = rows.find((row) => row.status === 'active') || rows[0];
  if (!active) return { token: false, pickup: false, active: false };
  let creds = {};
  try {
    creds = decryptObject(active.credentialsEnc);
  } catch {
    creds = {};
  }
  return {
    token: Boolean(String(creds.apiToken || '').trim()),
    pickup: Boolean(String(creds.pickupWarehouse || '').trim()),
    active: active.status === 'active',
  };
}

function courierStep(courier) {
  const done = courier.token && courier.pickup && courier.active;
  let detail = 'Save the Delhivery API token, client name, and the pickup warehouse name from that account.';
  if (courier.token && courier.active && !courier.pickup) detail = 'The token is saved. Add the pickup warehouse name exactly as it is registered on the Delhivery account.';
  else if (courier.token && !courier.active) detail = 'The token is saved. Mark the Delhivery account active when you are ready to book.';
  else if (done) detail = 'Delhivery token and pickup warehouse name are saved. Leave the API environment empty until you are ready to book a label.';
  return step({
    id: 'courier',
    phase: '3',
    phaseLabel: 'Channels',
    title: 'Shopify courier',
    why: 'Shopify self-ship books this company’s own Delhivery label from WH-001. Amazon and Myntra keep their marketplace courier.',
    impact: 'Packed Shopify orders cannot get an own-courier label until the token and pickup name are saved.',
    detail,
    clicks: [
      'Sidebar → Settings, then Courier Settings.',
      'Click Manage Own Courier.',
      'On Delhivery, click Add credentials, or open the saved account.',
      'Fill API token, Client name, and Pickup warehouse name. Set Status to Active.',
      'Leave API environment empty until you are ready to book a label.',
      'Click Save credentials.',
    ],
    sources: [
      'API token, Client name, and Pickup warehouse name come from the Delhivery account, or from Delhivery One.',
      'Pickup warehouse name must match the location name registered on Delhivery. It is not automatically WH-001.',
      'Amazon and Myntra do not use this token. They keep the marketplace courier.',
    ],
    done,
    actionLabel: 'Open courier settings',
    actionPath: '/settings?tab=couriers',
  });
}

function catalogStep(masterCount, rows, byChannel) {
  const needed = ['shopify', 'myntra', 'amazon'].filter((id) => channelReady(byChannel[id]));
  const problems = [];
  needed.forEach((channel) => {
    const mine = rows.filter((row) => row.channel === channel);
    const synced = mine.filter((row) => row.syncStatus === 'synced' && row.masterSkuId).length;
    const open = mine.filter((row) => row.syncStatus === 'unmapped' || row.syncStatus === 'error').length;
    if (!synced) problems.push(`${channel} has no mapped listing`);
    if (open) problems.push(`${channel} has ${open} unmapped or failed listing${open === 1 ? '' : 's'}`);
  });
  const shopifyReady = channelReady(byChannel.shopify);
  const done = masterCount > 0 && shopifyReady && needed.length > 0 && problems.length === 0;
  let detail = 'Connect Shopify, then pull Shopify, Myntra, and Amazon in that order.';
  if (!shopifyReady) detail = 'Connect Shopify before mapping. The first pull creates Master SKUs.';
  else if (!masterCount) detail = 'Shopify is connected. Pull the catalog to create Master SKUs.';
  else if (problems.length) detail = problems.join('. ') + '.';
  else detail = `${masterCount} Master SKU${masterCount === 1 ? '' : 's'}. Every connected channel listing is mapped.`;
  return step({
    id: 'catalog',
    phase: '4',
    phaseLabel: 'Catalog',
    title: 'Master SKU and mappings',
    why: 'One garment is one Master SKU. Each channel listing is a mapping row. An unmapped line does not reserve and does not create a stock row.',
    impact: 'Stock entered against an unmapped listing is invisible to the order desk.',
    detail,
    clicks: [
      'Sidebar → Bulk import.',
      'Click Pull live catalog on Shopify first, then on Myntra, then on Amazon.',
      'Open Sidebar → SKU Mapping.',
      'On an Unmapped or Failed row, type an existing Master SKU and click Map. Click Create as new only when the garment is truly new.',
    ],
    sources: [
      'Listings, barcodes, and seller SKUs come from the channel pull.',
      'A row with no barcode or seller-SKU match stays Unmapped and gets no stock.',
    ],
    done,
    actionLabel: 'Open SKU mapping',
    actionPath: '/sku-mapping',
  });
}

function stockStep(authority, stocked, opening) {
  const done = stocked > 0 && opening > 0;
  const shopifyMaster = authority === 'shopify';
  const source = shopifyMaster
    ? 'Shopify is master, so Location A should write WH-001 through a ledger movement.'
    : 'Use Stock in. That writes a ledger receipt. Available quantity is on hand minus reserved.';
  return step({
    id: 'stock',
    phase: '5',
    phaseLabel: 'Stock',
    title: 'Opening stock ledger',
    why: 'Quantity is a ledger. Shopify available-to-sell is WH-001 plus WH-002. Amazon and Myntra use WH-001 only.',
    impact: 'With no opening movement, in-stock orders fall through to a vendor line.',
    detail: done
      ? `${stocked} SKU${stocked === 1 ? '' : 's'} have on-hand quantity and ${opening} opening movement${opening === 1 ? '' : 's'} are on the ledger.`
      : source,
    clicks: shopifyMaster
      ? [
        'Do not click Stock in. Sellable edits stay closed while Shopify is master.',
        'Sidebar → Inventory. Confirm WH-001 after the inventory sync reads Shopify Location A.',
      ]
      : [
        'Sidebar → Inventory.',
        'Click Stock in.',
        'Choose the Master SKU. Choose WH-001 for units in the godown. Choose WH-002 only for units that exist on Shopify and nowhere else.',
        'Click Post stock in.',
      ],
    sources: shopifyMaster
      ? [
        'The quantity is the available quantity on the Shopify offline location (Location A) in Shopify Admin → Settings → Locations.',
        'The sync writes a ledger movement into WH-001. Amazon and Myntra then receive WH-001 only.',
      ]
      : [
        'WH-001 quantity is the physical count at the godown.',
        'WH-002 quantity is virtual units that sell on Shopify only.',
        'Post stock in writes a ledger receipt. Do not type over the on-hand number.',
      ],
    done,
    actionLabel: 'Open inventory',
    actionPath: '/inventory',
  });
}

function pipelineStep(imported, reserved, shipped) {
  const done = imported > 0 && reserved > 0 && shipped > 0;
  const parts = [];
  if (!imported) parts.push('import one channel order');
  if (!reserved) parts.push('reserve a mapped line');
  if (!shipped) parts.push('book one shipment');
  return step({
    id: 'pipeline',
    phase: '6',
    phaseLabel: 'Go live',
    title: 'Order pipeline',
    why: 'One channel order becomes one Master Order. WH-001 units pack here. Virtual and out-of-stock units stay vendor lines on that same order.',
    impact: 'A label booked before mapping and stock creates a shipment the ledger cannot explain.',
    detail: done
      ? 'A channel order has been imported, reserved, and shipped.'
      : `Still needed: ${parts.join(', ')}.`,
    clicks: [
      'On each channel, under Channel Connections, set Import orders from to the date you want orders to start.',
      'Sidebar → Orders. One channel order is one Master Order.',
      'Sidebar → Fulfilment. Pack WH-001 units with Pack & Ship. A short line stays a vendor line on the same order.',
      'Sidebar → Shipping. For a Shopify order, select it and click Book selected labels only after WH-001 has street, pincode, and phone, and the Delhivery API environment is Live.',
      'Amazon and Myntra use that marketplace’s ship step on Fulfilment. Do not book them on Delhivery.',
    ],
    sources: [
      'The order comes from the channel after the saved Import orders from date.',
      'The reservation is written on the inventory ledger when the line is mapped and in stock.',
      'The AWB appears only after the courier API environment is Live and the WH-001 pickup is complete.',
    ],
    done,
    actionLabel: 'Open orders',
    actionPath: '/orders',
  });
}

async function platformChecklist(deps = {}) {
  const encryptionKey = deps.encryptionKey != null ? deps.encryptionKey : process.env.CHANNEL_ENCRYPTION_KEY;
  const jwtAccess = deps.jwtAccess != null ? deps.jwtAccess : process.env.JWT_ACCESS_SECRET;
  const jwtRefresh = deps.jwtRefresh != null ? deps.jwtRefresh : process.env.JWT_REFRESH_SECRET;
  const redisUrl = deps.redisUrl != null ? deps.redisUrl : process.env.REDIS_URL;
  const publicBaseUrl = deps.publicBaseUrl != null ? deps.publicBaseUrl : process.env.PUBLIC_BASE_URL;
  const publicAppUrl = deps.publicAppUrl != null
    ? deps.publicAppUrl
    : (await PlatformSetting.findOne({ key: 'default' }))?.publicAppUrl;
  const mailConfigured = deps.mailConfigured != null
    ? Boolean(deps.mailConfigured)
    : Boolean(await platformMailboxFromSettings());
  const database = deps.mongoConnected != null
    ? Boolean(deps.mongoConnected)
    : mongoose.connection.readyState === 1;
  let redis = false;
  if (String(redisUrl || '').trim()) {
    try {
      const probe = deps.redisReachable || defaultRedisProbe();
      redis = Boolean(await probe(String(redisUrl).trim()));
    } catch {
      redis = false;
    }
  }
  const [subscriber, plans] = await Promise.all([
    subscriberReady(),
    plansReady(),
  ]);
  const https = httpsUrl(publicAppUrl) || httpsUrl(publicBaseUrl);
  const steps = [
    step({
      id: 'database',
      phase: '0',
      phaseLabel: 'Platform',
      title: 'Database',
      why: 'Every tenant shares this MongoDB deployment. Stock reservation needs a replica set or Atlas.',
      impact: 'A standalone server cannot lock the last unit for two orders at once.',
      detail: database ? 'MongoDB is connected.' : 'MongoDB is not connected.',
      clicks: [
        'This is the API server, not a button in the merchant app.',
        'If this stays open, set MONGODB_URI to a replica set or Atlas and restart the API.',
      ],
      sources: [
        'The connection string is MONGODB_URI on the API host.',
        'Stock reservation needs a replica set or Atlas.',
      ],
      done: database,
      actionLabel: '',
      actionPath: '',
    }),
    step({
      id: 'encryption',
      phase: '0',
      phaseLabel: 'Platform',
      title: 'Secret encryption',
      why: 'Channel tokens and courier secrets are encrypted before they are stored.',
      impact: 'An example key, or an empty key, leaves saved tokens unreadable after a restart.',
      detail: secretReady(encryptionKey) ? 'The channel encryption key is set.' : 'Set CHANNEL_ENCRYPTION_KEY to a private value before any merchant saves a token.',
      clicks: [
        'Open the API server environment. Platform Settings cannot store this key.',
        'Set CHANNEL_ENCRYPTION_KEY to a private value at least 16 characters long.',
        'Restart the API before any merchant saves a token.',
      ],
      sources: [
        'Generate a private key and keep it with the server secrets.',
        'Do not use the example value change-me-channel-encryption-key.',
      ],
      done: secretReady(encryptionKey),
      actionLabel: '',
      actionPath: '',
    }),
    step({
      id: 'jwt',
      phase: '0',
      phaseLabel: 'Platform',
      title: 'Login secrets',
      why: 'Access tokens and refresh cookies are signed with these secrets.',
      impact: 'The example secrets in the env file are not safe on a shared server.',
      detail: secretReady(jwtAccess) && secretReady(jwtRefresh)
        ? 'Access and refresh secrets are set.'
        : 'Replace both JWT secrets before inviting merchants.',
      clicks: [
        'Open the API server environment. The Auth screen does not paste these secrets.',
        'Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.',
        'Restart the API before inviting merchants.',
      ],
      sources: [
        'Use two private values you generate.',
        'Do not use the example strings from the sample env file.',
      ],
      done: secretReady(jwtAccess) && secretReady(jwtRefresh),
      actionLabel: '',
      actionPath: '',
    }),
    step({
      id: 'redis',
      phase: '0',
      phaseLabel: 'Platform',
      title: 'Queue',
      why: 'Order pulls, catalog pulls, and stock pushes run on Redis. The job row still stores status and retries.',
      impact: 'Without Redis, a failed pull cannot retry safely.',
      detail: redis ? 'Redis answered a ping.' : 'Set REDIS_URL and confirm Redis is reachable.',
      clicks: [
        'Set REDIS_URL in the API environment and restart the API.',
        'Sidebar → Jobs shows whether channel pulls and stock jobs are running.',
      ],
      sources: [
        'The address is the Redis instance that runs the job queue.',
      ],
      done: redis,
      actionLabel: 'Open jobs',
      actionPath: '/platform/jobs',
    }),
    step({
      id: 'https',
      phase: '0',
      phaseLabel: 'Platform',
      title: 'Public HTTPS address',
      why: 'Channel webhooks need a public HTTPS origin. Localhost cannot receive them.',
      impact: 'Orders then appear only when someone runs a manual pull.',
      detail: https ? 'A public HTTPS address is saved.' : 'Save the public app URL with https, or set PUBLIC_BASE_URL.',
      clicks: [
        'Sidebar → Settings.',
        'In App link in emails, paste the public https address of this OMS.',
        'Click Save settings.',
      ],
      sources: [
        'Use the public website customers and webhooks can reach. Localhost cannot receive channel webhooks.',
        'PUBLIC_BASE_URL in the API environment is the other place this address can be set.',
      ],
      done: https,
      actionLabel: 'Open platform settings',
      actionPath: '/platform/settings',
    }),
    step({
      id: 'mail',
      phase: '0',
      phaseLabel: 'Platform',
      title: 'Outbound mail',
      why: 'Invites and password-reset codes leave from the platform mailbox.',
      impact: 'A new merchant owner cannot receive the login mail.',
      detail: mailConfigured ? 'A mailbox is configured.' : 'Save the platform Gmail address and app password.',
      clicks: [
        'Sidebar → Settings.',
        'Fill Gmail address and Gmail app password.',
        'Click Save settings, then Send test email.',
      ],
      sources: [
        'The address is the mailbox that sends invites.',
        'The password is a Google App Password from Google Account → Security → App passwords. It is not the Gmail login password.',
      ],
      done: mailConfigured,
      actionLabel: 'Open platform settings',
      actionPath: '/platform/settings',
    }),
    step({
      id: 'subscriber',
      phase: '1',
      phaseLabel: 'Subscribers',
      title: 'First merchant',
      why: 'Provisioning creates the company, its roles, its owner, and empty WH-001 and WH-002.',
      impact: 'There is no isolated tenant to connect channels to.',
      detail: subscriber
        ? 'At least one merchant has an active Super Admin.'
        : 'Create a subscriber and its owner login.',
      clicks: [
        'Sidebar → Subscribers.',
        'Click New Tenant.',
        'Enter Merchant name and Owner email, choose the plan and launch channels, then click Create & open import.',
      ],
      sources: [
        'Merchant name and Owner email come from the person who will sign in as Merchant Super Admin.',
        'Creating the tenant also creates the roles and empty WH-001 and WH-002. The invite goes to the owner email.',
      ],
      done: subscriber,
      actionLabel: 'Open subscribers',
      actionPath: '/platform/tenants',
    }),
    step({
      id: 'plans',
      phase: '1',
      phaseLabel: 'Subscribers',
      title: 'Plan price',
      why: 'Trial length and the order price are platform settings. They are not stored on the merchant.',
      impact: 'A new tenant can still be created. Billing has no price to quote.',
      detail: plans ? 'A plan price is saved.' : 'Save the monthly minimum and the order slabs.',
      clicks: [
        'Sidebar → Plans.',
        'Fill Minimum per month (₹) and the order slabs.',
        'Click Save pricing.',
      ],
      sources: [
        'The amounts are the prices you charge per order. They are not stored on the merchant.',
      ],
      done: plans,
      actionLabel: 'Open plans',
      actionPath: '/platform/plans',
    }),
  ];
  return pack('platform', steps);
}

async function subscriberReady() {
  const roles = await skip(Role.find({ code: 'super_admin' }).select('tenantId'));
  if (!roles.length) return false;
  const tenantIds = roles.map((row) => row.tenantId);
  const merchants = await Tenant.find({ _id: { $in: tenantIds }, kind: 'merchant' }).select('_id');
  if (!merchants.length) return false;
  const owner = await skip(User.findOne({
    tenantId: { $in: merchants.map((row) => row._id) },
    roleId: { $in: roles.map((row) => row._id) },
    status: 'active',
  }).select('_id'));
  return Boolean(owner);
}

async function plansReady() {
  const doc = await PlatformPricing.findOne({ key: 'default' }).select('slabs minimumMonthlyPaise');
  return Boolean(doc && Array.isArray(doc.slabs) && doc.slabs.length > 0 && doc.minimumMonthlyPaise > 0);
}

function defaultRedisProbe() {
  return async (url) => {
    const { redisReachable } = require('./bullTransport');
    return redisReachable(url);
  };
}

module.exports = { tenantChecklist, platformChecklist };
