import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Info,
  KeyRound,
  Loader2,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList, JsonView, SectionCard } from "@/components/shared/misc";
import { credentials, quota } from "@/api/management";
import { errMessage, type AuthFileEntry } from "@/api/types";
import { dayjs, formatBytes, formatInt, fromNow } from "@/lib/format";
import {
  getCachedQuota,
  saveCachedQuota,
  syncCachedQuotasFromEntries,
  resolveCredentialQuota,
  type ResolvedQuota,
} from "@/lib/quota-store";
import { getCachedModels, saveCachedModels } from "@/lib/models-cache";

function formatModTime(raw: string | number | undefined | null): string {
  if (!raw) return "—";
  const d = typeof raw === "number" ? (raw < 1e11 ? dayjs.unix(raw) : dayjs(raw)) : dayjs(raw);
  if (!d.isValid()) return String(raw);
  return d.format("YYYY/MM/DD HH:mm:ss");
}

function getProviderTheme(provider?: string) {
  const p = (provider || "").toLowerCase();
  if (p.includes("codex")) {
    return "border-indigo-200/90 bg-indigo-50/70 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300";
  }
  if (p.includes("claude")) {
    return "border-purple-200/90 bg-purple-50/70 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-300";
  }
  if (p.includes("gemini")) {
    return "border-cyan-200/90 bg-cyan-50/70 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300";
  }
  if (p.includes("openai")) {
    return "border-emerald-200/90 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (p.includes("antigravity")) {
    return "border-sky-200/90 bg-sky-50/70 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300";
  }
  if (p.includes("freetier") || p.includes("cline-pass") || p.includes("clinepass")) {
    return "border-amber-200/90 bg-amber-50/70 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (p.includes("xai")) {
    return "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300";
  }
  if (p.includes("devin")) {
    return "border-violet-200/90 bg-violet-50/70 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300";
  }
  return "border-blue-200/90 bg-blue-50/70 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300";
}

function formatProviderLabel(provider?: string): string {
  if (!provider) return "Unknown";
  const p = provider.toLowerCase();
  if (p === "codex") return "Codex";
  if (p === "claude") return "Claude";
  if (p === "gemini") return "Gemini";
  if (p === "openai") return "OpenAI";
  if (p === "antigravity") return "Antigravity";
  if (p === "devin") return "Devin";
  if (p === "xai") return "xAI";
  if (p.includes("freetier")) return "FreeTier";
  if (p.includes("cline-pass") || p.includes("clinepass")) return "ClinePass";
  if (p.includes("qoder")) return "Qoder";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}


export function AuthFilesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["auth-files"] });
  const files = useQuery({ queryKey: ["auth-files"], queryFn: () => credentials.list(), refetchInterval: 20_000 });

  // Filter & Search states
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [sortOption, setSortOption] = useState<string>("default");
  const [pageSizeOption, setPageSizeOption] = useState<string>("30");
  const [search, setSearch] = useState("");

  // Display option switches
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [onlyDisabled, setOnlyDisabled] = useState(false);
  const [onlyNormal, setOnlyNormal] = useState(false);
  const [compactMode, setCompactMode] = useState(false);

  // Card & Batch selections
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<AuthFileEntry | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AuthFileEntry | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Quota update tick for reactive re-render when quotas are updated
  const [quotaTick, setQuotaTick] = useState(0);

  useEffect(() => {
    if (files.data?.files) {
      syncCachedQuotasFromEntries(files.data.files);
    }
  }, [files.data?.files]);

  useEffect(() => {
    const handleUpdated = () => setQuotaTick((v) => v + 1);
    window.addEventListener("cpa-quota-updated", handleUpdated);
    window.addEventListener("storage", handleUpdated);
    return () => {
      window.removeEventListener("cpa-quota-updated", handleUpdated);
      window.removeEventListener("storage", handleUpdated);
    };
  }, []);

  // Track per-card quota fetching status
  const [fetchingQuotaIds, setFetchingQuotaIds] = useState<Set<string>>(new Set());

  const entries = files.data?.files ?? [];

  const providerNames = useMemo(() => {
    const names = new Set<string>();
    for (const entry of entries) if (entry.provider) names.add(entry.provider);
    return ["all", ...[...names].sort()];
  }, [entries]);

  // Overall statistics
  const totalFiles = entries.length;
  const activeFiles = entries.filter((e) => !e.disabled && !e.unavailable).length;
  const disabledFiles = totalFiles - activeFiles;
  const totalSuccess = entries.reduce((sum, e) => sum + (e.success ?? 0), 0);
  const totalFailed = entries.reduce((sum, e) => sum + (e.failed ?? 0), 0);

  // Mutation to toggle enable / disable
  const setStatus = useMutation({
    mutationFn: ({ entry, disabled }: { entry: AuthFileEntry; disabled: boolean }) =>
      credentials.setStatus(entry.name, disabled, entry.auth_index),
    onSuccess: (_data, variables) => {
      toast.success(variables.disabled ? t("common.disabled") : t("common.enabled"));
      void invalidate();
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  // Manual Upstream Quota Fetch (Strictly manual user trigger)
  const handleFetchQuota = async (entry: AuthFileEntry) => {
    const key = entry.auth_index || entry.id || entry.name;
    setFetchingQuotaIds((prev) => new Set(prev).add(key));
    try {
      const data = await quota.fetch({
        auth_index: String(key),
        plugin_id: typeof entry.quota_plugin_id === "string" ? entry.quota_plugin_id : undefined,
        provider: entry.quota_provider || entry.provider,
      });
      saveCachedQuota([entry.auth_index, entry.id, entry.name], data, entry.success, entry.failed);
      void invalidate();
      toast.success(t("authFiles.quotaFetched"));
    } catch (error) {
      toast.error(`${t("authFiles.quotaFetchFailed")}: ${errMessage(error)}`);
    } finally {
      setFetchingQuotaIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Batch Fetch Quota for selected items
  const handleBatchFetchQuota = async () => {
    if (selectedIds.size === 0) return;
    const targetEntries = entries.filter((e) => selectedIds.has(e.id || e.name));
    setBatchBusy(true);
    let ok = 0;
    let fail = 0;
    for (const entry of targetEntries) {
      const key = entry.auth_index || entry.id || entry.name;
      try {
        const data = await quota.fetch({
          auth_index: String(key),
          plugin_id: typeof entry.quota_plugin_id === "string" ? entry.quota_plugin_id : undefined,
          provider: entry.quota_provider || entry.provider,
        });
        saveCachedQuota([entry.auth_index, entry.id, entry.name], data, entry.success, entry.failed);
        ok++;
      } catch {
        fail++;
      }
    }
    void invalidate();
    setBatchBusy(false);
    toast.success(`${t("authFiles.quotaFetched")}: ${ok} 成功, ${fail} 失败`);
  };

  // Batch Enable / Disable
  const handleBatchSetStatus = async (disabled: boolean) => {
    if (selectedIds.size === 0) return;
    const targetEntries = entries.filter((e) => selectedIds.has(e.id || e.name));
    setBatchBusy(true);
    try {
      await Promise.all(
        targetEntries.map((entry) => credentials.setStatus(entry.name, disabled, entry.auth_index))
      );
      toast.success(disabled ? t("common.disabled") : t("common.enabled"));
      void invalidate();
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setBatchBusy(false);
    }
  };

  // Batch Delete
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const targetNames = entries
      .filter((e) => selectedIds.has(e.id || e.name))
      .map((e) => e.name);
    setBatchBusy(true);
    try {
      await credentials.remove(targetNames);
      toast.success(t("authFiles.deleted"));
      setSelectedIds(new Set());
      setBatchDeleteOpen(false);
      void invalidate();
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setBatchBusy(false);
    }
  };

  const refreshAll = async () => {
    setBatchBusy(true);
    try {
      await credentials.refresh({ all: true });
      toast.success(t("authFiles.refreshed"));
      void invalidate();
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setBatchBusy(false);
    }
  };

  const remove = useMutation({
    mutationFn: (entry: AuthFileEntry) => credentials.remove([entry.name]),
    onSuccess: () => {
      toast.success(t("authFiles.deleted"));
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  const upload = useMutation({
    mutationFn: (uploadedFiles: FileList) => credentials.upload(Array.from(uploadedFiles)),
    onSuccess: (result) => {
      if (result.status === "partial" && result.failed?.length) {
        toast.warning(t("authFiles.uploadPartial"), {
          description: result.failed.map((f) => `${f.name}: ${f.error}`).join("\n").slice(0, 200),
        });
      } else {
        toast.success(t("authFiles.uploaded", { count: result.uploaded ?? 0 }));
      }
      setUploadOpen(false);
      void invalidate();
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  // Filter and sort items
  const filteredAndSorted = useMemo(() => {
    let list = entries;

    // Provider filter
    if (providerFilter !== "all") {
      list = list.filter((e) => (e.provider || "").toLowerCase() === providerFilter.toLowerCase());
    }

    // Status filter dropdown
    if (statusFilter === "normal") {
      list = list.filter((e) => !e.disabled && !e.unavailable && e.status !== "error");
    } else if (statusFilter === "disabled") {
      list = list.filter((e) => e.disabled);
    } else if (statusFilter === "cooldown") {
      list = list.filter((e) => e.status === "cooldown" || e.status === "rate-limited");
    } else if (statusFilter === "error") {
      list = list.filter((e) => e.unavailable || e.status === "error" || e.status === "unavailable");
    }

    // Plan filter dropdown
    if (planFilter !== "all") {
      list = list.filter((e) => {
        const q = resolveCredentialQuota(e, getCachedQuota(e));
        return q.plan.toLowerCase() === planFilter.toLowerCase();
      });
    }

    // Display option switches
    if (onlyProblems) {
      list = list.filter((e) => (e.failed ?? 0) > 0 || e.unavailable || e.status === "error");
    }
    if (onlyDisabled) {
      list = list.filter((e) => e.disabled);
    }
    if (onlyNormal) {
      list = list.filter((e) => !e.disabled && !e.unavailable && e.status !== "error");
    }

    // Advanced search with wildcard support
    const term = search.trim().toLowerCase();
    if (term) {
      const regexPattern = term
        .split("*")
        .map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
        .join(".*");
      const regex = new RegExp(regexPattern, "i");

      list = list.filter((e) => {
        const q = resolveCredentialQuota(e, getCachedQuota(e));
        return (
          regex.test(e.name) ||
          regex.test(e.provider ?? "") ||
          regex.test(e.label ?? "") ||
          regex.test(e.email ?? "") ||
          regex.test(e.account_type ?? "") ||
          regex.test(q.plan) ||
          regex.test(e.status_message ?? "") ||
          regex.test(e.status ?? "")
        );
      });
    }

    // Sorting
    const sorted = [...list];
    if (sortOption === "modtime") {
      sorted.sort((a, b) => {
        const tA = dayjs(a.modtime || a.updated_at || a.created_at || 0).valueOf();
        const tB = dayjs(b.modtime || b.updated_at || b.created_at || 0).valueOf();
        return tB - tA;
      });
    } else if (sortOption === "priority") {
      sorted.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    } else if (sortOption === "quota") {
      sorted.sort((a, b) => {
        const qA = resolveCredentialQuota(a, getCachedQuota(a)).remainingPct;
        const qB = resolveCredentialQuota(b, getCachedQuota(b)).remainingPct;
        const valA = qA !== null ? qA : -1;
        const valB = qB !== null ? qB : -1;
        return valB - valA;
      });
    } else if (sortOption === "success") {
      sorted.sort((a, b) => (b.success ?? 0) - (a.success ?? 0));
    } else if (sortOption === "failed") {
      sorted.sort((a, b) => (b.failed ?? 0) - (a.failed ?? 0));
    } else if (sortOption === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sorted;
  }, [
    entries,
    providerFilter,
    statusFilter,
    planFilter,
    onlyProblems,
    onlyDisabled,
    onlyNormal,
    search,
    sortOption,
    quotaTick,
  ]);

  // Pagination slice
  const pageSize = pageSizeOption === "all" ? filteredAndSorted.length : parseInt(pageSizeOption, 10) || 30;
  const visible = useMemo(() => filteredAndSorted.slice(0, pageSize), [filteredAndSorted, pageSize]);

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selectedIds.has(e.id || e.name));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set(selectedIds);
      visible.forEach((e) => next.add(e.id || e.name));
      setSelectedIds(next);
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <PageHeader title={t("nav.authFiles")} subtitle={t("authFiles.subtitle")}>
        <Button variant="outline" size="sm" className="h-8 text-xs font-medium" onClick={() => setUploadOpen(true)}>
          <Upload className="size-3.5" />
          {t("common.upload")}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs font-medium" onClick={refreshAll} disabled={batchBusy}>
          {batchBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t("authFiles.refreshAll")}
        </Button>
        <Button variant="outline" size="sm" className="text-destructive h-8 text-xs font-medium" onClick={() => setDeleteAllOpen(true)}>
          <Trash2 className="size-3.5" />
          {t("common.deleteAll")}
        </Button>
      </PageHeader>

      {/* Top Overview KPI Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        <div className="card-surface p-4 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t("authFiles.stats.totalFiles")}</p>
            <p className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">{totalFiles}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("authFiles.stats.activeBreakdown", { active: activeFiles, disabled: disabledFiles })}</p>
          </div>
          <div className="size-11 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <KeyRound className="size-5" />
          </div>
        </div>

        <div className="card-surface p-4 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t("authFiles.stats.quotaSupport")}</p>
            <p className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
              {entries.filter((e) => e.supports_quota).length}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("authFiles.stats.quotaSubtitle")}</p>
          </div>
          <div className="size-11 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <ShieldCheck className="size-5" />
          </div>
        </div>

        <div className="card-surface p-4 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t("authFiles.stats.totalSuccess")}</p>
            <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
              {formatInt(totalSuccess)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("authFiles.stats.successSubtitle")}</p>
          </div>
          <div className="size-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CheckCircle2 className="size-5" />
          </div>
        </div>

        <div className="card-surface p-4 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t("authFiles.stats.totalFailed")}</p>
            <p className="text-2xl font-bold font-mono text-rose-500 mt-1">
              {formatInt(totalFailed)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("authFiles.stats.failedSubtitle")}</p>
          </div>
          <div className="size-11 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <Activity className="size-5" />
          </div>
        </div>
      </div>

      {/* CPAMP Filter & Control Bar */}
      <div className="card-surface p-4 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs mb-5 space-y-3">
        {/* Row 1: Search + Selects */}
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-3">
          <div className="relative flex-1">
            <Search className="text-slate-400 pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
            <Input
              className="h-9.5 w-full rounded-xl pl-9.5 text-xs bg-slate-50/60 dark:bg-slate-950/40 border-slate-200/80 dark:border-slate-800/80 shadow-2xs focus-visible:ring-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("authFiles.searchAdvanced")}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Page Size */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 shrink-0">{t("authFiles.pageSize")}</span>
              <Select value={pageSizeOption} onValueChange={setPageSizeOption}>
                <SelectTrigger className="h-9 w-20 text-xs rounded-xl bg-slate-50/60 dark:bg-slate-950/40 border-slate-200/80 dark:border-slate-800/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15</SelectItem>
                  <SelectItem value="30">30</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 shrink-0">{t("authFiles.sort")}</span>
              <Select value={sortOption} onValueChange={setSortOption}>
                <SelectTrigger className="h-9 w-26 text-xs rounded-xl bg-slate-50/60 dark:bg-slate-950/40 border-slate-200/80 dark:border-slate-800/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t("authFiles.sortDefault")}</SelectItem>
                  <SelectItem value="name">{t("authFiles.sortName")}</SelectItem>
                  <SelectItem value="modtime">{t("authFiles.sortModTime")}</SelectItem>
                  <SelectItem value="priority">{t("authFiles.sortPriority")}</SelectItem>
                  <SelectItem value="quota">{t("authFiles.sortQuota")}</SelectItem>
                  <SelectItem value="success">{t("authFiles.sortSuccess")}</SelectItem>
                  <SelectItem value="failed">{t("authFiles.sortFailed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-28 text-xs rounded-xl bg-slate-50/60 dark:bg-slate-950/40 border-slate-200/80 dark:border-slate-800/80">
                  <SelectValue placeholder={t("authFiles.statusAll")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("authFiles.statusAll")}</SelectItem>
                  <SelectItem value="normal">{t("authFiles.statusEnabled")}</SelectItem>
                  <SelectItem value="disabled">{t("authFiles.statusDisabled")}</SelectItem>
                  <SelectItem value="cooldown">{t("authFiles.statusCooldown")}</SelectItem>
                  <SelectItem value="error">{t("authFiles.statusError")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Plan Filter */}
            <div className="flex items-center gap-1.5">
              <Select value={planFilter} onValueChange={setPlanFilter}>
                <SelectTrigger className="h-9 w-26 text-xs rounded-xl bg-slate-50/60 dark:bg-slate-950/40 border-slate-200/80 dark:border-slate-800/80">
                  <SelectValue placeholder={t("authFiles.planAll")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("authFiles.planAll")}</SelectItem>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="plus">Plus</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Row 2: Provider pills + Toggle options */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/70">
          {/* Provider quick pills */}
          <div className="flex flex-wrap gap-1.5 items-center">
            {providerNames.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="ghost"
                className={`h-7.5 rounded-full px-2.5 text-xs transition ${
                  providerFilter === name
                    ? "bg-blue-600 text-white hover:bg-blue-700 font-medium shadow-2xs"
                    : "bg-slate-100/80 dark:bg-slate-800/70 hover:bg-slate-200/80 text-slate-600 dark:text-slate-300"
                }`}
                onClick={() => setProviderFilter(name)}
              >
                {name === "all" ? t("common.all") : formatProviderLabel(name)}
                {name !== "all" ? (
                  <span className={`ml-1 px-1 rounded-full text-[10px] ${providerFilter === name ? "bg-white/20 text-white" : "bg-slate-200/80 dark:bg-slate-700 text-slate-500"}`}>
                    {entries.filter((entry) => entry.provider === name).length}
                  </span>
                ) : null}
              </Button>
            ))}
          </div>

          {/* Toggle Switches (Figure 1 style) */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
            <span className="text-[11px] text-slate-400 font-medium">显示选项:</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <Switch checked={onlyProblems} onCheckedChange={setOnlyProblems} />
              <span>{t("authFiles.filterProblem")}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <Switch checked={onlyDisabled} onCheckedChange={setOnlyDisabled} />
              <span>{t("authFiles.filterDisabled")}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <Switch checked={onlyNormal} onCheckedChange={setOnlyNormal} />
              <span>{t("authFiles.filterNormal")}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <Switch checked={compactMode} onCheckedChange={setCompactMode} />
              <span>{t("authFiles.compactMode")}</span>
            </label>
          </div>
        </div>
      </div>

      {/* Batch Action Toolbar when cards selected */}
      {selectedIds.size > 0 && (
        <div className="card-surface p-3 rounded-2xl border border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/40 shadow-xs mb-4 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
            <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
              已选中 {selectedIds.size} 项凭据
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-white dark:bg-slate-900"
              onClick={handleBatchFetchQuota}
              disabled={batchBusy}
            >
              {batchBusy ? <Loader2 className="size-3 animate-spin mr-1" /> : <Activity className="size-3 text-blue-600 mr-1" />}
              {t("authFiles.batchFetchQuota")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-white dark:bg-slate-900 text-emerald-600"
              onClick={() => handleBatchSetStatus(false)}
              disabled={batchBusy}
            >
              {t("authFiles.batchEnable")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-white dark:bg-slate-900 text-slate-600"
              onClick={() => handleBatchSetStatus(true)}
              disabled={batchBusy}
            >
              {t("authFiles.batchDisable")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={() => setBatchDeleteOpen(true)}
              disabled={batchBusy}
            >
              <Trash2 className="size-3 mr-1" />
              {t("common.delete")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-slate-500"
              onClick={() => setSelectedIds(new Set())}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Main Grid List */}
      {files.isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="size-7 animate-spin text-blue-600" />
          <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 bg-white/40 dark:bg-slate-900/40 px-6 py-20 text-center">
          <KeyRound className="text-muted-foreground size-9" />
          <p className="text-muted-foreground text-sm font-medium">{t("authFiles.none")}</p>
        </div>
      ) : (
        <div className={cn(
          "grid gap-4",
          compactMode
            ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        )}>
          {visible.map((entry) => {
            const cardKey = entry.auth_index || entry.id || entry.name;
            const quotaInfo = resolveCredentialQuota(entry, getCachedQuota(entry));
            const isFetchingQuota = fetchingQuotaIds.has(cardKey);
            const isChecked = selectedIds.has(entry.id || entry.name);

            return (
              <CredentialCard
                key={entry.id || entry.name}
                entry={entry}
                quota={quotaInfo}
                compact={compactMode}
                isChecked={isChecked}
                isFetchingQuota={isFetchingQuota}
                onToggleCheck={() => toggleSelectOne(entry.id || entry.name)}
                onFetchQuota={() => handleFetchQuota(entry)}
                onToggleStatus={(e, disabled) => setStatus.mutate({ entry: e, disabled })}
                onEdit={(e) => setSelected(e)}
                onDelete={(e) => setDeleteTarget(e)}
              />
            );
          })}
        </div>
      )}

      {/* Upload Dialog */}
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onPick={() => fileInput.current?.click()} />
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files;
          if (picked && picked.length > 0) upload.mutate(picked);
          event.target.value = "";
        }}
      />

      {/* Delete Single Dialog */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{deleteTarget?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && remove.mutate(deleteTarget)}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Batch Dialog */}
      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>确认删除选中的 {selectedIds.size} 个凭据文件吗？该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchDelete}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Dialog */}
      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("authFiles.deleteAllWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await credentials.remove([], true);
                  toast.success(t("authFiles.deleted"));
                  void invalidate();
                } catch (error) {
                  toast.error(errMessage(error));
                }
                setDeleteAllOpen(false);
              }}
            >
              {t("common.deleteAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail / Edit Properties Sheet */}
      <DetailSheet entry={selected} allEntries={entries} onClose={() => setSelected(null)} onChanged={invalidate} />
    </>
  );
}

/**
 * Rich Credential Card perfectly matching CPAMP (Figure 1)
 */
function CredentialCard({
  entry,
  quota,
  compact,
  isChecked,
  isFetchingQuota,
  onToggleCheck,
  onFetchQuota,
  onToggleStatus,
  onEdit,
  onDelete,
}: {
  entry: AuthFileEntry;
  quota: ResolvedQuota;
  compact: boolean;
  isChecked: boolean;
  isFetchingQuota: boolean;
  onToggleCheck: () => void;
  onFetchQuota: () => void;
  onToggleStatus: (entry: AuthFileEntry, disabled: boolean) => void;
  onEdit: (entry: AuthFileEntry) => void;
  onDelete: (entry: AuthFileEntry) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyFilename = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(entry.name);
    setCopied(true);
    toast.success("已复制文件名");
    setTimeout(() => setCopied(false), 2000);
  };

  const disabled = entry.disabled || entry.unavailable;

  if (compact) {
    return (
      <div
        className={cn(
          "card-surface rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 p-3.5 shadow-2xs transition-all duration-200 hover:shadow-md hover:border-blue-400/50 flex flex-col justify-between gap-2.5",
          disabled && "opacity-75"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Checkbox checked={isChecked} onCheckedChange={onToggleCheck} />
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-medium", getProviderTheme(entry.provider))}>
              {formatProviderLabel(entry.provider)}
            </Badge>
            <StatusBadge entry={entry} />
          </div>
          <Switch checked={!entry.disabled} onCheckedChange={(checked) => onToggleStatus(entry, !checked)} />
        </div>

        <p className="font-semibold text-xs text-slate-800 dark:text-slate-100 truncate" title={entry.name}>
          {entry.name}
        </p>

        <QuotaBar quota={quota} />

        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
          <span>{entry.priority !== undefined ? `优: ${entry.priority}` : ""}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-6" onClick={onFetchQuota} disabled={isFetchingQuota}>
              {isFetchingQuota ? <Loader2 className="size-3 animate-spin text-blue-600" /> : <Activity className="size-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onEdit(entry)}>
              <SlidersHorizontal className="size-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "card-surface rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 p-4 shadow-2xs transition-all duration-200 hover:shadow-md hover:border-blue-400/50 flex flex-col justify-between gap-3.5",
        disabled && "opacity-75"
      )}
    >
      {/* Top Badges & Checkbox */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox checked={isChecked} onCheckedChange={onToggleCheck} />
          <Badge variant="outline" className={cn("text-[11px] px-2 py-0.5 font-medium rounded-md", getProviderTheme(entry.provider))}>
            {formatProviderLabel(entry.provider)}
          </Badge>
          <StatusBadge entry={entry} />
        </div>
        <button
          onClick={copyFilename}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
          title="复制文件名"
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
        </button>
      </div>

      {/* Filename */}
      <div>
        <p
          className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100 truncate cursor-pointer hover:text-blue-600 transition-colors"
          title={entry.name}
          onClick={() => onEdit(entry)}
        >
          {entry.name}
        </p>

        {/* Subtitle: Size, Mod Time, Priority */}
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono mt-1 truncate">
          {t("authFiles.size")}: {formatBytes(entry.size ?? 0)} · {t("authFiles.modTime")}: {formatModTime(entry.modtime || entry.updated_at || entry.last_refresh)} · {t("authFiles.priority")}: {entry.priority ?? -1}
        </p>
      </div>

      {/* Request Counters: Success & Failed */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1 font-medium">
          <span className="text-slate-500 dark:text-slate-400">{t("authFiles.success")}</span>
          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{entry.success ?? 0}</span>
        </div>
        <div className="flex items-center gap-1 font-medium">
          <span className="text-slate-500 dark:text-slate-400">{t("authFiles.failed")}</span>
          <span className="font-mono font-bold text-rose-500 dark:text-rose-400">{entry.failed ?? 0}</span>
        </div>
      </div>

      {/* Health Status Timeline */}
      <HealthTimeline
        recentRequests={entry.recent_requests}
        status={entry.status}
        nextRetryAfter={entry.next_retry_after}
      />

      {/* Plan & Active Resets Row */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/60">
        <div className="flex items-center gap-1.5 truncate">
          <span>{t("authFiles.plan")} <span className="font-semibold text-slate-800 dark:text-slate-200">{quota.plan}</span></span>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span>{t("authFiles.activeResets")} <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{quota.activeResets}</span></span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0 shrink-0 font-medium",
            !quota.isKnown
              ? "border-dashed border-slate-300 dark:border-slate-700 text-slate-400"
              : quota.isUpstream
              ? "border-blue-400/60 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/40"
              : "border-amber-400/60 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/40"
          )}
        >
          {!quota.isKnown
            ? t("authFiles.quotaSourceUnknown")
            : quota.isUpstream
            ? t("authFiles.quotaSourceUpstream")
            : t("authFiles.quotaSourceEstimated")}
        </Badge>
      </div>

      {/* Quota Progress Bar Row */}
      <QuotaBar quota={quota} />

      {/* Bottom Action Toolbar */}
      <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-1">
          {/* Fetch Quota Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-7.5 rounded-lg border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800"
                onClick={onFetchQuota}
                disabled={isFetchingQuota}
              >
                {isFetchingQuota ? (
                  <Loader2 className="size-3.5 animate-spin text-blue-600" />
                ) : (
                  <Activity className="size-3.5 text-slate-600 dark:text-slate-300" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("authFiles.quotaFetch")}</TooltipContent>
          </Tooltip>

          {/* Download Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-7.5 rounded-lg border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800"
                onClick={async () => {
                  try {
                    await credentials.download(entry.name);
                  } catch (err) {
                    toast.error(errMessage(err));
                  }
                }}
              >
                <Download className="size-3.5 text-slate-600 dark:text-slate-300" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.download")}</TooltipContent>
          </Tooltip>

          {/* Settings / Edit Properties Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-7.5 rounded-lg border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800"
                onClick={() => onEdit(entry)}
              >
                <SlidersHorizontal className="size-3.5 text-slate-600 dark:text-slate-300" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("authFiles.editProps")}</TooltipContent>
          </Tooltip>

          {/* Delete Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-7.5 rounded-lg border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 text-rose-500 hover:bg-rose-100/60 dark:hover:bg-rose-950/50 hover:text-rose-600"
                onClick={() => onDelete(entry)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.delete")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Enable / Disable Switch */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {entry.disabled ? t("authFiles.statusDisabled") : t("authFiles.statusEnabled")}
          </span>
          <Switch
            checked={!entry.disabled}
            onCheckedChange={(checked) => onToggleStatus(entry, !checked)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Health Status Timeline: 18 rectangular indicator bars/ticks + status indicator
 */
function HealthTimeline({
  recentRequests,
  status,
  nextRetryAfter,
}: {
  recentRequests?: { time: number; success: number; failed: number }[];
  status?: string;
  nextRetryAfter?: string;
}) {
  const { t } = useTranslation();
  const tickCount = 18;

  const ticks = useMemo(() => {
    const list: ("idle" | "success" | "failed")[] = new Array(tickCount).fill("idle");
    if (recentRequests && recentRequests.length > 0) {
      const recent = recentRequests.slice(-tickCount);
      const startOffset = tickCount - recent.length;
      recent.forEach((item, idx) => {
        if (item.failed > 0) list[startOffset + idx] = "failed";
        else if (item.success > 0) list[startOffset + idx] = "success";
        else list[startOffset + idx] = "idle";
      });
    }
    return list;
  }, [recentRequests]);

  const isCooldown = status === "cooldown" || status === "rate-limited";
  const cooldownText = nextRetryAfter ? fromNow(dayjs(nextRetryAfter).valueOf()) : "--";

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 font-medium">
        {t("authFiles.healthStatus")}
      </span>
      <div className="flex items-center gap-[3px] flex-1 max-w-44 py-1">
        {ticks.map((tick, i) => (
          <span
            key={i}
            className={cn(
              "h-2 flex-1 rounded-[1.5px] transition-colors",
              tick === "failed" && "bg-rose-500",
              tick === "success" && "bg-emerald-500",
              tick === "idle" && (isCooldown ? "bg-amber-400/50" : "bg-slate-200 dark:bg-slate-700/60")
            )}
          />
        ))}
      </div>
      <span className="font-mono text-xs text-slate-400 dark:text-slate-500 shrink-0">
        {isCooldown ? cooldownText : "--"}
      </span>
    </div>
  );
}

/**
 * Quota Progress Bar with Window Name ⓘ, Remaining %, Reset Time and Colored Bar
 */
function QuotaBar({ quota }: { quota: ResolvedQuota }) {
  const { t } = useTranslation();

  if (!quota.isKnown || quota.remainingPct === null) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
            <span>{quota.windowLabel || t("authFiles.quotaSourceUnknown")}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" />
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs space-y-1 max-w-56">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    {t("authFiles.quotaSourceUnknownFull")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("authFiles.quotaUnknownHint")}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="font-medium text-slate-400 dark:text-slate-500">
              未知
            </span>
          </div>
        </div>

        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full w-0 bg-transparent rounded-full" />
        </div>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, quota.remainingPct));
  const isGreen = pct > 60;
  const isAmber = pct >= 20 && pct <= 60;
  const isRose = pct < 20;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
          <span>{quota.windowLabel}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" />
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs space-y-1 max-w-56">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {quota.isUpstream ? t("authFiles.quotaSourceUpstreamFull") : t("authFiles.quotaSourceEstimatedFull")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {quota.isUpstream ? t("authFiles.quotaUpstreamHint") : t("authFiles.quotaEstimatedHint")}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span
            className={cn(
              "font-bold",
              isGreen && "text-emerald-600 dark:text-emerald-400",
              isAmber && "text-amber-500 dark:text-amber-400",
              isRose && "text-rose-500 dark:text-rose-400"
            )}
          >
            {pct}%
          </span>
          {quota.resetTime ? (
            <span className="text-slate-400 text-[11px] font-mono">{quota.resetTime}</span>
          ) : null}
        </div>
      </div>

      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            isGreen && "bg-emerald-500",
            isAmber && "bg-amber-500",
            isRose && "bg-rose-500"
          )}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ entry }: { entry: AuthFileEntry }) {
  const { t } = useTranslation();
  if (entry.disabled) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
        {t("authFiles.statusDisabled")}
      </span>
    );
  }
  if (entry.unavailable || entry.status === "error" || entry.status === "unavailable") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400">
        {t("authFiles.statusError")}
      </span>
    );
  }
  if (entry.status === "cooldown" || entry.status === "rate-limited") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
        {t("authFiles.statusCooldown")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400">
      {t("authFiles.statusEnabled")}
    </span>
  );
}

function UploadDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("common.upload")}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t("authFiles.uploadHint")}</p>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={onPick}>
            <Upload className="size-3.5" />
            {t("authFiles.pickFiles")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailSheet({
  entry,
  allEntries,
  onClose,
  onChanged,
}: {
  entry: AuthFileEntry | null;
  allEntries?: AuthFileEntry[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[] | null>(null);
  const [syncingModels, setSyncingModels] = useState(false);
  const [priority, setPriority] = useState("");
  const [weight, setWeight] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState("");
  const [note, setNote] = useState("");

  const open = Boolean(entry);
  const key = entry?.id ?? "";
  useEffect(() => {
    setPriority(entry?.priority !== undefined ? String(entry.priority) : "");
    setWeight(entry?.weight !== undefined ? String(entry.weight) : "");
    setMaxConcurrency(entry?.max_concurrency !== undefined ? String(entry.max_concurrency) : "");
    setNote(entry?.note ?? "");
    const cached = entry ? getCachedModels(entry.auth_index || entry.id || entry.name) : null;
    setModels(cached);
  }, [key]);

  const detailRows: [string, string | number][] = [];
  const pushDetail = (label: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== "") detailRows.push([label, value]);
  };
  if (entry) {
    pushDetail(t("common.provider"), entry.provider);
    pushDetail("Type", entry.type);
    pushDetail("Plan Type", entry.plan_type);
    pushDetail("Auth index", entry.auth_index);
    pushDetail("Status", entry.status_message || entry.status);
    pushDetail("Email", entry.email);
    pushDetail("Project", entry.project_id);
    pushDetail("Account", entry.account_type);
    pushDetail("Source", entry.source);
    pushDetail("Base URL", entry.path);
    if (entry.cooldowns && Object.keys(entry.cooldowns).length > 0) {
      pushDetail("Cooldowns", JSON.stringify(entry.cooldowns));
    }
  }

  const saveFields = async () => {
    if (!entry) return;
    const fields: Record<string, unknown> = {};
    if (priority !== "") fields.priority = Number(priority);
    if (weight !== "") fields.weight = Number(weight);
    const trimmedConcurrency = maxConcurrency.trim();
    const prevConcurrency = entry.max_concurrency !== undefined ? String(entry.max_concurrency) : "";
    if (trimmedConcurrency !== prevConcurrency) {
      fields.max_concurrency = trimmedConcurrency === "" ? null : Number(trimmedConcurrency);
    }
    if (note !== (entry.note ?? "")) fields.note = note;
    if (Object.keys(fields).length === 0) {
      onClose();
      return;
    }
    try {
      await credentials.setFields(entry.name, fields);
      toast.success(t("common.saved"));
      onChanged();
      onClose();
    } catch (error) {
      toast.error(errMessage(error));
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg!">
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Power className={`size-4 ${entry.disabled ? "text-zinc-400" : "text-emerald-500"}`} />
                {entry.name}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-2 space-y-5">
              <DetailList rows={detailRows} />

              <div className="space-y-2">
                <Label className="text-xs">{t("authFiles.fields")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[10px]">priority</Label>
                    <Input value={priority} onChange={(event) => setPriority(event.target.value)} className="h-8 text-xs" inputMode="numeric" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[10px]">weight</Label>
                    <Input value={weight} onChange={(event) => setWeight(event.target.value)} className="h-8 text-xs" inputMode="numeric" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[10px]">max_concurrency</Label>
                    <Input value={maxConcurrency} onChange={(event) => setMaxConcurrency(event.target.value)} placeholder="∞" className="h-8 text-xs" inputMode="numeric" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px]">note</Label>
                  <Input value={note} onChange={(event) => setNote(event.target.value)} className="h-8 text-xs" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-8 flex-1 text-xs" onClick={() => void saveFields()}>
                    {t("common.save")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 text-xs"
                    onClick={async () => {
                      try {
                        await credentials.download(entry.name);
                      } catch (error) {
                        toast.error(errMessage(error));
                      }
                    }}
                  >
                    <Download className="size-3.5" />
                    {t("common.download")}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 text-xs justify-between"
                    onClick={async () => {
                      if (models !== null && models.length > 0) {
                        setModels(null);
                        return;
                      }
                      const cached = getCachedModels(entry.auth_index || entry.id || entry.name);
                      if (cached) {
                        setModels(cached);
                      }
                      try {
                        const list = await credentials.models(entry.name);
                        const ids = list.map((model) => model.id);
                        setModels(ids);
                        saveCachedModels([entry.auth_index, entry.id, entry.name], ids);
                      } catch (error) {
                        if (!cached) {
                          toast.error(errMessage(error));
                        }
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <ChevronRight className={`size-3.5 shrink-0 transition-transform ${models !== null && models.length > 0 ? "rotate-90" : ""}`} />
                      <span>{t("authFiles.viewModels")}</span>
                    </div>
                    {models !== null && models.length > 0 ? (
                      <span className="text-[10px] text-muted-foreground font-mono font-normal">
                        ({models.length})
                      </span>
                    ) : null}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs shrink-0 gap-1.5"
                    title={t("authFiles.syncModelsHint")}
                    disabled={syncingModels}
                    onClick={async () => {
                      setSyncingModels(true);
                      try {
                        const res = await credentials.syncModels({ name: entry.name, auth_index: entry.auth_index });
                        const ids = res.models.map((m) => m.id);
                        setModels(ids);
                        saveCachedModels([entry.auth_index, entry.id, entry.name], ids);

                        if (res.synced_peers && res.synced_peers > 0 && allEntries) {
                          for (const peer of allEntries) {
                            if (peer.name === entry.name || peer.id === entry.id) continue;
                            const sameProvider = (peer.provider || peer.type || "").toLowerCase() === (entry.provider || entry.type || "").toLowerCase();
                            const samePlan = (peer.plan_type || "").toLowerCase() === (entry.plan_type || "").toLowerCase();
                            if (sameProvider && samePlan) {
                              saveCachedModels([peer.auth_index, peer.id, peer.name], ids);
                            }
                          }
                        }

                        if (res.synced_peers && res.synced_peers > 0) {
                          toast.success(t("authFiles.modelsSyncedWithPeers", { count: ids.length, peers: res.synced_peers }));
                        } else {
                          toast.success(t("authFiles.modelsSynced", { count: ids.length }));
                        }
                      } catch (error) {
                        toast.error(`${t("authFiles.modelsSyncFailed")}: ${errMessage(error)}`);
                      } finally {
                        setSyncingModels(false);
                      }
                    }}
                  >
                    <RefreshCw className={`size-3.5 ${syncingModels ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">{t("authFiles.syncModels")}</span>
                  </Button>
                </div>
                {models !== null && models.length > 0 ? (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{t("authFiles.availableModelsCount", { count: models.length })}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto pr-1">
                      {models.map((model) => (
                        <Badge key={model} variant="outline" className="font-mono text-[10px] bg-background/80">
                          {model}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : models !== null && models.length === 0 ? (
                  <p className="text-muted-foreground mt-1 text-xs">{t("common.empty")}</p>
                ) : null}
              </div>

              <SectionCard title={t("common.details")}>
                <JsonView value={entry} className="max-h-72" />
              </SectionCard>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
