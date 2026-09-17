import type { ReactNode } from "react";
import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { AdminLayout } from "./components/layout/AdminLayout";
import { AppLayout } from "./components/layout/AppLayout";
import { LogoMark } from "./components/layout/Logo";
import { useAuth } from "./hooks/useAuth";
import {
  AdminDockerPage,
  AdminGroupsPage,
  AdminModelAccessPage,
  AdminOverviewPage,
  AdminPermissionsPage,
  AdminProviderKeysPage,
  AdminQuotasPage,
  AdminRulesPage,
  AdminSettingsPage,
  AdminUsersPage,
  AdminWorkspacesPage
} from "./views/admin/AdminViews";
import { LoginPage } from "./views/auth/LoginView";
import { SetupPage } from "./views/auth/SetupView";
import { DashboardPage } from "./views/dashboard/DashboardView";
import { ProjectDetailPage } from "./views/projects/ProjectDetailView";
import { ProviderKeysPage } from "./views/provider-keys/ProviderKeysView";
import { RuntimePage } from "./views/runtime/RuntimeView";
import { SettingsPage } from "./views/settings/SettingsView";
import { ServiceDetailPage } from "./views/workspaces/ServiceDetailView";
import { WorkspaceDetailPage } from "./views/workspaces/WorkspaceDetailView";

export function App() {
  const { initialized, initialize } = useAuth();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (!initialized) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-pulse">
            <LogoMark />
          </div>
          <div className="text-xs uppercase tracking-tighter2 text-dim">جارٍ تحميل سنغولاري…</div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedShell layout="app" />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/provider-keys" element={<ProviderKeysPage />} />
        <Route path="/runtime" element={<RuntimePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route element={<ProtectedShell layout="bare" />}>
        <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
        <Route path="/workspaces/:id/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/workspaces/:id/services/:serviceId" element={<ServiceDetailPage />} />
      </Route>

      <Route element={<ProtectedShell layout="admin" />}>
        <Route path="/admin" element={<AdminOnly><AdminOverviewPage /></AdminOnly>} />
        <Route path="/admin/users" element={<AdminOnly><AdminUsersPage /></AdminOnly>} />
        <Route path="/admin/groups" element={<AdminOnly><AdminGroupsPage /></AdminOnly>} />
        <Route path="/admin/workspaces" element={<AdminOnly><AdminWorkspacesPage /></AdminOnly>} />
        <Route path="/admin/permissions" element={<AdminOnly><AdminPermissionsPage /></AdminOnly>} />
        <Route path="/admin/rules" element={<AdminOnly><AdminRulesPage /></AdminOnly>} />
        <Route path="/admin/quotas" element={<AdminOnly><AdminQuotasPage /></AdminOnly>} />
        <Route path="/admin/model-access" element={<AdminOnly><AdminModelAccessPage /></AdminOnly>} />
        <Route path="/admin/provider-keys" element={<AdminOnly><AdminProviderKeysPage /></AdminOnly>} />
        <Route path="/admin/docker" element={<AdminOnly><AdminDockerPage /></AdminOnly>} />
        <Route path="/admin/settings" element={<AdminOnly><AdminSettingsPage /></AdminOnly>} />
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (user?.role !== "instance_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function ProtectedShell({ layout }: { layout: "app" | "bare" | "admin" }) {
  const { user, needsSetup } = useAuth();

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (layout === "admin") {
    return (
      <AdminLayout>
        <Outlet />
      </AdminLayout>
    );
  }

  if (layout === "bare") {
    return <Outlet />;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

function RootRedirect() {
  const { user, needsSetup } = useAuth();

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <Navigate to={user ? "/dashboard" : "/login"} replace />;
}
