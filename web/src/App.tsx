import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { useAuthStore } from "@/stores/auth";
import { usePrefsStore } from "@/stores/prefs";
import i18n from "@/i18n";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { RequestLogsPage } from "@/pages/request-logs";
import { RequestDBPage } from "@/pages/request-db";
import { ProvidersPage } from "@/pages/providers";
import { AuthFilesPage } from "@/pages/auth-files";
import { OAuthPage } from "@/pages/oauth";
import { QuotaPage } from "@/pages/quota";
import { ConfigPage } from "@/pages/config";
import { FileLogsPage } from "@/pages/file-logs";
import { PluginsPage } from "@/pages/plugins";
import { PluginPages } from "@/pages/plugin-pages";
import { SystemPage } from "@/pages/system";
import { PlaygroundPage } from "@/pages/playground";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const key = useAuthStore((state) => state.key);
  const location = useLocation();
  if (!key) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function LocaleSync() {
  const locale = usePrefsStore((state) => state.locale);
  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [locale]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <LocaleSync />
      <HashRouter>
        <TooltipProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/request-logs" element={<RequestLogsPage />} />
              <Route path="/request-db" element={<RequestDBPage />} />
              <Route path="/logs" element={<FileLogsPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/auth-files" element={<AuthFilesPage />} />
              <Route path="/oauth" element={<OAuthPage />} />
              <Route path="/quota" element={<QuotaPage />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/plugins" element={<PluginsPage />} />
              <Route path="/plugin-pages" element={<PluginPages />} />
              <Route path="/plugin-pages/:pluginId/:menuIndex" element={<PluginPages />} />
              <Route path="/system" element={<SystemPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TooltipProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}
