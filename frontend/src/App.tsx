import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { FEATURE } from "./lib/features";
import { LoginPage } from "./pages/login";
import { OrdersPage } from "./pages/orders";
import { AppointmentsPage } from "./pages/appointments";
import { SettingsPage } from "./pages/settings";
import { SuperadminPanel } from "./pages/admin";
import { AppLayout } from "./components/layout/app-layout";

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: ReactNode }) {
  const { data: user, isLoading, error } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>
    );
  }
  if (error || !user) return <Navigate to="/login" replace />;
  if (user.role === "superadmin") return <SuperadminPanel />;
  return <>{children}</>;
}

/** Blocks a route whose feature isn't enabled for the company. Settings is the
 *  always-available fallback. */
function FeatureRoute({ feature, children }: { feature: string; children: ReactNode }) {
  const { data: user } = useAuth();
  if (user && !user.features?.includes(feature)) return <Navigate to="/setari" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <AuthGuard>
                <AppLayout />
              </AuthGuard>
            }
          >
            <Route path="/" element={<FeatureRoute feature={FEATURE.vendorCommunication}><OrdersPage /></FeatureRoute>} />
            <Route path="/programari" element={<FeatureRoute feature={FEATURE.customerCommunication}><AppointmentsPage /></FeatureRoute>} />
            <Route path="/setari" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
