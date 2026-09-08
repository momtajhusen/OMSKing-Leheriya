import { Outlet } from 'react-router-dom';
import { LayoutDashboard, Shield, Users, BarChart3, CheckCircle } from 'lucide-react';

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Left side - Brand panel with gradient */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary to-primary/80 flex-col justify-between p-12 text-white">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <LayoutDashboard className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold">OMSKing</h1>
            </div>
            <h2 className="text-4xl font-bold mb-4">Leheriya Creations</h2>
            <p className="text-white/80 text-lg">Complete Order Management System for Multi-Channel Retail</p>
          </div>
          
          <div className="space-y-6">
            <h3 className="text-xl font-semibold">Platform Features</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium">Multi-Channel Integration</p>
                  <p className="text-white/70 text-sm">Shopify, Amazon, Myntra unified dashboard</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium">Smart Inventory Management</p>
                  <p className="text-white/70 text-sm">Real-time stock tracking across warehouses</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium">Automated Fulfillment</p>
                  <p className="text-white/70 text-sm">Vendor routing and courier optimization</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium">Financial Reconciliation</p>
                  <p className="text-white/70 text-sm">Payment tracking and GST invoice generation</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/20 pt-6">
            <p className="text-white/60 text-sm">Trusted by leading fashion retailers across India</p>
          </div>
        </div>

        {/* Right side - Form content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}