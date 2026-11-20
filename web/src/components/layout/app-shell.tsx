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
  Search,
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
  "/request-db": "nav.requestDb",
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
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground transition-colors duration-300 ease-in-out">
      {/* Sleek Left Vertical Icon Dock */}
      <AppSidebar onOpenSearch={() => setCommandPaletteOpen(true)} />

      {/* Main App Frame */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Modern Top Header */}
        <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center justify-between border-b border-border/80 bg-card/85 px-4 sm:px-6 lg:px-8 backdrop-blur-md transition-colors duration-300 ease-in-out select-none">
          {/* Breadcrumb Title */}
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg md:hidden text-muted-foreground hover:text-foreground"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Toggle navigation menu"
            >
              <Menu className="size-4.5" />
            </Button>
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="hidden sm:inline text-muted-foreground">CLIProxyAPI</span>
              <span className="hidden sm:inline text-muted-foreground/40">/</span>
              <span className="font-medium text-foreground truncate">
                {t(titleKey) || "CLIProxyAPI"}
              </span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Quick Command Palette Trigger Pill */}
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="hidden sm:inline-flex h-8 items-center gap-2.5 rounded-lg border border-border bg-background/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/60 hover:text-foreground cursor-pointer"
              aria-label={t("nav.quickSearch", "Quick search (⌘K)")}
            >
              <Search className="size-3.5 text-muted-foreground" />
              <span className="text-[11px]">{t("common.search")}…</span>
              <kbd className="pointer-events-none inline-flex h-4.5 select-none items-center rounded border border-border bg-card px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg sm:hidden text-muted-foreground hover:text-foreground"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label={t("nav.quickSearch", "Quick search (⌘K)")}
            >
              <Search className="size-4" />
            </Button>

            {/* Server Version Badge */}
            {info.data ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    onClick={() => navigate("/system")}
                    className="cursor-pointer gap-1.5 font-mono text-[11px] text-muted-foreground border-border bg-background/50 hover:bg-muted/60 hover:text-foreground transition-colors hidden md:inline-flex h-7 px-2.5 rounded-md"
                  >
                    <span className="size-1.5 rounded-full bg-emerald-500" />
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
                  className={cn(
                    "size-8 rounded-lg",
                    inspectorOpen && "bg-primary/10 text-primary hover:bg-primary/15",
                  )}
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
              ? "px-5 py-6 sm:px-8 sm:py-7 lg:px-10 pb-20 md:pb-10 flex flex-col overflow-hidden"
              : "px-5 py-6 sm:px-8 sm:py-7 lg:px-10 pb-20 md:pb-10",
          )}
        >
          <div className={cn("mx-auto w-full", isPluginPage ? "flex-1 flex flex-col max-w-none" : "max-w-[1680px]")}>
            <ErrorBoundary>
              <PageTransition className={isPluginPage ? "flex flex-1 flex-col min-h-0" : undefined} />
            </ErrorBoundary>
          </div>
        </main>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="fixed bottom-0 inset-x-0 z-30 flex md:hidden items-center justify-around border-t border-border/80 bg-card/95 px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-md">
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
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-xl px-3.5 py-1 text-[11px] font-medium transition-all",
        active
          ? "bg-primary/10 text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4.5 transition-transform", active && "scale-105")} />
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
