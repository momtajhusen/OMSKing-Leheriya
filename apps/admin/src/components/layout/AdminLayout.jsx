import { Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import { usePageTransition } from '../../hooks/usePageTransition';

function AdminLayout() {
  const pageTransition = usePageTransition();

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto">
          <motion.div
            {...pageTransition}
            className="page-container"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;