import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useOutlet } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  KeyRound,
  LayoutDashboard,
  Menu,
  Moon,
  Settings2,
  Sun,
  Terminal,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { InspectorDrawer } from "./inspector-drawer";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { server } from "@/api/management";
import { usePrefsStore } from "@/stores/prefs";
import { cn } from "@/lib/utils";

const TITLES: Record<string, string> = {
  "/": "nav.dashboard",
  "/playground": "playground.title",
  "/request-logs": "nav.requestLogs",
  "/logs": "nav.logs",
  "/providers": "nav.providersItem",
  "/auth-files": "nav.authFiles",
  "/oauth": "nav.oauth",
  "/quota": "nav.quota",
  "/config": "nav.config",
  "/plugins": "nav.plugins",
  "/plugin-pages": "pluginPages.title",
  "/system": "nav.systemItem",
};

function PageTransition({ className }: { className?: string }) {
  const location = useLocation();
  const outlet = useOutlet();
  const outletRef = useRef(outlet);
  outletRef.current = outlet;
  const [displayed, setDisplayed] = useState(() => ({ key: location.key, outlet }));
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (location.key === displayed.key) return;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setDisplayed({ key: location.key, outlet: outletRef.current });
      setLeaving(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [location.key, displayed.key]);

  return (
    <div
      key={displayed.key}
      className={cn(
        leaving ? "opacity-0 transition-opacity duration-150" : "animate-in fade-in duration-200",
        className,
      )}
    >
      {displayed.outlet}
    </div>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ["server-info"], queryFn: server.info, refetchInterval: 60_000, retry: 1 });

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isPluginPage = location.pathname.startsWith("/plugin-pages");
  const titleKey = isPluginPage ? "pluginPages.title" : (TITLES[location.pathname] ?? "app.subtitle");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#EFF4FB] dark:bg-[#0B1120] text-slate-800 dark:text-slate-200 transition-colors duration-300 ease-in-out">
      {/* Sleek Left Vertical Icon Dock */}
      <AppSidebar onOpenSearch={() => setCommandPaletteOpen(true)} />

      {/* Main App Frame */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Modern Top Header */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/80 px-4 md:px-6 backdrop-blur-md transition-colors duration-300 ease-in-out dark:border-slate-800/70 dark:bg-slate-900/80 select-none">
          {/* Breadcrumb & Gateway Status */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-xl md:hidden text-slate-600 dark:text-slate-300"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Toggle navigation menu"
              >
                <Menu className="size-4.5" />
              </Button>
              <h2 className="text-sm md:text-base font-bold text-slate-900 dark:text-slate-100 truncate tracking-tight">
                {t(titleKey) || "控制台"}
              </h2>
              <span className="hidden sm:inline-block text-slate-300 dark:text-slate-700">/</span>
              <span className="hidden sm:inline-block text-xs text-slate-400 font-medium">
                {t("nav.consoleSubtitle", "CLIProxyAPI 智能网关")}
              </span>
            </div>

            <div className="hidden xl:flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
              </span>
              <span>{t("nav.gatewayOnline", "网关在线")}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            {/* Server Version Badge */}
            {info.data ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="font-mono text-[11px] text-slate-500 border-slate-200 dark:border-slate-800 hidden md:inline-flex">
                    v{info.data.version}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs font-mono">
                  <p>Commit: {info.data.commit}</p>
                  <p>Build: {info.data.build_date}</p>
                </TooltipContent>
              </Tooltip>
            ) : null}

            <LanguageToggle />
            <ThemeToggle />

            {/* Toggle Inspector Drawer */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={inspectorOpen ? "secondary" : "ghost"}
                  size="icon"
                  className="size-8 rounded-xl"
                  aria-label={t("nav.realtimeInspector", "实时测控面板")}
                  onClick={() => setInspectorOpen(!inspectorOpen)}
                >
                  <Activity className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("nav.realtimeInspector", "实时测控面板")}</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Main Content Area */}
        <main
          className={cn(
            "flex-1 overflow-y-auto",
            isPluginPage
              ? "p-4 sm:p-6 md:p-8 pb-20 md:pb-8 flex flex-col overflow-hidden"
              : "p-4 sm:p-6 md:p-8 pb-20 md:pb-8",
          )}
        >
          <div className={cn("mx-auto w-full", isPluginPage ? "flex-1 flex flex-col max-w-none" : "max-w-[1700px]")}>
            <ErrorBoundary>
              <PageTransition className={isPluginPage ? "flex flex-1 flex-col min-h-0" : undefined} />
            </ErrorBoundary>
          </div>
        </main>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="fixed bottom-0 inset-x-0 z-30 flex md:hidden items-center justify-around border-t border-slate-200/80 bg-white/95 px-2 py-1.5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/95">
          <MobileNavButton
            icon={LayoutDashboard}
            label={t("nav.short.dashboard") || "监控"}
            active={location.pathname === "/"}
            onClick={() => navigate("/")}
          />
          <MobileNavButton
            icon={Zap}
            label={t("nav.short.providers") || "供应商"}
            active={location.pathname === "/providers"}
            onClick={() => navigate("/providers")}
          />
          <MobileNavButton
            icon={Terminal}
            label={t("nav.short.playground") || "调试"}
            active={location.pathname === "/playground"}
            onClick={() => navigate("/playground")}
          />
          <MobileNavButton
            icon={KeyRound}
            label={t("nav.short.authFiles") || "凭据"}
            active={location.pathname === "/auth-files"}
            onClick={() => navigate("/auth-files")}
          />
          <MobileNavButton
            icon={Settings2}
            label={t("nav.short.config") || "配置"}
            active={location.pathname === "/config"}
            onClick={() => navigate("/config")}
          />
        </nav>
      </div>

      {/* Mobile Full Navigation Drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="p-0 w-72 sm:w-80 border-r border-slate-200 dark:border-slate-800"
          showCloseButton={false}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t("app.title")}</SheetTitle>
          </SheetHeader>
          <AppSidebar
            mobile
            onOpenSearch={() => {
              setMobileNavOpen(false);
              setCommandPaletteOpen(true);
            }}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
      <InspectorDrawer open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
      <Toaster position="top-center" richColors />
    </div>
  );
}

function MobileNavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 text-[11px] font-medium transition ${
        active ? "text-blue-600 dark:text-blue-400" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      <Icon className={`size-4.5 ${active ? "scale-110" : ""}`} />
      <span>{label}</span>
    </button>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 rounded-xl"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-4 dark:hidden text-amber-500" />
      <Moon className="hidden size-4 dark:block text-blue-400" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

export function LanguageToggle() {
  const locale = usePrefsStore((state) => state.locale);
  const setLocale = usePrefsStore((state) => state.setLocale);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs font-medium rounded-xl">
          {locale === "zh-CN" ? "中文" : "EN"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-28 rounded-xl">
        <DropdownMenuItem onClick={() => setLocale("en")}>English</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLocale("zh-CN")}>简体中文</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
