import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { scrollPageToTop } from '../lib/scrollPageToTop';

export default function useScrollTopOnNavigate() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    // Browser back to the orders list: keep position; OrdersPage restores after rows load.
    if (navType === 'POP' && pathname === '/orders') return;
    scrollPageToTop();
  }, [pathname, navType]);
}
