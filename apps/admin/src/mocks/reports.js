// Reports mock data - 6 tabs datasets
export const reports = {
  // Sales report data
  sales: {
    summary: {
      totalRevenue: 5950000,
      totalOrders: 725,
      avgOrderValue: 8207,
      growth: 23.5,
    },
    chartData: [
      { month: 'Apr', revenue: 4200000, orders: 520 },
      { month: 'May', revenue: 4650000, orders: 580 },
      { month: 'Jun', revenue: 5100000, orders: 640 },
      { month: 'Jul', revenue: 5450000, orders: 680 },
      { month: 'Aug', revenue: 5800000, orders: 720 },
      { month: 'Sep', revenue: 5950000, orders: 725 },
    ],
    tableData: [
      { date: '2024-09-07', orders: 85, revenue: 685000, channel: 'Shopify' },
      { date: '2024-09-06', orders: 72, revenue: 580000, channel: 'Amazon' },
      { date: '2024-09-05', orders: 68, revenue: 545000, channel: 'Myntra' },
      { date: '2024-09-04', orders: 75, revenue: 620000, channel: 'Shopify' },
      { date: '2024-09-03', orders: 62, revenue: 510000, channel: 'Amazon' },
    ],
  },
  // Inventory report data
  inventory: {
    summary: {
      totalStock: 15420,
      reservedStock: 2340,
      availableStock: 13080,
      stockValue: 24500000,
    },
    warehouseData: [
      { warehouse: 'WH-001 Mumbai', stock: 5200, value: 8500000 },
      { warehouse: 'WH-002 Shopify Virtual', stock: 3800, value: 6200000 },
      { warehouse: 'WH-003 Jaipur', stock: 4200, value: 6800000 },
      { warehouse: 'WH-004 Delhi Return Hub', stock: 2220, value: 3000000 },
    ],
    tableData: [
      { sku: 'MSKU-LH-KUR-001', name: 'Men\'s Leheriya Kurta - Navy', stock: 5, value: 4495 },
      { sku: 'MSKU-LH-KUR-003', name: 'Men\'s Leheriya Kurta - Green', stock: 8, value: 7992 },
      { sku: 'MSKU-LH-SAR-002', name: 'Women\'s Leheriya Saree - Pink', stock: 3, value: 7497 },
      { sku: 'MSKU-LH-LEH-001', name: 'Women\'s Leheriya Lehenga - Red', stock: 12, value: 107988 },
      { sku: 'MSKU-LH-KUR-004', name: 'Men\'s Leheriya Kurta - Maroon', stock: 6, value: 6594 },
    ],
  },
  // Shipping report data
  shipping: {
    summary: {
      totalShipments: 680,
      delivered: 620,
      inTransit: 45,
      exceptions: 15,
      avgDeliveryTime: 2.8,
    },
    courierData: [
      { courier: 'Delhivery', shipments: 280, delivered: 265, avgTime: 2.5 },
      { courier: 'Bluedart', shipments: 220, delivered: 205, avgTime: 2.8 },
      { courier: 'Ecom Express', shipments: 120, delivered: 110, avgTime: 3.2 },
      { courier: 'Xpressbees', shipments: 60, delivered: 40, avgTime: 3.5 },
    ],
    tableData: [
      { awb: 'DEL123456789', orderId: '65207-LEH', courier: 'Delhivery', status: 'Delivered', date: '2024-09-05' },
      { awb: 'BLU987654321', orderId: '65208-LEH', courier: 'Bluedart', status: 'In Transit', date: '2024-09-06' },
      { awb: 'ECO456789123', orderId: '65211-LEH', courier: 'Ecom Express', status: 'Delivered', date: '2024-09-04' },
      { awb: 'XPR789123456', orderId: '65215-LEH', courier: 'Xpressbees', status: 'Exception', date: '2024-09-07' },
      { awb: 'DEL321654987', orderId: '65218-LEH', courier: 'Delhivery', status: 'Delivered', date: '2024-09-03' },
    ],
  },
  // Returns report data
  returns: {
    summary: {
      totalReturns: 85,
      approved: 65,
      rejected: 12,
      pending: 8,
      returnRate: 4.2,
    },
    reasonData: [
      { reason: 'Size Issue', count: 35, percentage: 41.2 },
      { reason: 'Quality Issue', count: 25, percentage: 29.4 },
      { reason: 'Wrong Item', count: 15, percentage: 17.6 },
      { reason: 'Damaged', count: 10, percentage: 11.8 },
    ],
    tableData: [
      { returnId: 'RET-001', orderId: '65215-LEH', reason: 'Size Issue', status: 'Approved', amount: 10079 },
      { returnId: 'RET-002', orderId: '65220-LEH', reason: 'Quality Issue', status: 'Pending', amount: 3359 },
      { returnId: 'RET-003', orderId: '65225-LEH', reason: 'Wrong Item', status: 'Rejected', amount: 10198 },
      { returnId: 'RET-004', orderId: '65230-LEH', reason: 'Size Issue', status: 'Approved', amount: 4796 },
      { returnId: 'RET-005', orderId: '65235-LEH', reason: 'Damaged', status: 'Approved', amount: 9179 },
    ],
  },
  // Reconciliation report data
  reconciliation: {
    shopify: {
      totalOrders: 450,
      reconciled: 420,
      pending: 25,
      mismatched: 5,
      amount: 3500000,
    },
    amazonMyntra: {
      totalSettlements: 280,
      matched: 265,
      underpaid: 10,
      missing: 5,
      amount: 2100000,
    },
    tableData: [
      { orderId: '65207-LEH', status: 'Delivered', paymentStatus: 'Paid', returnStatus: 'None', amount: 2014 },
      { orderId: '65208-LEH', status: 'Delivered', paymentStatus: 'Paid', returnStatus: 'None', amount: 2398 },
      { orderId: '65211-LEH', status: 'Delivered', paymentStatus: 'Paid', returnStatus: 'None', amount: 2240 },
      { orderId: '65215-LEH', status: 'Delivered', paymentStatus: 'Underpaid', returnStatus: 'None', amount: 9500 },
      { orderId: '65218-LEH', status: 'Delivered', paymentStatus: 'Paid', returnStatus: 'None', amount: 2751 },
    ],
  },
  // Vendors report data
  vendors: {
    summary: {
      totalVendors: 8,
      activeVendors: 6,
      inactiveVendors: 2,
      totalOrders: 320,
      totalRevenue: 2800000,
    },
    vendorData: [
      { vendor: 'Sandeep Textiles', orders: 85, revenue: 720000, rating: 4.5 },
      { vendor: 'Rajshree Fabrics', orders: 72, revenue: 650000, rating: 4.3 },
      { vendor: 'Manoj Agarwal', orders: 65, revenue: 580000, rating: 4.2 },
      { vendor: 'Sunita Verma', orders: 58, revenue: 520000, rating: 4.4 },
      { vendor: 'Demo Vendor 1', orders: 40, revenue: 330000, rating: 4.0 },
    ],
    tableData: [
      { vendor: 'Sandeep Textiles', orders: 85, pending: 12, shipped: 65, delivered: 8, revenue: 720000 },
      { vendor: 'Rajshree Fabrics', orders: 72, pending: 10, shipped: 55, delivered: 7, revenue: 650000 },
      { vendor: 'Manoj Agarwal', orders: 65, pending: 8, shipped: 52, delivered: 5, revenue: 580000 },
      { vendor: 'Sunita Verma', orders: 58, pending: 7, shipped: 48, delivered: 3, revenue: 520000 },
      { vendor: 'Demo Vendor 1', orders: 40, pending: 5, shipped: 32, delivered: 3, revenue: 330000 },
    ],
  },
};