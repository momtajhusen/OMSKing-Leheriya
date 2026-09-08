import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { usePageTransition } from '../../hooks/usePageTransition';

export default function PageFade({ children, className }) {
  const { pathname } = useLocation();
  const pageTransition = usePageTransition();

  return (
    <motion.div key={pathname} {...pageTransition} className={className}>
      {children}
    </motion.div>
  );
}
