import "./App.css";

import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";

import Navbar from "./landing_page/Navbar.jsx";
import Footer from "./landing_page/Footer.jsx";

import HomePage from "./landing_page/home/HomePage.jsx";
import Signup from "./landing_page/signup/Signup.jsx";
import AboutPage from "./landing_page/about/AboutPage.jsx";
import ProductsPage from "./landing_page/products/ProductsPage.jsx";
import PricingPage from "./landing_page/pricing/PricingPage.jsx";
import ContactPage from "./landing_page/support/SupportPage.jsx";
import NotFound from "./landing_page/NotFound.jsx";
import DashboardPage from "./dashboard/DashboardPage.jsx";

function AppRoutes() {
  const { loading, user } = useAuth();
  const location = useLocation();
  const dashboardRoute =
    location.pathname.startsWith("/dashboard") ||
    location.pathname.startsWith("/demo");
  if (loading) return <main className="container py-5">Loading account…</main>;
  return (
    <>
      {!dashboardRoute && <Navbar />}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/support" element={<Navigate to="/contact" replace />} />
        <Route path="/demo/*" element={<DashboardPage demoMode />} />
        <Route path="/dashboard/*" element={user ? <DashboardPage /> : <Navigate to="/signup" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      {!dashboardRoute && <Footer />}
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
