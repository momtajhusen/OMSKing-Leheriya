import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';

export default function PageFade({ children, className }) {
  const { pathname } = useLocation();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('min-h-full', className)}
    >
      {children}
    </motion.div>
  );
}
