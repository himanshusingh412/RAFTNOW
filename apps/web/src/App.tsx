import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { CustomerBookingPage } from './pages/CustomerBooking';
import { VendorDashboardPage } from './pages/VendorDashboard';
import { AdminDashboardPage } from './pages/AdminDashboard';
import { LoginPage } from './pages/Login';
import { ThemeProvider } from './components/ui';

/**
 * Navbar + footer shell for every page except the full-screen sign-in. The
 * customer site uses the light travel-booking look; the operator portal and
 * admin console keep the dark console.
 */
const SiteLayout: React.FC = () => {
  const { pathname } = useLocation();
  const theme = pathname === '/' ? 'light' : 'dark';
  // index.html paints the body dark; match it so overscroll never flashes the other theme.
  useEffect(() => {
    document.body.style.backgroundColor = theme === 'light' ? '#f2f2f2' : '';
    document.body.style.color = theme === 'light' ? '#171717' : '';
  }, [theme]);
  return (
    <ThemeProvider value={theme}>
      <div className={`min-h-screen flex flex-col ${theme === 'light' ? 'bg-[#f2f2f2] text-neutral-900' : 'bg-slate-950 text-slate-100'}`}>
        <Navbar />
        <main className="flex-grow">
          <Outlet />
        </main>
        <Footer />
      </div>
    </ThemeProvider>
  );
};

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
