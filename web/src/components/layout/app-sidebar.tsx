import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Blocks,
  Coins,
  Database,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  UserCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BrandAvatar } from "@/components/shared/brand-avatar";
import { plugins } from "@/api/management";
import { useAuthStore } from "@/stores/auth";
import { usePrefsStore } from "@/stores/prefs";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  onOpenSearch: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
}

interface NavItem {
  to: string;
  icon?: LucideIcon;
  logo?: string;
  labelKey?: string;
  defaultLabel: string;
}

interface NavGroup {
  groupKey: string;
  defaultTitle: string;
  items: NavItem[];
}

export function AppSidebar({ onOpenSearch, mobile, onNavigate }: AppSidebarProps) {
  const { t } = useTranslation();
  const clear = useAuthStore((state) => state.clear);
  const location = useLocation();
  const collapsed = usePrefsStore((state) => state.sidebarCollapsed);
  const toggleSidebar = usePrefsStore((state) => state.toggleSidebar);
  const isCollapsed = mobile ? false : collapsed;

  const navRef = useRef<HTMLElement | null>(null);
  const activeItemRef = useRef<HTMLAnchorElement | null>(null);
  const [indicator, setIndicator] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: plugins.list,
    staleTime: 30_000,
  });

  const pluginResourceNavItems = useMemo<NavItem[]>(() => {
    if (!pluginsQuery.data) return [];
    const items: NavItem[] = [];

    for (const p of pluginsQuery.data) {
      if (p.enabled === false && p.effective_enabled === false) continue;
      if (!p.menus || p.menus.length === 0) continue;

      p.menus.forEach((menu, index) => {
        const rawPath = (menu.path || "").trim();
        if (!rawPath) return;

        const label =
          (menu.menu || "").trim() ||
          (p.metadata?.name as string | undefined)?.trim() ||
          p.id;

        items.push({
          to: `/plugin-pages/${encodeURIComponent(p.id)}/${index}`,
          logo: p.logo || (p.metadata?.logo as string | undefined),
          icon: Layers,
          defaultLabel: label,
        });
      });
    }

    return items;
  }, [pluginsQuery.data]);

  const isCurrent = (to: string, indexInGroup?: number) => {
    if (to === "/") return location.pathname === "/";
    if (location.pathname === "/plugin-pages" && to.startsWith("/plugin-pages/") && indexInGroup === 0) {
      return true;
    }
    if (to === location.pathname) return true;
    if (to === "/plugin-pages" && location.pathname.startsWith("/plugin-pages")) return true;
    if (!to.startsWith("/plugin-pages") && location.pathname.startsWith(to)) return true;
    return false;
  };

  const updateIndicator = useCallback(() => {
    const el = activeItemRef.current;
    if (!el) {
      setIndicator(null);
      return;
    }
    setIndicator({ top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight });
  }, []);

  useLayoutEffect(() => {
    updateIndicator();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateIndicator);
    if (activeItemRef.current) observer.observe(activeItemRef.current);
    if (navRef.current) observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [updateIndicator, location.pathname, isCollapsed, mobile, pluginResourceNavItems.length]);

  const pluginGroupItems: NavItem[] =
    pluginResourceNavItems.length > 0
      ? pluginResourceNavItems
      : [
          {
            to: "/plugin-pages",
            icon: Layers,
            labelKey: "nav.pluginPages",
            defaultLabel: "插件配置",
          },
        ];

  const NAV_GROUPS: NavGroup[] = [
    {
      groupKey: "nav.observability",
      defaultTitle: "可观测性",
      items: [
        { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", defaultLabel: "监控仪表盘" },
        { to: "/playground", icon: Terminal, labelKey: "playground.title", defaultLabel: "接口调试" },
        { to: "/request-logs", icon: Activity, labelKey: "nav.requestLogs", defaultLabel: "请求日志" },
        { to: "/request-db", icon: Database, labelKey: "nav.requestDb", defaultLabel: "日志存储管理" },
        { to: "/logs", icon: ScrollText, labelKey: "nav.logs", defaultLabel: "运行日志" },
      ],
    },
    {
      groupKey: "nav.providers",
      defaultTitle: "供应商与凭据",
      items: [
        { to: "/providers", icon: Zap, labelKey: "nav.providersItem", defaultLabel: "供应商管理" },
        { to: "/auth-files", icon: KeyRound, labelKey: "nav.authFiles", defaultLabel: "凭据文件" },
        { to: "/oauth", icon: UserCheck, labelKey: "nav.oauth", defaultLabel: "OAuth 授权" },
        { to: "/quota", icon: Coins, labelKey: "nav.quota", defaultLabel: "配额调度" },
      ],
    },
    {
      groupKey: "nav.pluginPages",
      defaultTitle: "插件配置",
      items: pluginGroupItems,
    },
    {
      groupKey: "nav.management",
      defaultTitle: "系统与管理",
      items: [
        { to: "/plugins", icon: Blocks, labelKey: "nav.plugins", defaultLabel: "插件扩展" },
        { to: "/config", icon: Settings2, labelKey: "nav.config", defaultLabel: "系统配置" },
        { to: "/system", icon: ShieldCheck, labelKey: "nav.systemItem", defaultLabel: "系统信息" },
      ],
    },
  ];

  return (
    <aside
      className={cn(
        mobile
          ? "flex flex-col justify-between h-full w-full bg-white dark:bg-slate-900 z-40 select-none"
          : "hidden md:flex flex-col justify-between shrink-0 border-r border-slate-200/80 bg-white/95 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/95 z-40 select-none transition-all duration-300 ease-in-out",
        !mobile && (isCollapsed ? "w-[68px]" : "w-60 lg:w-64"),
      )}
    >
      {/* Top Brand & Sidebar Toggle */}
      <div className="flex flex-col shrink-0">
        <div
          className={cn(
            "flex items-center h-14 border-b border-slate-100 dark:border-slate-800/60 px-3.5",
            isCollapsed ? "justify-center" : "justify-between",
          )}
        >
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="cursor-pointer transition-transform hover:scale-105 active:scale-95"
                >
                  <BrandAvatar size={34} online={true} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-semibold text-xs">
                {t("nav.expandSidebar", "展开侧边栏")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandAvatar size={32} online={true} />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm tracking-tight text-slate-900 dark:text-slate-100 truncate">
                    CLIProxyAPI
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium leading-none truncate">
                    {t("nav.consoleSubtitle", "智能网关控制台")}
                  </span>
                </div>
              </div>

              {!mobile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition"
                    >
                      <PanelLeftClose className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {t("nav.collapseSidebar", "折叠侧栏")}
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Nav Scroll Area */}
      <nav
        ref={navRef}
        className="relative flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-3 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
      >
        {indicator ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-0 rounded-xl bg-blue-600 shadow-md shadow-blue-500/25 transition-[top,left,width,height] duration-300 ease-in-out"
            style={{ top: indicator.top, left: indicator.left, width: indicator.width, height: indicator.height }}
          />
        ) : null}
        {NAV_GROUPS.map((group) => (
          <div key={group.groupKey} className="space-y-1">
            {!collapsed && (
              <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {t(group.groupKey) || group.defaultTitle}
              </p>
            )}

            <div className="space-y-0.5">
              {group.items.map((item, itemIdx) => {
                const active = isCurrent(item.to, itemIdx);
                const title = (item.labelKey ? t(item.labelKey) : undefined) || item.defaultLabel;

                const renderItemIcon = (sizeClass: string) => {
                  if (item.logo) {
                    return (
                      <img
                        src={item.logo}
                        alt=""
                        className={cn("rounded object-contain shrink-0", sizeClass)}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = "none";
                        }}
                      />
                    );
                  }
                  const IconComp = item.icon ?? Layers;
                  return (
                    <IconComp
                      className={cn(
                        sizeClass,
                        "shrink-0 transition-transform duration-150",
                        active
                          ? "text-white"
                          : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300",
                      )}
                    />
                  );
                };

                if (isCollapsed) {
                  return (
                    <Tooltip key={item.to}>
                      <TooltipTrigger asChild>
                        <NavLink
                          to={item.to}
                          onClick={() => onNavigate?.()}
                          ref={active ? activeItemRef : undefined}
                          className={cn(
                            "group relative z-10 flex items-center justify-center size-10 mx-auto rounded-xl transition-all duration-200",
                            active
                              ? "text-white font-semibold"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100",
                          )}
                        >
                          {renderItemIcon("size-4.5")}
                        </NavLink>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="text-xs font-medium">
                        {title}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => onNavigate?.()}
                    ref={active ? activeItemRef : undefined}
                    className={cn(
                      "group relative z-10 flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150",
                      active
                        ? "text-white font-semibold"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100",
                    )}
                  >
                    {renderItemIcon("size-4")}
                    <span className="truncate">{title}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Actions: Search, Expand Button if collapsed, Logout */}
      <div className="border-t border-slate-100 dark:border-slate-800/60 p-2.5 space-y-1 shrink-0">
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="flex size-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition"
                >
                  <PanelLeftOpen className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {t("nav.expandSidebar", "展开侧栏")}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSearch();
                    onNavigate?.();
                  }}
                  className="flex size-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 transition"
                >
                  <Search className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {t("nav.quickSearch", "快速搜索 (⌘K)")}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    onNavigate?.();
                  }}
                  className="flex size-9 items-center justify-center rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                >
                  <LogOut className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {t("nav.logout")}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                onOpenSearch();
                onNavigate?.();
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 transition"
            >
              <div className="flex items-center gap-2">
                <Search className="size-3.5 text-slate-400" />
                <span>{t("nav.quickSearch", "快速搜索 (⌘K)")}</span>
              </div>
              <kbd className="pointer-events-none inline-flex h-4 select-none items-center rounded border border-slate-200 bg-white px-1 font-mono text-[9px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => {
                clear();
                onNavigate?.();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30 transition"
            >
              <LogOut className="size-3.5" />
              <span>{t("nav.logout")}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
