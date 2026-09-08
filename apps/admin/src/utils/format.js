import dayjs from 'dayjs';

// Format currency in INR
export const formatINR = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

// Format date
export const formatDate = (date) => {
  return dayjs(date).format('DD MMM YYYY');
};

// Format date and time
export const formatDateTime = (date) => {
  return dayjs(date).format('DD MMM YYYY, hh:mm A');
};

// Format percentage
export const formatPercent = (value) => {
  return `${value.toFixed(1)}%`;
};

// Status badge variant mapping
export const statusBadgeVariant = (status) => {
  const statusMap = {
    // Order statuses
    'New': 'default',
    'Pending': 'secondary',
    'Processing': 'default',
    'Packed': 'default',
    'Ready to Ship': 'default',
    'Dispatched': 'default',
    'Delivered': 'outline',
    'Cancelled': 'secondary',
    'Return Requested': 'destructive',
    'RTO In Transit': 'destructive',
    'Unfulfillable': 'destructive',
    'NDR': 'destructive',

    // Payment statuses
    'Paid': 'outline',
    'Unpaid': 'destructive',
    'Partially Paid': 'secondary',
    'Void': 'secondary',

    // Sync statuses
    'Synced': 'outline',
    'Error': 'destructive',

    // QC / reverse-logistics statuses
    'QC Pending': 'secondary',
    'QC Complete': 'outline',
    'QC Done': 'outline',
    'Approved': 'outline',
    'Rejected': 'destructive',
    'Completed': 'outline',
    'Restocked': 'outline',
    'Awaiting Pickup': 'secondary',
    'In Transit': 'default',
    'Received': 'outline',
    'Escalated': 'destructive',
    'Closed': 'outline',

    // Reconciliation statuses
    'matched': 'outline',
    'pending': 'secondary',
    'short_paid': 'destructive',
    'overpaid': 'secondary',
    'mismatch': 'destructive',
    'Payment Received': 'outline',
    'Return Received': 'outline',
    'Refund Pending': 'secondary',

    // Vendor order statuses
    'Pending Acceptance': 'secondary',
    'Accepted': 'default',
    'Ready to Dispatch': 'default',

    // General statuses
    'Active': 'outline',
    'Inactive': 'secondary',
    'Expired': 'secondary',
    'Connected': 'outline',
    'Critical': 'destructive',
    'Low': 'secondary',
    'Matched': 'outline',
    'Underpaid': 'destructive',
    'Missing': 'destructive',
  };
  
  return statusMap[status] || 'default';
};