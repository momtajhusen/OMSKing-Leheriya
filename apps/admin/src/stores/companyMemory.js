import useOrderStore from './orderStore';
import useReturnsStore from './returnsStore';
import useVendorStore from './vendorStore';
import useChannelStore from './channelStore';
import useProductImageStore from '../lib/productImageStore';

/** Drop the previous company's lists when the signed-in tenant changes. */
export function resetCompanyData() {
  useOrderStore.getState().clearCompany();
  useReturnsStore.getState().clearCompany();
  useVendorStore.getState().clearCompany();
  useChannelStore.getState().clearCompany();
  useProductImageStore.getState().clearCompany();
}
