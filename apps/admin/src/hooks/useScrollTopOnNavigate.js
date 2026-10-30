import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { scrollPageToTop } from '../lib/scrollPageToTop';

export default function useScrollTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    scrollPageToTop();
  }, [pathname]);
}
