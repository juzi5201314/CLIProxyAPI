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
      if (!p.effective_enabled) continue;
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
      onTransitionEnd={updateIndicator}
      className={cn(
        mobile
          ? "flex flex-col justify-between h-full w-full bg-sidebar z-40 select-none"
          : "hidden md:flex flex-col justify-between shrink-0 border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl z-40 select-none transition-all duration-300 ease-in-out",
        !mobile && (isCollapsed ? "w-[68px]" : "w-60 lg:w-64"),
      )}
    >
      {/* Top Brand & Sidebar Toggle */}
      <div className="flex flex-col shrink-0">
        <div
          className={cn(
            "flex items-center h-13 border-b border-sidebar-border px-3.5",
            isCollapsed ? "justify-center" : "justify-between",
          )}
        >
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="cursor-pointer transition-opacity hover:opacity-85"
                >
                  <BrandAvatar size={30} online={true} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium text-xs">
                {t("nav.expandSidebar", "展开侧边栏")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandAvatar size={28} online={true} />
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-sm tracking-tight text-foreground truncate">
                    CLIProxyAPI
                  </span>
                </div>
              </div>

              {!mobile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
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
        className="relative flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-3.5 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
      >
        {indicator ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-0 rounded-lg bg-foreground/[0.055] dark:bg-white/[0.07] transition-[top,left,width,height] duration-200 ease-out"
            style={{ top: indicator.top, left: indicator.left, width: indicator.width, height: indicator.height }}
          />
        ) : null}
        {NAV_GROUPS.map((group, groupIdx) => (
          <div key={group.groupKey} className="space-y-1">
            {!isCollapsed ? (
              <p className="px-2.5 pb-0.5 text-[11px] font-medium text-muted-foreground/70">
                {t(group.groupKey) || group.defaultTitle}
              </p>
            ) : groupIdx > 0 ? (
              <div className="mx-auto my-1 h-px w-6 bg-border/70" />
            ) : null}

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
                        "shrink-0 transition-colors duration-150",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
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
                            "group relative z-10 flex items-center justify-center size-9 mx-auto rounded-lg transition-colors duration-150",
                            active
                              ? cn("text-foreground font-medium", !indicator && "bg-foreground/[0.055] dark:bg-white/[0.07]")
                              : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {renderItemIcon("size-4")}
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
                      "group relative z-10 flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors duration-150",
                      active
                        ? cn(
                            "text-foreground font-medium before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary",
                            !indicator && "bg-foreground/[0.055] dark:bg-white/[0.07]",
                          )
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
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
      <div className="border-t border-sidebar-border p-2.5 space-y-1 shrink-0">
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
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
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
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
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
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
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => {
                onOpenSearch();
                onNavigate?.();
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
            >
              <div className="flex items-center gap-2">
                <Search className="size-3.5 text-muted-foreground" />
                <span>{t("nav.quickSearch", "快速搜索")}</span>
              </div>
              <kbd className="pointer-events-none inline-flex h-4 select-none items-center rounded border border-border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => {
                clear();
                onNavigate?.();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 dark:hover:text-rose-400 transition-colors"
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
