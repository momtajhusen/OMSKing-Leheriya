// Dashboard time series and summary data
export const dashboardSeries = {
  // 14-day orders trend
  ordersTrend: [
    { date: '2024-08-25', shopify: 45, amazon: 30, myntra: 25 },
    { date: '2024-08-26', shopify: 52, amazon: 35, myntra: 28 },
    { date: '2024-08-27', shopify: 48, amazon: 32, myntra: 30 },
    { date: '2024-08-28', shopify: 55, amazon: 40, myntra: 35 },
    { date: '2024-08-29', shopify: 60, amazon: 38, myntra: 32 },
    { date: '2024-08-30', shopify: 58, amazon: 42, myntra: 38 },
    { date: '2024-08-31', shopify: 65, amazon: 45, myntra: 40 },
    { date: '2024-09-01', shopify: 70, amazon: 48, myntra: 42 },
    { date: '2024-09-02', shopify: 62, amazon: 44, myntra: 38 },
    { date: '2024-09-03', shopify: 68, amazon: 50, myntra: 45 },
    { date: '2024-09-04', shopify: 72, amazon: 52, myntra: 48 },
    { date: '2024-09-05', shopify: 75, amazon: 55, myntra: 50 },
    { date: '2024-09-06', shopify: 78, amazon: 58, myntra: 52 },
    { date: '2024-09-07', shopify: 80, amazon: 60, myntra: 55 },
  ],
  // Revenue by channel (current month)
  revenueByChannel: [
    { channel: 'Shopify', revenue: 2450000 },
    { channel: 'Amazon', revenue: 1850000 },
    { channel: 'Myntra', revenue: 1650000 },
  ],
  // Order status distribution
  orderStatusDistribution: [
    { status: 'Pending', count: 45 },
    { status: 'Processing', count: 78 },
    { status: 'Shipped', count: 120 },
    { status: 'Delivered', count: 450 },
    { status: 'Returned', count: 32 },
  ],
  // Low stock products
  lowStockProducts: [
    {
      id: 'PRD-001',
      name: 'Men\'s Leheriya Kurta - Navy',
      sku: 'MSKU-LH-KUR-001',
      stock: 5,
      reorderPoint: 20,
      status: 'Critical',
    },
    {
      id: 'PRD-003',
      name: 'Men\'s Leheriya Kurta - Green',
      sku: 'MSKU-LH-KUR-003',
      stock: 8,
      reorderPoint: 25,
      status: 'Low',
    },
    {
      id: 'PRD-005',
      name: 'Women\'s Leheriya Saree - Pink',
      sku: 'MSKU-LH-SAR-002',
      stock: 3,
      reorderPoint: 15,
      status: 'Critical',
    },
    {
      id: 'PRD-007',
      name: 'Women\'s Leheriya Lehenga - Red',
      sku: 'MSKU-LH-LEH-001',
      stock: 12,
      reorderPoint: 20,
      status: 'Low',
    },
    {
      id: 'PRD-009',
      name: 'Men\'s Leheriya Kurta - Maroon',
      sku: 'MSKU-LH-KUR-004',
      stock: 6,
      reorderPoint: 18,
      status: 'Critical',
    },
  ],
  // Recent orders
  recentOrders: [
    {
      id: '65207-LEH',
      customer: 'Rahul Sharma',
      channel: 'Shopify',
      qty: 2,
      value: 2014,
      status: 'Delivered',
    },
    {
      id: '65208-LEH',
      customer: 'Priya Patel',
      channel: 'Amazon',
      qty: 1,
      value: 2398,
      status: 'Shipped',
    },
    {
      id: '65211-LEH',
      customer: 'Amit Kumar',
      channel: 'Myntra',
      qty: 2,
      value: 2240,
      status: 'Processing',
    },
    {
      id: '65215-LEH',
      customer: 'Sneha Gupta',
      channel: 'Shopify',
      qty: 1,
      value: 10079,
      status: 'Pending',
    },
    {
      id: '65218-LEH',
      customer: 'Vikram Singh',
      channel: 'Amazon',
      qty: 3,
      value: 2751,
      status: 'Delivered',
    },
  ],
  // Recent activity feed
  recentActivity: [
    {
      id: 'ACT-001',
      type: 'Order Dispatched',
      message: 'Order 65207-LEH dispatched via Delhivery',
      timestamp: '2 hours ago',
    },
    {
      id: 'ACT-002',
      type: 'Return Approved',
      message: 'Return request for order 65215-LEH approved',
      timestamp: '4 hours ago',
    },
    {
      id: 'ACT-003',
      type: 'SKU Created',
      message: 'New SKU MSKU-LH-KUR-005 created',
      timestamp: '6 hours ago',
    },
    {
      id: 'ACT-004',
      type: 'Payment Settled',
      message: 'Amazon settlement for 20 orders received',
      timestamp: '8 hours ago',
    },
    {
      id: 'ACT-005',
      type: 'Order Received',
      message: 'New order 65220-LEH received from Shopify',
      timestamp: '10 hours ago',
    },
  ],
  // KPI data
  kpi: {
    revenue: { value: 5950000, delta: 23.5 },
    orders: { value: 725, delta: 15.2 },
    fulfillmentRate: { value: 94.5, delta: 2.3 },
    returnRate: { value: 4.2, delta: -0.8 },
    rtoRate: { value: 1.5, delta: -0.3 },
    avgShipmentDays: { value: 2.8, delta: -0.2 },
  },
};