import React from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { CustomerBookingPage } from './pages/CustomerBooking';
import { VendorDashboardPage } from './pages/VendorDashboard';
import { AdminDashboardPage } from './pages/AdminDashboard';
import { LoginPage } from './pages/Login';

/** Navbar + footer shell for every page except the full-screen sign-in. */
const SiteLayout: React.FC = () => (
  <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
    <Navbar />
    <main className="flex-grow">
      <Outlet />
    </main>
    <Footer />
  </div>
);

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<SiteLayout />}>
          <Route path="/" element={<CustomerBookingPage />} />
          <Route path="/vendor" element={<VendorDashboardPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
