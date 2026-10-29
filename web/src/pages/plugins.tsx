import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpCircle,
  Blocks,
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderGit2,
  Layers,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { plugins, config } from "@/api/management";
import {
  errMessage,
  type PluginConfigField,
  type PluginInfo,
  type PluginStoreItem,
} from "@/api/types";
import { cn } from "@/lib/utils";

/**
 * Resolves an external link to GitHub or homepage for a plugin.
 */
function getPluginLink(p: {
  homepage?: string;
  repository?: string;
  github_repository?: string;
  metadata?: {
    homepage?: string;
    repository?: string;
    github_repository?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}): string | null {
  const url =
    p.homepage ||
    p.repository ||
    p.metadata?.homepage ||
    p.metadata?.repository ||
    p.metadata?.github_repository ||
    p.github_repository;

  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }
  return null;
}

/**
 * Squircle Icon component with fallback to a puzzle/block icon.
 */
function PluginIcon({
  logo,
  fallbackName,
  className,
}: {
  logo?: string;
  fallbackName: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (logo && !hasError) {
    return (
      <div
        className={cn(
          "size-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0 shadow-xs",
          className,
        )}
      >
        <img
          src={logo}
          alt={fallbackName}
          onError={() => setHasError(true)}
          className="size-7 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "size-10 rounded-xl bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-violet-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 shadow-xs",
        className,
      )}
    >
      <Blocks className="size-5" />
    </div>
  );
}

export function PluginsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"installed" | "store">("installed");
  const [searchInstalled, setSearchInstalled] = useState("");
  const [searchStore, setSearchStore] = useState("");
  const [storeFilter, setStoreFilter] = useState<"all" | "installed" | "uninstalled" | "updatable">(
    "all",
  );

  const [configTarget, setConfigTarget] = useState<PluginInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PluginInfo | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [manageSourcesOpen, setManageSourcesOpen] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["plugins"] });
    void queryClient.invalidateQueries({ queryKey: ["plugin-store"] });
  };

  // Plugin registration happens after the management response reloads the plugin
  // host, so refresh once immediately and again after the asynchronous load settles.
  const invalidateAfterPluginChange = () => {
    invalidate();
    window.setTimeout(invalidate, 1_500);
    window.setTimeout(invalidate, 4_000);
  };

  const installedQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: plugins.list,
    refetchInterval: 20_000,
  });

  const storeQuery = useQuery({
    queryKey: ["plugin-store"],
    queryFn: plugins.store,
    staleTime: 60_000,
  });

  const setEnabledMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      plugins.setEnabled(id, enabled),
    onSuccess: () => {
      toast.success(t("common.saved"));
      invalidateAfterPluginChange();
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => plugins.remove(id),
    onSuccess: () => {
      toast.success(t("plugins.deleted"));
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => {
      const message = errMessage(error);
      if (message.includes("restart")) {
        toast.warning(t("plugins.restartRequired"), { description: message });
      } else {
        toast.error(message);
      }
    },
  });

  const installMutation = useMutation({
    mutationFn: ({
      storeId,
      version,
      source,
    }: {
      storeId: string;
      version?: string;
      source?: string;
    }) => plugins.install(storeId, { version, source }),
    onSuccess: () => {
      toast.success(t("plugins.installed"));
      invalidateAfterPluginChange();
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  // Calculate statistics
  const installedList = installedQuery.data ?? [];
  const pluginsEnabled = installedQuery.data?.plugins_enabled ?? storeQuery.data?.plugins_enabled ?? true;
  const pluginsDir = installedQuery.data?.plugins_dir ?? storeQuery.data?.plugins_dir ?? "plugins";
  const effectiveCount = installedList.filter((p) => p.effective_enabled).length;

  const storeList = storeQuery.data?.plugins ?? [];
  const sourcesCount = storeQuery.data?.sources_count ?? 1;

  const installMissingPlugin = (plugin: PluginInfo) => {
    const item = storeList.find(
      (candidate) =>
        candidate.id === plugin.id ||
        candidate.store_id === plugin.id ||
        candidate.store_id?.endsWith(`/${plugin.id}`),
    );
    if (!item) {
      toast.error(t("plugins.storeItemMissing"));
      return;
    }
    installMutation.mutate({
      storeId: item.store_id || item.id || plugin.id,
      version: item.version || item.installed_version,
      source: item.source_id,
    });
  };

  // Filter installed plugins
  const filteredInstalled = useMemo(() => {
    const q = searchInstalled.trim().toLowerCase();
    if (!q) return installedList;
    return installedList.filter((p) => {
      const idMatch = p.id.toLowerCase().includes(q);
      const nameMatch = (p.metadata?.name as string | undefined)?.toLowerCase().includes(q);
      const authorMatch = (p.metadata?.author as string | undefined)?.toLowerCase().includes(q);
      const descMatch = (p.metadata?.description as string | undefined)?.toLowerCase().includes(q);
      const pathMatch = p.path?.toLowerCase().includes(q);
      const menusMatch = p.menus?.some((m) => m.menu.toLowerCase().includes(q));
      return idMatch || nameMatch || authorMatch || descMatch || pathMatch || menusMatch;
    });
  }, [installedList, searchInstalled]);

  // Counts for store tabs
  const storeCounts = useMemo(() => {
    let installed = 0;
    let uninstalled = 0;
    let updatable = 0;
    for (const item of storeList) {
      if (item.installed) {
        installed++;
        if (item.update_available) updatable++;
      } else {
        uninstalled++;
      }
    }
    return {
      all: storeList.length,
      installed,
      uninstalled,
      updatable,
    };
  }, [storeList]);

  // Filter store plugins
  const filteredStore = useMemo(() => {
    let list = storeList;
    if (storeFilter === "installed") {
      list = list.filter((item) => item.installed);
    } else if (storeFilter === "uninstalled") {
      list = list.filter((item) => !item.installed);
    } else if (storeFilter === "updatable") {
      list = list.filter((item) => item.installed && item.update_available);
    }

    const q = searchStore.trim().toLowerCase();
    if (!q) return list;

    return list.filter((item) => {
      const idMatch = (item.store_id || item.id || "").toLowerCase().includes(q);
      const nameMatch = (item.name || "").toLowerCase().includes(q);
      const authorMatch = (item.author || "").toLowerCase().includes(q);
      const descMatch = (item.description || "").toLowerCase().includes(q);
      const tagsMatch = item.tags?.some((tagItem) => tagItem.toLowerCase().includes(q));
      return idMatch || nameMatch || authorMatch || descMatch || tagsMatch;
    });
  }, [storeList, storeFilter, searchStore]);

  const handleRefreshAll = () => {
    void installedQuery.refetch();
    void storeQuery.refetch();
    toast.info(t("common.refreshed") || "已刷新");
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Tab Switcher Pills */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl w-fit border border-slate-200/60 dark:border-slate-700/60 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab("installed")}
            className={cn(
              "px-5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer",
              activeTab === "installed"
                ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200",
            )}
          >
            {t("plugins.installed")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("store")}
            className={cn(
              "px-5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer",
              activeTab === "store"
                ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200",
            )}
          >
            {t("plugins.store")}
          </button>
        </div>

        {/* Right: Status Indicators & Global Buttons */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Global Status badge */}
          <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2.5 py-1 rounded-lg">
            <span className="text-muted-foreground">{t("plugins.globalStatus") || "全局状态"}</span>
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[11px] font-medium border-0",
                pluginsEnabled
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {pluginsEnabled ? t("common.enabled") : t("common.disabled")}
            </Badge>
          </div>

          {activeTab === "installed" ? (
            <>
              <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2.5 py-1 rounded-lg">
                <span className="text-muted-foreground">{t("plugins.installed")}</span>
                <span className="font-semibold text-foreground">{installedList.length}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2.5 py-1 rounded-lg">
                <span className="text-muted-foreground">{t("plugins.effective") || "已生效"}</span>
                <span className="font-semibold text-foreground">{effectiveCount}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2.5 py-1 rounded-lg font-mono text-[11px]">
                <span className="text-muted-foreground">{t("plugins.pluginDir") || "插件目录"}</span>
                <span className="font-bold text-foreground">{pluginsDir}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2.5 py-1 rounded-lg font-mono text-[11px]">
                <span className="text-muted-foreground">{t("plugins.pluginDir") || "插件目录"}</span>
                <span className="font-bold text-foreground">{pluginsDir}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2.5 py-1 rounded-lg">
                <span className="text-muted-foreground">{t("plugins.availablePlugins") || "可用插件"}</span>
                <span className="font-semibold text-foreground">{storeList.length}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2.5 py-1 rounded-lg">
                <span className="text-muted-foreground">{t("plugins.sourcesCount") || "来源"}</span>
                <span className="font-semibold text-foreground">{sourcesCount}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setManageSourcesOpen(true)}
              >
                <SlidersHorizontal className="size-3" />
                <span>{t("plugins.manageSources") || "管理"}</span>
              </Button>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleRefreshAll}
          >
            <RefreshCw
              className={cn(
                "size-3",
                (installedQuery.isFetching || storeQuery.isFetching) && "animate-spin",
              )}
            />
            <span>{t("common.refresh")}</span>
          </Button>
        </div>
      </div>

      {/* Main Tab Content */}
      {activeTab === "installed" ? (
        <div className="space-y-4">
          {/* Search & Actions Bar */}
          <div className="flex items-center gap-3 bg-card border border-border/80 p-2 sm:p-2.5 rounded-2xl shadow-xs">
            <div className="relative flex-1">
              <Input
                type="text"
                placeholder={t("plugins.searchInstalledPlaceholder") || "搜索插件 ID、名称、作者或资源..."}
                value={searchInstalled}
                onChange={(e) => setSearchInstalled(e.target.value)}
                className="h-9 pr-9 pl-3 text-xs bg-muted/40 border-border/50 rounded-xl"
              />
              <Search className="size-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <Button
              size="sm"
              className="h-9 px-3.5 text-xs gap-1.5 rounded-xl shrink-0"
              onClick={() => setInstallDialogOpen(true)}
            >
              <Plus className="size-3.5" />
              <span>{t("plugins.installPlugin") || "安装插件"}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs gap-1.5 rounded-xl shrink-0"
              onClick={handleRefreshAll}
            >
              <RefreshCw className={cn("size-3.5", installedQuery.isFetching && "animate-spin")} />
              <span>{t("common.refresh")}</span>
            </Button>
          </div>

          {/* Installed Plugins Table */}
          <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-xs">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[28%] text-xs font-semibold py-3 pl-4">
                    {t("plugins.columnPlugin") || "插件"}
                  </TableHead>
                  <TableHead className="w-[12%] text-xs font-semibold py-3">
                    {t("plugins.columnStatus") || "状态"}
                  </TableHead>
                  <TableHead className="w-[30%] text-xs font-semibold py-3">
                    {t("plugins.columnCapabilities") || "能力"}
                  </TableHead>
                  <TableHead className="w-[18%] text-xs font-semibold py-3">
                    {t("plugins.columnPath") || "路径"}
                  </TableHead>
                  <TableHead className="w-[6%] text-xs font-semibold py-3 text-center">
                    {t("plugins.columnEnabled") || "启用"}
                  </TableHead>
                  <TableHead className="w-[6%] text-xs font-semibold py-3 pr-4 text-right">
                    {t("plugins.columnActions") || "操作"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInstalled.length > 0 ? (
                  filteredInstalled.map((plugin) => (
                    <InstalledPluginRow
                      key={plugin.id}
                      plugin={plugin}
                      pluginsEnabled={pluginsEnabled}
                      onToggleEnabled={(enabled) =>
                        setEnabledMutation.mutate({ id: plugin.id, enabled })
                      }
                      onInstallMissing={() => installMissingPlugin(plugin)}
                      installingMissing={installMutation.isPending}
                      onEditConfig={() => setConfigTarget(plugin)}
                      onDelete={() => setDeleteTarget(plugin)}
                    />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground text-xs">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Blocks className="size-8 text-muted-foreground/60" />
                        <p>{t("plugins.noneInstalled")}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="flex items-center gap-3 bg-card border border-border/80 p-2 sm:p-2.5 rounded-2xl shadow-xs">
            <div className="relative flex-1">
              <Input
                type="text"
                placeholder={t("plugins.searchStorePlaceholder") || "搜索插件 ID、名称、作者或标签..."}
                value={searchStore}
                onChange={(e) => setSearchStore(e.target.value)}
                className="h-9 pr-9 pl-3 text-xs bg-muted/40 border-border/50 rounded-xl"
              />
              <Search className="size-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3.5 text-xs gap-1.5 rounded-xl shrink-0"
              onClick={() => setManageSourcesOpen(true)}
            >
              <SlidersHorizontal className="size-3.5" />
              <span>{t("plugins.manageSources") || "管理"}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs gap-1.5 rounded-xl shrink-0"
              onClick={handleRefreshAll}
            >
              <RefreshCw className={cn("size-3.5", storeQuery.isFetching && "animate-spin")} />
              <span>{t("common.refresh")}</span>
            </Button>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setStoreFilter("all")}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 border cursor-pointer",
                storeFilter === "all"
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-card text-muted-foreground border-border/80 hover:bg-muted/50",
              )}
            >
              {t("plugins.filterAll") || "全部"} {storeCounts.all}
            </button>
            <button
              type="button"
              onClick={() => setStoreFilter("installed")}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 border cursor-pointer",
                storeFilter === "installed"
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-card text-muted-foreground border-border/80 hover:bg-muted/50",
              )}
            >
              {t("plugins.filterInstalled") || "已安装"} {storeCounts.installed}
            </button>
            <button
              type="button"
              onClick={() => setStoreFilter("uninstalled")}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 border cursor-pointer",
                storeFilter === "uninstalled"
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-card text-muted-foreground border-border/80 hover:bg-muted/50",
              )}
            >
              {t("plugins.filterUninstalled") || "未安装"} {storeCounts.uninstalled}
            </button>
            {storeCounts.updatable > 0 && (
              <button
                type="button"
                onClick={() => setStoreFilter("updatable")}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 border cursor-pointer",
                  storeFilter === "updatable"
                    ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
                )}
              >
                {t("plugins.filterUpdatable") || "可更新"} {storeCounts.updatable}
              </button>
            )}
          </div>

          {/* Store Grid Cards */}
          {filteredStore.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredStore.map((item) => (
                <StoreCard
                  key={item.store_id || item.id}
                  item={item}
                  onInstall={(version, source) =>
                    installMutation.mutate({
                      storeId: item.id || item.store_id || "",
                      version,
                      source: source || item.source_id,
                    })
                  }
                  installing={installMutation.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/80 bg-card/40 p-12 text-center text-muted-foreground text-xs">
              <Store className="size-8 text-muted-foreground/50 mx-auto mb-2" />
              <p>{t("plugins.storeEmpty")}</p>
            </div>
          )}
        </div>
      )}

      {/* Plugin Configuration Dialog */}
      {configTarget && (
        <PluginConfigDialog
          plugin={configTarget}
          onClose={() => setConfigTarget(null)}
          onSaved={() => invalidate()}
        />
      )}

      {/* Delete Confirmation Alert */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("plugins.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-xs">
              <span className="block font-mono font-bold text-foreground">
                {deleteTarget?.id}
              </span>
              <span>
                {t("plugins.deleteConfirm") ||
                  "确定要删除此插件吗？如果插件正在运行，可能需要重启服务。"}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && removeMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Install Plugin Dialog */}
      {installDialogOpen && (
        <InstallPluginDialog
          onClose={() => setInstallDialogOpen(false)}
          onNavigateStore={() => {
            setInstallDialogOpen(false);
            setActiveTab("store");
          }}
          onInstallDirect={(storeId, version) => {
            setInstallDialogOpen(false);
            installMutation.mutate({ storeId, version });
          }}
        />
      )}

      {/* Manage Sources Dialog */}
      {manageSourcesOpen && (
        <ManageSourcesDialog
          onClose={() => setManageSourcesOpen(false)}
          onSaved={() => invalidate()}
        />
      )}
    </div>
  );
}

// ============================================================================
// Installed Plugin Row Component (Matching Image 1)
// ============================================================================

function InstalledPluginRow({
  plugin,
  pluginsEnabled,
  onToggleEnabled,
  onInstallMissing,
  installingMissing,
  onEditConfig,
  onDelete,
}: {
  plugin: PluginInfo;
  pluginsEnabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onInstallMissing: () => void;
  installingMissing: boolean;
  onEditConfig: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const link = getPluginLink(plugin);
  const displayName = (plugin.metadata?.name as string | undefined)?.trim() || plugin.id;
  const version = (plugin.metadata?.version as string | undefined)?.trim();
  const author = (plugin.metadata?.author as string | undefined)?.trim();
  const description = (plugin.metadata?.description as string | undefined)?.trim() || "";
  const missingFile = plugin.configured && plugin.enabled && !plugin.path;
  const notLoaded = plugin.configured && plugin.enabled && !plugin.registered;

  const configFieldsCount =
    plugin.config_fields?.length ??
    (plugin.metadata?.config_fields as PluginConfigField[] | undefined)?.length ??
    0;

  return (
    <TableRow className="hover:bg-muted/40 transition-colors">
      {/* 1. 插件 (Plugin) */}
      <TableCell className="py-3 pl-4">
        <div className="flex items-center gap-3">
          <PluginIcon
            logo={plugin.logo || (plugin.metadata?.logo as string | undefined)}
            fallbackName={displayName}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-sm text-foreground hover:text-blue-600 dark:hover:text-blue-400 hover:underline flex items-center gap-1 group/link truncate"
                  title={displayName}
                >
                  <span className="truncate">{displayName}</span>
                  <ExternalLink className="size-3 opacity-0 group-hover/link:opacity-100 transition-opacity text-blue-500 shrink-0" />
                </a>
              ) : (
                <span className="font-bold text-sm text-foreground truncate" title={displayName}>
                  {displayName}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate font-mono">
              {[plugin.id, version ? `v${version}` : null, author].filter(Boolean).join(" / ")}
            </div>
          </div>
        </div>
      </TableCell>

      {/* 2. 状态 (Status) */}
      <TableCell className="py-3">
        <div className="space-y-1">
          {plugin.effective_enabled ? (
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-medium text-[11px] h-5 px-2"
            >
              {t("plugins.statusEffective") || "正在生效"}
            </Badge>
          ) : !plugin.enabled ? (
            <Badge
              variant="outline"
              className="text-muted-foreground bg-muted/40 font-normal text-[11px] h-5 px-2"
            >
              {t("plugins.statusDisabled") || "已停用"}
            </Badge>
          ) : !pluginsEnabled ? (
            <Badge
              variant="outline"
              className="text-muted-foreground bg-muted/40 font-normal text-[11px] h-5 px-2"
            >
              {t("plugins.statusNotEffective") || "未生效"}
            </Badge>
          ) : missingFile ? (
            <Badge
              variant="outline"
              className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-medium text-[11px] h-5 px-2"
            >
              {t("plugins.statusMissingFile") || "文件缺失"}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-muted-foreground bg-muted/40 font-normal text-[11px] h-5 px-2"
            >
              {t("plugins.statusNotLoaded") || "未加载"}
            </Badge>
          )}
          <div className="text-[11px] text-muted-foreground">
            {plugin.registered
              ? t("plugins.statusRegistered") || "已注册"
              : t("plugins.statusUnregistered") || "未注册"}{" "}
            /{" "}
            {plugin.configured
              ? t("plugins.statusConfigured") || "已配置"
              : t("plugins.statusUnconfigured") || "未配置"}
          </div>
        </div>
      </TableCell>

      {/* 3. 能力 (Capabilities) */}
      <TableCell className="py-3">
        <div className="space-y-1 max-w-[340px]">
          {/* Capability badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            {plugin.menus && plugin.menus.length > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] bg-blue-50/70 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900 px-1.5 py-0 h-4"
              >
                {t("plugins.menuCount", { count: plugin.menus.length }) ||
                  `${plugin.menus.length} 个菜单`}
              </Badge>
            )}
            {plugin.supports_oauth && (
              <Badge
                variant="outline"
                className="text-[10px] bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900 px-1.5 py-0 h-4"
              >
                OAuth
              </Badge>
            )}
            {plugin.supports_quota && (
              <Badge
                variant="outline"
                className="text-[10px] bg-amber-50/70 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900 px-1.5 py-0 h-4"
              >
                配额调度
              </Badge>
            )}
          </div>

          {/* Name & short description */}
          <div className="font-semibold text-xs text-foreground truncate">
            {(plugin.metadata?.name as string | undefined)?.trim() || plugin.id}
          </div>
          {description && (
            <div className="text-[11px] text-muted-foreground line-clamp-1 leading-snug">
              {description}
            </div>
          )}

          {/* Config fields count or no-menu note */}
          <div
            className={cn(
              "text-[10px] text-muted-foreground/80",
              missingFile && "text-amber-600 dark:text-amber-400",
            )}
          >
            {missingFile
              ? t("plugins.missingFileHint") || "插件文件不存在，请重新安装。"
              : notLoaded
                ? t("plugins.notLoadedHint") || "插件文件已存在但尚未注册，请稍后刷新或查看运行日志。"
                : configFieldsCount > 0
                  ? t("plugins.configFieldsCount", { count: configFieldsCount }) ||
                    `${configFieldsCount} 个配置字段`
                  : plugin.menus && plugin.menus.length > 0
                    ? null
                    : t("plugins.noMenuEntry") || "无菜单入口"}
          </div>
        </div>
      </TableCell>

      {/* 4. 路径 (Path) */}
      <TableCell className="py-3">
        <span
          className="font-mono text-[11px] text-muted-foreground break-all line-clamp-2"
          title={plugin.path}
        >
          {plugin.path || "—"}
        </span>
      </TableCell>

      {/* 5. 启用 (Enabled) */}
      <TableCell className="py-3 text-center">
        <Switch
          checked={plugin.enabled}
          onCheckedChange={onToggleEnabled}
          aria-label={displayName}
        />
      </TableCell>

      {/* 6. 操作 (Actions) */}
      <TableCell className="py-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {missingFile && pluginsEnabled && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 rounded-lg"
              onClick={onInstallMissing}
              disabled={installingMissing}
            >
              {installingMissing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              <span>{t("plugins.installMissing") || "安装文件"}</span>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 rounded-lg border-border/80 hover:bg-muted"
            onClick={onEditConfig}
          >
            <Settings2 className="size-3.5" />
            <span>{t("plugins.editConfig") || "编辑配置"}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 rounded-lg">
                <MoreVertical className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 text-xs rounded-xl">
              {plugin.menus && plugin.menus.length > 0 && (
                <>
                  {plugin.menus.map((menu, idx) => (
                    <DropdownMenuItem
                      key={idx}
                      className="cursor-pointer gap-2"
                      onClick={() =>
                        navigate(`/plugin-pages/${encodeURIComponent(plugin.id)}/${idx}`)
                      }
                    >
                      <Layers className="size-3.5 text-blue-500" />
                      <span className="truncate">{menu.menu || `页面 ${idx + 1}`}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}

              {link && (
                <DropdownMenuItem asChild>
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer gap-2 flex items-center"
                  >
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                    <span>查看主页/代码</span>
                  </a>
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" />
                <span>{t("plugins.deleteTitle") || "删除插件"}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Store Card Component (Matching Image 2)
// ============================================================================

function StoreCard({
  item,
  onInstall,
  installing,
}: {
  item: PluginStoreItem;
  onInstall: (version?: string, source?: string) => void;
  installing: boolean;
}) {
  const { t } = useTranslation();
  const link = getPluginLink(item);
  const displayName = item.name || item.store_id || item.id || "Plugin";
  const storeId = item.store_id || item.id || "";
  const isOfficial =
    item.source_id === "official" ||
    item.source_name?.toLowerCase().includes("official") ||
    item.source_name?.includes("官方");

  return (
    <div className="flex flex-col rounded-2xl border border-border/80 bg-card p-4 shadow-xs hover:shadow-md transition-all justify-between gap-3">
      {/* Top Header */}
      <div>
        <div className="flex items-start gap-3">
          <PluginIcon logo={item.logo} fallbackName={displayName} />
          <div className="min-w-0 flex-1">
            {/* Title with link */}
            <div className="flex items-center gap-1.5">
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-sm text-foreground hover:text-blue-600 dark:hover:text-blue-400 hover:underline flex items-center gap-1 group/link truncate"
                  title={displayName}
                >
                  <span className="truncate">{displayName}</span>
                  <ExternalLink className="size-3 opacity-0 group-hover/link:opacity-100 transition-opacity text-blue-500 shrink-0" />
                </a>
              ) : (
                <span className="font-bold text-sm text-foreground truncate" title={displayName}>
                  {displayName}
                </span>
              )}
            </div>

            {/* Subtitle storeId */}
            <div className="text-[11px] text-muted-foreground font-mono truncate">{storeId}</div>

            {/* Badges: Official/Third-party & Status */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {isOfficial ? (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-blue-50/80 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900 px-1.5 py-0 h-4"
                >
                  {t("plugins.official") || "官方"}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 px-1.5 py-0 h-4"
                >
                  {t("plugins.thirdParty") || "第三方"}
                </Badge>
              )}

              {item.installed ? (
                item.update_available ? (
                  <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-0 text-[10px] px-1.5 py-0 h-4 font-medium">
                    {t("plugins.updateAvailable") || "可更新"}
                  </Badge>
                ) : item.effective_enabled ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px] px-1.5 py-0 h-4 font-medium">
                    {t("plugins.statusEffective") || "生效中"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0 h-4">
                    {t("plugins.installed")}
                  </Badge>
                )
              ) : (
                <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0 h-4">
                  {t("plugins.filterUninstalled") || "未安装"}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed mt-3">
          {item.description || "—"}
        </p>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {item.tags.slice(0, 5).map((tag, i) => (
              <span
                key={i}
                className="inline-block text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-md"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 5 && (
              <span className="inline-block text-[10px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded-md">
                +{item.tags.length - 5}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Metadata & Button */}
      <div className="space-y-3 pt-2 border-t border-border/60">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <div className="flex items-center justify-between gap-2 truncate">
            <span className="truncate">
              {t("plugins.author") || "作者"} {item.author || "未知"}
            </span>
            <span className="shrink-0 text-muted-foreground/60">|</span>
            <span className="truncate shrink-0">
              {t("plugins.license") || "许可证"} {item.license || "未知"}
            </span>
          </div>
          <div className="truncate">
            <span className="text-muted-foreground/70">{t("plugins.source") || "来源"}: </span>
            <span className="font-medium text-foreground/80">
              {item.source_name || item.source_id || "CLIProxyAPI 源"}
            </span>
          </div>
        </div>

        {/* Action Button */}
        {item.installed ? (
          item.update_available ? (
            <Button
              size="sm"
              className="w-full h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
              disabled={installing}
              onClick={() => onInstall(item.version, item.source_id)}
            >
              <ArrowUpCircle className="size-3.5" />
              <span>{t("plugins.update") || "更新"}</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-8 text-xs gap-1.5 rounded-xl border-border/80"
              disabled={installing}
              onClick={() => onInstall(item.version, item.source_id)}
            >
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t("plugins.reinstall") || "重新安装"}</span>
            </Button>
          )
        ) : (
          <Button
            size="sm"
            className="w-full h-8 text-xs gap-1.5 rounded-xl shadow-xs"
            disabled={installing}
            onClick={() => onInstall(item.version, item.source_id)}
          >
            <Download className="size-3.5" />
            <span>{t("plugins.install") || "安装"}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Plugin Configuration Dialog (The Core Fix Requested by User!)
// ============================================================================

function PluginConfigDialog({
  plugin,
  onClose,
  onSaved,
}: {
  plugin: PluginInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ["plugin-config", plugin.id],
    queryFn: () => plugins.getConfig(plugin.id),
  });

  const [mode, setMode] = useState<"form" | "json">("form");
  const [formState, setFormState] = useState<Record<string, unknown> | null>(null);
  const [jsonText, setJsonText] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [maskedFields, setMaskedFields] = useState<Record<string, boolean>>({});

  // Sync loaded config to form and JSON state
  useEffect(() => {
    if (configQuery.data) {
      const initial = { ...configQuery.data };
      setFormState(initial);
      setJsonText(JSON.stringify(initial, null, 2));
      setJsonError(null);
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      await plugins.putConfig(plugin.id, payload);
    },
    onSuccess: () => {
      toast.success(t("common.saved"));
      void queryClient.invalidateQueries({ queryKey: ["plugin-config", plugin.id] });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  // Extract declared configuration fields
  const declaredFields: PluginConfigField[] = useMemo(() => {
    if (plugin.config_fields && plugin.config_fields.length > 0) {
      return plugin.config_fields;
    }
    const metaFields = plugin.metadata?.config_fields as PluginConfigField[] | undefined;
    if (metaFields && metaFields.length > 0) {
      return metaFields;
    }
    return [];
  }, [plugin]);

  // Set of names that are declared or reserved
  const reservedOrDeclaredNames = useMemo(() => {
    const s = new Set<string>(["enabled", "priority", "store"]);
    for (const f of declaredFields) {
      s.add(f.name);
    }
    return s;
  }, [declaredFields]);

  // Undeclared custom fields in the current config (excluding store!)
  const undeclaredKeys = useMemo(() => {
    if (!formState) return [];
    return Object.keys(formState).filter((k) => !reservedOrDeclaredNames.has(k));
  }, [formState, reservedOrDeclaredNames]);

  // Update a single form field
  const updateField = (name: string, value: unknown) => {
    setFormState((prev) => {
      const next = { ...(prev ?? {}) };
      if (value === undefined) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  // Switch between Form and Raw JSON mode
  const handleModeChange = (newMode: "form" | "json") => {
    if (newMode === "json") {
      if (formState) {
        setJsonText(JSON.stringify(formState, null, 2));
        setJsonError(null);
      }
    } else {
      try {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        setFormState(parsed);
        setJsonError(null);
      } catch {
        toast.error(t("plugins.jsonError") || "JSON 格式错误，请检查后再切换");
        return;
      }
    }
    setMode(newMode);
  };

  // Reset to plugin declared defaults
  const handleResetDefaults = () => {
    const next = { ...(formState ?? {}) };
    for (const field of declaredFields) {
      if (field.default !== undefined) {
        next[field.name] = field.default;
      }
    }
    setFormState(next);
    toast.info(t("plugins.resetDefaults") || "已重置为默认值");
  };

  // Save handler
  const handleSave = () => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        saveMutation.mutate(parsed);
      } catch {
        toast.error(t("plugins.jsonError") || "JSON 格式错误，请检查后再保存");
      }
    } else {
      if (!formState) return;
      saveMutation.mutate(formState);
    }
  };

  const displayName = (plugin.metadata?.name as string | undefined)?.trim() || plugin.id;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl border-border/80">
        {/* Fixed Header */}
        <div className="p-5 pb-4 border-b border-border/60 flex items-center justify-between shrink-0 bg-background/95 backdrop-blur z-10">
          <div className="flex items-center gap-3 min-w-0">
            <PluginIcon
              logo={plugin.logo || (plugin.metadata?.logo as string | undefined)}
              fallbackName={displayName}
              className="size-9"
            />
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold truncate">
                {displayName}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground font-mono truncate">
                {plugin.id} ·{" "}
                {declaredFields.length > 0
                  ? `${declaredFields.length} 个配置字段`
                  : "基础配置"}
              </DialogDescription>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <Tabs
            value={mode}
            onValueChange={(v) => handleModeChange(v as "form" | "json")}
            className="shrink-0"
          >
            <TabsList className="h-8 p-1 rounded-lg">
              <TabsTrigger value="form" className="text-xs px-3 rounded-md">
                {t("plugins.formMode") || "表单配置"}
              </TabsTrigger>
              <TabsTrigger value="json" className="text-xs px-3 rounded-md">
                {t("plugins.rawJsonMode") || "原始 JSON"}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Scrollable Body Container (max-height constrained, NEVER overflows!) */}
        <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-6">
          {configQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground text-xs">
              <Loader2 className="size-6 animate-spin text-blue-600" />
              <span>正在获取配置...</span>
            </div>
          ) : mode === "form" ? (
            <div className="space-y-6">
              {/* Section 1: Host Settings (Enabled & Priority) */}
              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-4 shadow-2xs">
                <div className="flex items-center gap-2 pb-2 border-b border-border/40">
                  <SlidersHorizontal className="size-4 text-blue-500" />
                  <h4 className="text-xs font-bold text-foreground">
                    {t("plugins.hostSettings") || "基础设置"}
                  </h4>
                </div>

                {/* Enabled Toggle */}
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-foreground">
                      {t("plugins.columnEnabled") || "启用插件"}
                    </label>
                    <p className="text-[11px] text-muted-foreground leading-normal">
                      是否加载并启用该插件实例。
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(formState?.enabled)}
                    onCheckedChange={(checked) => updateField("enabled", checked)}
                  />
                </div>

                {/* Priority input */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      启动优先级 (priority)
                    </label>
                    <span className="text-[11px] text-muted-foreground">数字越大越先加载</span>
                  </div>
                  <Input
                    type="number"
                    value={Number(formState?.priority ?? 0)}
                    onChange={(e) => updateField("priority", Number(e.target.value))}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Section 2: Plugin-Declared Fields */}
              {declaredFields.length > 0 && (
                <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between pb-2 border-b border-border/40">
                    <div className="flex items-center gap-2">
                      <Settings2 className="size-4 text-indigo-500" />
                      <h4 className="text-xs font-bold text-foreground">
                        {t("plugins.pluginSettings") || "插件专属配置"}
                      </h4>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {declaredFields.length} 项
                    </span>
                  </div>

                  <div className="space-y-4">
                    {declaredFields.map((field) => {
                      const val = formState?.[field.name];
                      return (
                        <div key={field.name} className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-xs font-semibold text-foreground font-mono">
                              {field.name}
                            </label>
                            {field.default !== undefined && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                默认: {String(field.default)}
                              </span>
                            )}
                          </div>

                          {field.description && (
                            <p className="text-[11px] text-muted-foreground leading-normal">
                              {field.description}
                            </p>
                          )}

                          {/* Control per type */}
                          {field.type === "boolean" ? (
                            <div className="pt-0.5">
                              <Switch
                                checked={Boolean(val ?? field.default ?? false)}
                                onCheckedChange={(checked) => updateField(field.name, checked)}
                              />
                            </div>
                          ) : field.type === "enum" ? (
                            <Select
                              value={String(val ?? field.default ?? "")}
                              onValueChange={(selected) => updateField(field.name, selected)}
                            >
                              <SelectTrigger className="h-8 text-xs font-mono bg-background">
                                <SelectValue placeholder="请选择..." />
                              </SelectTrigger>
                              <SelectContent className="text-xs">
                                {field.enum_values?.map((opt) => (
                                  <SelectItem key={opt} value={opt} className="text-xs font-mono">
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : field.type === "number" || field.type === "integer" ? (
                            <Input
                              type="number"
                              value={val !== undefined ? Number(val) : (field.default !== undefined ? Number(field.default) : "")}
                              onChange={(e) =>
                                updateField(
                                  field.name,
                                  e.target.value === "" ? 0 : Number(e.target.value),
                                )
                              }
                              className="h-8 text-xs font-mono bg-background"
                            />
                          ) : field.type === "array" ? (
                            <Textarea
                              placeholder="每行一个条目"
                              value={Array.isArray(val) ? val.join("\n") : String(val ?? "")}
                              onChange={(e) => {
                                const lines = e.target.value
                                  .split("\n")
                                  .map((s) => s.trim())
                                  .filter(Boolean);
                                updateField(field.name, lines);
                              }}
                              className="min-h-16 text-xs font-mono bg-background"
                            />
                          ) : (
                            // Default: string
                            <div className="relative">
                              <Input
                                type={
                                  maskedFields[field.name] ||
                                  field.name.toLowerCase().includes("key") ||
                                  field.name.toLowerCase().includes("token") ||
                                  field.name.toLowerCase().includes("secret")
                                    ? maskedFields[field.name] === false
                                      ? "text"
                                      : "password"
                                    : "text"
                                }
                                value={String(val ?? field.default ?? "")}
                                onChange={(e) => updateField(field.name, e.target.value)}
                                className="h-8 text-xs bg-background pr-8 font-mono"
                              />
                              {(field.name.toLowerCase().includes("key") ||
                                field.name.toLowerCase().includes("token") ||
                                field.name.toLowerCase().includes("secret")) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMaskedFields((prev) => ({
                                      ...prev,
                                      [field.name]: prev[field.name] === false ? true : false,
                                    }))
                                  }
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                  {maskedFields[field.name] === false ? (
                                    <EyeOff className="size-3.5" />
                                  ) : (
                                    <Eye className="size-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section 3: Other Custom Config Keys (if any exist) */}
              {undeclaredKeys.length > 0 && (
                <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between pb-2 border-b border-border/40">
                    <div className="flex items-center gap-2">
                      <FolderGit2 className="size-4 text-emerald-500" />
                      <h4 className="text-xs font-bold text-foreground">
                        {t("plugins.otherSettings") || "其他自定义选项"}
                      </h4>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {undeclaredKeys.length} 项
                    </span>
                  </div>

                  <div className="space-y-3">
                    {undeclaredKeys.map((key) => {
                      const val = formState?.[key];
                      const valType = typeof val;

                      return (
                        <div
                          key={key}
                          className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-background border border-border/50"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <span className="text-xs font-mono font-semibold text-foreground truncate block">
                              {key}
                            </span>

                            {valType === "boolean" ? (
                              <Switch
                                checked={Boolean(val)}
                                onCheckedChange={(checked) => updateField(key, checked)}
                              />
                            ) : valType === "number" ? (
                              <Input
                                type="number"
                                value={Number(val)}
                                onChange={(e) => updateField(key, Number(e.target.value))}
                                className="h-7 text-xs font-mono"
                              />
                            ) : Array.isArray(val) ? (
                              <Textarea
                                value={val.join("\n")}
                                onChange={(e) =>
                                  updateField(
                                    key,
                                    e.target.value
                                      .split("\n")
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  )
                                }
                                className="min-h-14 text-xs font-mono"
                              />
                            ) : (
                              <Input
                                type="text"
                                value={String(val ?? "")}
                                onChange={(e) => updateField(key, e.target.value)}
                                className="h-7 text-xs font-mono"
                              />
                            )}
                          </div>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                            onClick={() => updateField(key, undefined)}
                            title="删除此字段"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Notice if no fields at all */}
              {declaredFields.length === 0 && undeclaredKeys.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                  <p>
                    该插件未声明额外的专属配置项。你可以使用上方的基础设置控制启用与优先级，或切换到“原始 JSON”进行高级配置。
                  </p>
                </div>
              )}
            </div>
          ) : (
            // Raw JSON Mode
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>可以直接编辑插件的原始 JSON 配置树（保存时将完整应用）：</span>
                {jsonError && <span className="text-destructive font-medium">{jsonError}</span>}
              </div>

              <Textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  try {
                    JSON.parse(e.target.value);
                    setJsonError(null);
                  } catch (err) {
                    setJsonError((err as Error).message);
                  }
                }}
                className="min-h-[360px] max-h-[460px] font-mono text-xs bg-slate-950 text-slate-100 p-4 rounded-xl leading-relaxed border-slate-800"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="p-4 px-6 border-t border-border/60 bg-muted/20 flex items-center justify-between shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetDefaults}
            className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
            disabled={declaredFields.length === 0 || mode === "json"}
          >
            <RotateCcw className="size-3" />
            <span>{t("plugins.resetDefaults") || "重置为默认值"}</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending || (mode === "json" && Boolean(jsonError))}
              className="text-xs gap-1.5"
            >
              {saveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              <span>{t("plugins.saveConfig") || "保存配置"}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Install Plugin Dialog (`+ 安装插件`)
// ============================================================================

function InstallPluginDialog({
  onClose,
  onNavigateStore,
  onInstallDirect,
}: {
  onClose: () => void;
  onNavigateStore: () => void;
  onInstallDirect: (storeId: string, version?: string) => void;
}) {
  const [storeId, setStoreId] = useState("");
  const [version, setVersion] = useState("");

  const handleInstall = () => {
    const trimmed = storeId.trim();
    if (!trimmed) {
      toast.error("请输入插件 ID 或仓库名称");
      return;
    }
    onInstallDirect(trimmed, version.trim() || undefined);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl shadow-xl border-border/80">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">安装插件</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            浏览插件商店一键安装，或直接输入 Store ID 进行下载安装。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Option 1: Go to Store */}
          <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-50/50 dark:bg-blue-950/20 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-foreground">从插件商店挑选安装</span>
              <p className="text-[11px] text-muted-foreground">
                官方源包含多款社区精选插件，支持一键安装与更新。
              </p>
            </div>
            <Button size="sm" onClick={onNavigateStore} className="text-xs shrink-0 gap-1.5">
              <Store className="size-3.5" />
              <span>打开商店</span>
            </Button>
          </div>

          {/* Option 2: Direct Install */}
          <div className="space-y-3 pt-2">
            <span className="text-xs font-semibold text-foreground">通过 Store ID / 插件名称安装</span>
            <div className="space-y-2">
              <Input
                placeholder="例如: clinepassbridge 或 deepseek-search"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="h-8 text-xs font-mono"
              />
              <Input
                placeholder="指定版本 (可选，如 v0.3.6，留空自动安装最新版本)"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          {/* Option 3: Local Manual Hint */}
          <div className="p-3 rounded-lg bg-muted/40 border border-border/50 text-[11px] text-muted-foreground space-y-1">
            <span className="font-semibold text-foreground block">手动放置编译好的 .so 插件：</span>
            <p>
              将编译好的共享库放置在系统对应的架构目录（例如 <code className="font-mono text-foreground font-bold">plugins/linux/amd64/your-plugin.so</code>），随后点击页面右上角“刷新”即可自动注册与加载。
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            取消
          </Button>
          <Button size="sm" onClick={handleInstall} className="text-xs gap-1.5">
            <Download className="size-3.5" />
            <span>立即安装</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Manage Sources Dialog (`⚙ 管理`)
// ============================================================================

function ManageSourcesDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [etag, setEtag] = useState("");

  // Load current sources from config
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const { config: doc, etag: docEtag } = await config.get<{
          plugins?: { "store-sources"?: string[] };
        }>();
        if (mounted) {
          setEtag(docEtag);
          if (Array.isArray(doc.plugins?.["store-sources"])) {
            setSources(doc.plugins["store-sources"]);
          }
        }
      } catch {
        // Safe fallback
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleAdd = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("请输入有效的 HTTP/HTTPS URL");
      return;
    }
    if (sources.includes(trimmed)) {
      toast.warning("该来源已存在");
      return;
    }
    setSources([...sources, trimmed]);
    setNewUrl("");
  };

  const handleRemove = (index: number) => {
    setSources(sources.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      await config.patchPath("plugins", { "store-sources": sources }, etag);
      toast.success(t("common.saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg rounded-2xl shadow-xl border-border/80">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">插件商店来源管理</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            配置额外的社区插件源（registry.json），扩展可浏览与安装的插件生态。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Official Registry (Always included) */}
          <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">CLIProxyAPI 官方源</span>
              <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-0 text-[10px]">
                官方内置
              </Badge>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground break-all">
              https://raw.githubusercontent.com/router-for-me/CLIProxyAPI-Plugins-Store/main/registry.json
            </p>
          </div>

          {/* Custom Registries */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-foreground">自定义订阅源列表</span>
            {loading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">加载中...</div>
            ) : sources.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {sources.map((url, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border/50 text-xs"
                  >
                    <span className="font-mono text-[11px] truncate flex-1" title={url}>
                      {url}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemove(idx)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-dashed border-border/70 text-center text-xs text-muted-foreground">
                暂未添加自定义源
              </div>
            )}
          </div>

          {/* Add New Source */}
          <div className="space-y-1.5 pt-2 border-t border-border/40">
            <label className="text-xs font-semibold text-foreground">添加新订阅源</label>
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com/.../registry.json"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="h-8 text-xs font-mono"
              />
              <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={handleAdd}>
                添加
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            取消
          </Button>
          <Button size="sm" onClick={handleSave} className="text-xs">
            保存更改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
