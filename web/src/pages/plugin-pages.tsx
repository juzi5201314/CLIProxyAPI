import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  Layers,
  Loader2,
  Puzzle,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { plugins } from "@/api/management";
import { cn } from "@/lib/utils";

export interface PluginResourceItem {
  key: string;
  pluginId: string;
  menuIndex: number;
  label: string;
  description: string;
  logo?: string;
  path: string;
  url: string;
}

export function PluginPages() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ pluginId?: string; menuIndex?: string }>();
  const [copied, setCopied] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: plugins.list,
    staleTime: 30_000,
  });

  // Extract all available resource pages from registered and enabled plugins
  const resources = useMemo<PluginResourceItem[]>(() => {
    if (!pluginsQuery.data) return [];
    const list: PluginResourceItem[] = [];

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

        const description =
          (menu.description || "").trim() ||
          (p.metadata?.description as string | undefined)?.trim() ||
          "";

        let url = rawPath;
        if (!/^https?:\/\//i.test(url)) {
          const origin = window.location.origin;
          url = `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
        }

        list.push({
          key: `${p.id}:${index}`,
          pluginId: p.id,
          menuIndex: index,
          label,
          description,
          logo: p.logo || (p.metadata?.logo as string | undefined),
          path: rawPath,
          url,
        });
      });
    }

    return list;
  }, [pluginsQuery.data]);

  // Hold the loading state briefly so it can fade out before the empty card fades in.
  const [loadingExited, setLoadingExited] = useState(!pluginsQuery.isLoading);
  const loadingFadingOut = !pluginsQuery.isLoading && resources.length === 0 && !loadingExited;

  useEffect(() => {
    if (pluginsQuery.isLoading) {
      setLoadingExited(false);
      return;
    }
    if (resources.length > 0) {
      setLoadingExited(true);
      return;
    }
    if (loadingExited) return;
    const timer = window.setTimeout(() => setLoadingExited(true), 200);
    return () => window.clearTimeout(timer);
  }, [pluginsQuery.isLoading, resources.length, loadingExited]);

  // Determine active item based on URL params or default to first
  const activeResource = useMemo(() => {
    if (resources.length === 0) return null;
    if (params.pluginId) {
      const targetIndex = params.menuIndex ? parseInt(params.menuIndex, 10) : 0;
      const found = resources.find(
        (r) => r.pluginId === params.pluginId && r.menuIndex === targetIndex,
      );
      if (found) return found;
    }
    return resources[0] ?? null;
  }, [resources, params.pluginId, params.menuIndex]);

  // Reset iframe loading when active URL or reload key changes
  useEffect(() => {
    if (activeResource) {
      setIframeLoading(true);
    }
  }, [activeResource?.url, reloadKey]);

  // Sync theme to iframe if same origin
  const handleIframeLoad = () => {
    setIframeLoading(false);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const isDark = document.documentElement.classList.contains("dark");
        doc.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
        if (isDark) {
          doc.documentElement.classList.add("dark");
        } else {
          doc.documentElement.classList.remove("dark");
        }
      }
    } catch {
      // Cross-origin access might fail; safe to ignore
    }
  };

  const handleCopyUrl = async () => {
    if (!activeResource?.url) return;
    try {
      await navigator.clipboard.writeText(activeResource.url);
      setCopied(true);
      toast.success(t("pluginPages.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleReload = () => {
    setIframeLoading(true);
    setReloadKey((prev) => prev + 1);
  };

  const handleOpenExternal = () => {
    if (!activeResource?.url) return;
    window.open(activeResource.url, "_blank", "noopener,noreferrer");
  };

  // Loading state (kept mounted through the fade-out)
  if (!loadingExited) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center min-h-[500px] gap-3 text-slate-500 dark:text-slate-400 transition-opacity duration-200",
          loadingFadingOut && "opacity-0",
        )}
      >
        <Loader2 className="size-8 animate-spin text-blue-600 dark:text-blue-400" />
        <p className="text-sm font-medium">{t("pluginPages.loading")}</p>
      </div>
    );
  }

  // If no plugins have resource pages
  if (resources.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="animate-in fade-in duration-200 flex w-full max-w-lg flex-col items-center justify-center min-h-[400px] text-center p-8 rounded-3xl border border-slate-200/80 bg-white/70 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/60 shadow-xl shadow-slate-200/40 dark:shadow-none">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 mb-5 shadow-inner">
            <Puzzle className="size-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
            {t("pluginPages.noPlugins")}
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
            {t("pluginPages.noPluginsDesc")}
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              onClick={() => navigate("/plugins")}
              className="rounded-xl px-5 gap-2 shadow-md shadow-blue-500/20"
            >
              <Boxes className="size-4" />
              <span>{t("pluginPages.goToPlugins")}</span>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("pluginPages.helpLabel")}
                  className="rounded-full border-slate-200/80 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <CircleHelp className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 text-center leading-relaxed">
                {t("pluginPages.noPluginsDetail")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] -m-4 sm:-m-6 md:-m-8">
      {/* Top Header Bar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-2.5 bg-white/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800/80 backdrop-blur-md z-10 select-none">
        {/* Left: Plugin Switcher Tabs or Title */}
        <div className="flex items-center gap-2 overflow-x-auto max-w-full py-0.5">
          {resources.map((item) => {
            const isActive =
              activeResource?.pluginId === item.pluginId &&
              activeResource?.menuIndex === item.menuIndex;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() =>
                  navigate(
                    `/plugin-pages/${encodeURIComponent(item.pluginId)}/${item.menuIndex}`,
                  )
                }
                className={cn(
                  "group flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer shrink-0 border",
                  isActive
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/30"
                    : "bg-slate-100/80 hover:bg-slate-200/80 text-slate-700 border-slate-200/60 dark:bg-slate-800/60 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-slate-700/60",
                )}
              >
                {item.logo ? (
                  <img
                    src={item.logo}
                    alt=""
                    className="size-4 rounded object-contain shrink-0"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                ) : (
                  <Layers className={cn("size-3.5 shrink-0", isActive ? "text-white" : "text-blue-500 dark:text-blue-400")} />
                )}
                <span className="truncate max-w-[160px] sm:max-w-[200px]">{item.label}</span>
                {isActive && (
                  <span className="inline-block size-1.5 rounded-full bg-white ml-0.5" />
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {activeResource && (
            <Badge
              variant="outline"
              className="hidden lg:inline-flex items-center gap-1.5 font-mono text-[11px] bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-slate-200 dark:border-slate-700 px-2.5 py-0.5"
            >
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>{activeResource.pluginId}</span>
            </Badge>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleReload}
                className="size-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
              >
                <RotateCcw className={cn("size-3.5", iframeLoading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t("pluginPages.reload")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopyUrl}
                className="size-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t("pluginPages.copyUrl")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleOpenExternal}
                className="size-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t("pluginPages.openExternal")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/plugins")}
                className="size-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
              >
                <Settings2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t("plugins.subtitle")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main Iframe Display Container */}
      <div className="relative flex-1 w-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
        {iframeLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs transition-opacity">
            <Loader2 className="size-7 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t("pluginPages.loading")}
            </span>
          </div>
        )}

        {activeResource ? (
          <iframe
            key={`${activeResource.key}:${reloadKey}`}
            ref={iframeRef}
            src={activeResource.url}
            title={activeResource.label}
            className="w-full h-full border-0 bg-transparent block"
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write; fullscreen"
            onLoad={handleIframeLoad}
          />
        ) : null}
      </div>
    </div>
  );
}
