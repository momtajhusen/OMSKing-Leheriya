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
    'Pending': 'secondary',
    'Processing': 'default',
    'Awaiting_Shipment': 'default',
    'Shipped': 'default',
    'Delivered': 'outline',
    'Return_Requested': 'destructive',
    'RTO_In_Transit': 'destructive',
    'NDR': 'destructive',
    
    // Payment statuses
    'Paid': 'outline',
    'Unpaid': 'destructive',
    'Partially Paid': 'secondary',
    'Void': 'secondary',
    
    // Sync statuses
    'Synced': 'outline',
    'Pending': 'secondary',
    'Error': 'destructive',
    
    // General statuses
    'Active': 'outline',
    'Inactive': 'secondary',
    'Critical': 'destructive',
    'Low': 'secondary',
    'Matched': 'outline',
    'Underpaid': 'destructive',
    'Missing': 'destructive',
  };
  
  return statusMap[status] || 'default';
};