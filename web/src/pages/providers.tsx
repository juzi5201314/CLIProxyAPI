import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Ellipsis,
  Feather,
  Gem,
  Infinity as InfinityIcon,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  MessagesSquare,
  Plus,
  Search,
  ServerOff,
  Terminal,
  Trash2,
  Triangle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PageHeader } from "@/components/shared/page-header";
import { CompatEditorSheet, type CompatProvider } from "@/components/providers/compat-editor";
import { KeyEntryEditorSheet } from "@/components/providers/key-entry-editor";
import { AccessKeysDialog, ExcludedModelsDialog, ModelAliasDialog } from "@/components/providers/secondary-editors";
import { ProviderCurlDialog, ProviderModelsDialog } from "@/components/providers/provider-dialogs";
import type { ModelEntry } from "@/components/providers/model-editor";
import {
  ALL_KINDS,
  COMPAT_KIND,
  type Entry,
  type KindMeta,
} from "@/components/providers/provider-tools";
import { apiKeyProviders } from "@/api/management";
import { errMessage } from "@/api/types";

const KIND_ICONS: Record<string, LucideIcon> = {
  "openai-compatibility": Boxes,
  gemini: Gem,
  claude: Feather,
  codex: Terminal,
  xai: Zap,
  meta: InfinityIcon,
  vertex: Triangle,
  interactions: MessagesSquare,
};

const KIND_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "openai-compatibility": { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800/40" },
  gemini: { bg: "bg-blue-50 dark:bg-blue-950/40", text: "text-blue-600 dark:text-blue-400", border: "border-blue-200 dark:border-blue-800/40" },
  claude: { bg: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-600 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800/40" },
  codex: { bg: "bg-indigo-50 dark:bg-indigo-950/40", text: "text-indigo-600 dark:text-indigo-400", border: "border-indigo-200 dark:border-indigo-800/40" },
  xai: { bg: "bg-purple-50 dark:bg-purple-950/40", text: "text-purple-600 dark:text-purple-400", border: "border-purple-200 dark:border-purple-800/40" },
  meta: { bg: "bg-sky-50 dark:bg-sky-950/40", text: "text-sky-600 dark:text-sky-400", border: "border-sky-200 dark:border-sky-800/40" },
  vertex: { bg: "bg-teal-50 dark:bg-teal-950/40", text: "text-teal-600 dark:text-teal-400", border: "border-teal-200 dark:border-teal-800/40" },
  interactions: { bg: "bg-rose-50 dark:bg-rose-950/40", text: "text-rose-600 dark:text-rose-400", border: "border-rose-200 dark:border-rose-800/40" },
};

export interface ProviderRow {
  kind: KindMeta;
  /** Position of the entry inside its server-side array; -1 marks a new entry. */
  index: number;
  name: string;
  baseURL: string;
  priority?: number;
  disabled: boolean;
  prefix?: string;
  keyCount: number;
  modelCount: number;
  keys: string[];
  entry: Entry;
}

type SortMode = "enabled" | "priority" | "name";
type ViewMode = "cards" | "table";
type StatusFilter = "all" | "enabled" | "disabled";

const STORAGE_KEY_PROVIDERS_VIEW_MODE = "cpa-providers-view-mode";

export function ProvidersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ["providers-overview"],
    queryFn: async (): Promise<Record<string, Entry[]>> => {
      const lists = await Promise.all(ALL_KINDS.map((kind) => apiKeyProviders.getList<Entry>(kind.id)));
      return Object.fromEntries(ALL_KINDS.map((kind, i) => [kind.id, lists[i]])) as Record<string, Entry[]>;
    },
  });

  const [kindFilter, setKindFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("enabled");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PROVIDERS_VIEW_MODE);
      if (saved === "cards" || saved === "table") {
        return saved;
      }
    } catch {
      // ignore
    }
    return "cards";
  });

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY_PROVIDERS_VIEW_MODE, mode);
    } catch {
      // ignore
    }
  };
  const [compatEditing, setCompatEditing] = useState<{ index: number; provider: CompatProvider } | null>(null);
  const [keyEditing, setKeyEditing] = useState<{ kind: KindMeta; index: number; entry: Entry } | null>(null);
  const [secondary, setSecondary] = useState<"alias" | "excluded" | "keys" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderRow | null>(null);

  // Inspector Dialogs
  const [inspectingModels, setInspectingModels] = useState<ProviderRow | null>(null);
  const [inspectingCurl, setInspectingCurl] = useState<ProviderRow | null>(null);

  /** Write one entry back to its list (index -1 appends; null deletes). */
  const persist = useMutation({
    mutationFn: async ({ kind, index, entry }: { kind: KindMeta; index: number; entry: Entry | null }) => {
      const fresh = await apiKeyProviders.getList<Entry>(kind.id);
      let next: Entry[];
      if (entry === null) {
        next = fresh.filter((_, i) => i !== index);
      } else if (index < 0) {
        next = [...fresh, entry];
      } else {
        next = fresh.map((item, i) => (i === index ? entry : item));
      }
      await apiKeyProviders.putList(kind.id, next);
    },
    onSuccess: () => {
      toast.success(t("common.saved"));
      void queryClient.invalidateQueries({ queryKey: ["providers-overview"] });
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  const allRows = useMemo<ProviderRow[]>(() => {
    const data = overview.data ?? {};
    const out: ProviderRow[] = [];
    for (const kind of ALL_KINDS) {
      (data[kind.id] ?? []).forEach((entry, index) => {
        const keys =
          kind.id === "openai-compatibility"
            ? ((entry["api-key-entries"] as Entry[] | undefined) ?? []).map((item) => String(item["api-key"] ?? "")).filter(Boolean)
            : [String(entry["api-key"] ?? "")].filter(Boolean);
        const explicitName = String(entry.name ?? "").trim();
        const name = kind.id === "openai-compatibility" ? explicitName : (explicitName || maskIdentity(entry, kind));
        const baseURL = String(entry["base-url"] ?? "");
        const excludedList = (entry["excluded-models"] as string[] | undefined) ?? [];
        const isExcludedAll = excludedList.includes("*");
        const isDisabled = Boolean(entry.disabled) || isExcludedAll;

        out.push({
          kind,
          index,
          name,
          baseURL,
          priority: typeof entry.priority === "number" ? entry.priority : undefined,
          disabled: isDisabled,
          prefix: entry.prefix ? String(entry.prefix) : undefined,
          keyCount: keys.length,
          modelCount: ((entry.models as unknown[] | undefined) ?? []).length,
          keys,
          entry,
        });
      });
    }
    return out;
  }, [overview.data]);

  const rows = useMemo<ProviderRow[]>(() => {
    let out = allRows;

    // Filter by Kind
    if (kindFilter !== "all") {
      out = out.filter((r) => r.kind.id === kindFilter);
    }

    // Filter by Status
    if (statusFilter === "enabled") {
      out = out.filter((r) => !r.disabled);
    } else if (statusFilter === "disabled") {
      out = out.filter((r) => r.disabled);
    }

    // Search filter
    const term = search.trim().toLowerCase();
    if (term) {
      out = out.filter(
        (row) =>
          row.name.toLowerCase().includes(term) ||
          row.baseURL.toLowerCase().includes(term) ||
          row.keys.some((key) => key.toLowerCase().includes(term)) ||
          (row.prefix ?? "").toLowerCase().includes(term) ||
          ((row.entry.models as ModelEntry[] | undefined) ?? []).some(
            (m) => String(m.name ?? "").toLowerCase().includes(term) || String(m.alias ?? "").toLowerCase().includes(term),
          ),
      );
    }

    // Sorting
    return [...out].sort((a, b) => {
      if (sortMode === "enabled") {
        if (a.disabled !== b.disabled) {
          return Number(a.disabled) - Number(b.disabled);
        }
        return (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name);
      }
      if (sortMode === "priority") {
        return (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [allRows, kindFilter, statusFilter, search, sortMode]);

  // Global counts for metrics banner
  const totalCount = allRows.length;
  const enabledCount = allRows.filter((r) => !r.disabled).length;
  const disabledCount = totalCount - enabledCount;
  const totalKeysCount = allRows.reduce((sum, r) => sum + r.keyCount, 0);
  const totalModelsCount = allRows.reduce((sum, r) => sum + r.modelCount, 0);

  const counts = useMemo(() => {
    const data = overview.data ?? {};
    return Object.fromEntries(ALL_KINDS.map((kind) => [kind.id, (data[kind.id] ?? []).length]));
  }, [overview.data]);

  const addProvider = (kind: KindMeta) => {
    if (kind.id === "openai-compatibility") {
      setCompatEditing({ index: -1, provider: { name: "", "base-url": "", models: [] } });
    } else {
      setKeyEditing({ kind, index: -1, entry: { "api-key": "", "base-url": "" } });
    }
  };

  const deleteRow = (row: ProviderRow) => {
    persist.mutate({ kind: row.kind, index: row.index, entry: null });
    setPendingDelete(null);
  };

  const toggleDisabled = (row: ProviderRow, enabled: boolean) => {
    const isCompat = row.kind.id === "openai-compatibility";
    let nextEntry: Entry;

    if (isCompat) {
      nextEntry = { ...row.entry, disabled: !enabled };
    } else {
      const currentExcluded = [...((row.entry["excluded-models"] as string[] | undefined) ?? [])];
      let nextExcluded: string[];
      if (!enabled) {
        nextExcluded = currentExcluded.includes("*") ? currentExcluded : [...currentExcluded, "*"];
      } else {
        nextExcluded = currentExcluded.filter((m) => m !== "*");
      }
      nextEntry = {
        ...row.entry,
        disabled: !enabled,
        "excluded-models": nextExcluded,
      };
    }

    persist.mutate({ kind: row.kind, index: row.index, entry: nextEntry });
  };

  return (
    <>
      <PageHeader title={t("nav.providersItem")} subtitle={t("providers.subtitle")} />

      {/* Top Overview Metrics Banner (宏观大盘看板) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-6">
        <div className="card-surface p-4.5 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t("providers.stats.totalProviders")}</p>
            <p className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">{totalCount}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("providers.stats.enabledBreakdown", { enabled: enabledCount, disabled: disabledCount })}</p>
          </div>
          <div className="size-11 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Boxes className="size-5" />
          </div>
        </div>

        <div className="card-surface p-4.5 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t("providers.stats.activeKeys")}</p>
            <p className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">{totalKeysCount}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("providers.stats.loadBalancing")}</p>
          </div>
          <div className="size-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <KeyRound className="size-5" />
          </div>
        </div>

        <div className="card-surface p-4.5 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t("providers.stats.modelsCount")}</p>
            <p className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">{totalModelsCount}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("providers.stats.modelsSubtitle")}</p>
          </div>
          <div className="size-11 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Cpu className="size-5" />
          </div>
        </div>
      </div>

      {/* Category Kind Pills Bar */}
      <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1.5">
        <KindPill
          active={kindFilter === "all"}
          onClick={() => setKindFilter("all")}
          icon={Boxes}
          label={t("providers.kind.all")}
          count={totalCount}
        />
        {ALL_KINDS.map((kind) => (
          <KindPill
            key={kind.id}
            active={kindFilter === kind.id}
            onClick={() => setKindFilter(kind.id)}
            icon={KIND_ICONS[kind.id] ?? Boxes}
            label={t(`providers.kind.${kind.labelKey}`)}
            count={counts[kind.id] ?? 0}
          />
        ))}
      </div>

      {/* Unified Action & Filter Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {/* Search Input */}
        <div className="relative">
          <Search className="text-slate-400 pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            className="h-8.5 w-60 sm:w-72 rounded-xl pl-8.5 text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("providers.searchPlaceholder")}
          />
        </div>

        {/* Status Filter Segmented Buttons */}
        <div className="flex items-center rounded-xl border border-slate-200/80 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
              statusFilter === "all" ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 font-semibold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {t("providers.filter.allStatus")}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("enabled")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
              statusFilter === "enabled" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 font-semibold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {t("providers.filter.onlyEnabled")}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("disabled")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
              statusFilter === "disabled" ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-semibold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {t("providers.filter.onlyDisabled")}
          </button>
        </div>

        {/* Sort Mode Dropdown */}
        <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
          <SelectTrigger className="h-8.5 w-36 rounded-xl text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="enabled">{t("providers.sort.enabledFirst") || "优先已启用"}</SelectItem>
            <SelectItem value="priority">{t("providers.sort.priority") || "按优先级"}</SelectItem>
            <SelectItem value="name">{t("providers.sort.name") || "按名称"}</SelectItem>
          </SelectContent>
        </Select>

        {/* View Mode Toggle (Cards vs Table) */}
        <div className="flex items-center rounded-xl border border-slate-200/80 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
          <button
            type="button"
            onClick={() => handleViewModeChange("cards")}
            className={`flex size-7.5 items-center justify-center rounded-lg transition ${
              viewMode === "cards" ? "bg-blue-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
            title="卡片视图"
          >
            <LayoutGrid className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange("table")}
            className={`flex size-7.5 items-center justify-center rounded-lg transition ${
              viewMode === "table" ? "bg-blue-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
            title="表格视图"
          >
            <List className="size-3.5" />
          </button>
        </div>

        {/* Right Action Buttons */}
        <div className="ml-auto flex items-center gap-2">
          {/* Secondary settings dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8.5 rounded-xl text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs">
                <Ellipsis className="size-3.5" />
                <span>{t("providers.more")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl">
              <DropdownMenuItem onClick={() => setSecondary("alias")}>
                <span>{t("providers.modelAlias")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSecondary("excluded")}>
                <span>{t("providers.excludedModels")}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSecondary("keys")}>
                <span>{t("providers.accessKeys")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Add Provider Button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-8.5 gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs text-xs font-semibold">
                <Plus className="size-3.5" />
                <span>{t("providers.addProvider")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl">
              <DropdownMenuLabel className="text-[10px] uppercase text-slate-400">
                {t("providers.addProvider")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALL_KINDS.map((kind) => {
                const Icon = KIND_ICONS[kind.id] ?? Boxes;
                return (
                  <DropdownMenuItem key={kind.id} onClick={() => addProvider(kind)} className="text-xs">
                    <Icon className="mr-2 size-3.5 text-blue-500" />
                    <span>{t(`providers.kind.${kind.labelKey}`)}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Content Area: Cards or Table */}
      {overview.isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="size-8 animate-spin text-blue-500" />
          <p className="mt-2 text-xs text-slate-500">{t("common.loading")}</p>
        </div>
      ) : rows.length === 0 ? (
        <Empty className="card-surface mt-5 border-0 py-20 rounded-2xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerOff className="size-10 text-slate-400" />
            </EmptyMedia>
            <EmptyTitle>{search || kindFilter !== "all" || statusFilter !== "all" ? t("common.empty") : t("providers.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("providers.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : viewMode === "cards" ? (
        /* Spacious, Breathable 3-Column Card Grid */
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {rows.map((row) => {
            const rowKey = `${row.kind.id}:${row.index}`;

            return (
              <ProviderCardElement
                key={rowKey}
                row={row}
                onEdit={setCompatEditing}
                onEditKey={setKeyEditing}
                onDelete={setPendingDelete}
                onToggle={toggleDisabled}
                onOpenModels={() => setInspectingModels(row)}
                onOpenCurl={() => setInspectingCurl(row)}
              />
            );
          })}
        </div>
      ) : (
        /* Clean & Airy Table View */
        <div className="card-surface mt-5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-2xs">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-100 dark:border-slate-800/70">
                <TableHead className="w-36">{t("providers.table.type")}</TableHead>
                <TableHead>{t("providers.table.identity")}</TableHead>
                <TableHead className="min-w-48">{t("providers.table.address")}</TableHead>
                <TableHead className="w-40">{t("providers.models")}</TableHead>
                <TableHead className="w-28 text-center">{t("common.status") || "状态"}</TableHead>
                <TableHead className="w-20 text-center">{t("providers.enabled")}</TableHead>
                <TableHead className="w-40 text-right">{t("providers.table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const rowKey = `${row.kind.id}:${row.index}`;

                return (
                  <ProviderTableRowElement
                    key={rowKey}
                    row={row}
                    onEdit={setCompatEditing}
                    onEditKey={setKeyEditing}
                    onDelete={setPendingDelete}
                    onToggle={toggleDisabled}
                    onOpenModels={() => setInspectingModels(row)}
                    onOpenCurl={() => setInspectingCurl(row)}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Editors */}
      {compatEditing ? (
        <CompatEditorSheet
          provider={compatEditing.provider}
          isNew={compatEditing.index < 0}
          onClose={() => setCompatEditing(null)}
          onSave={(next) => {
            persist.mutate({ kind: COMPAT_KIND, index: compatEditing.index, entry: next as Entry });
            setCompatEditing(null);
          }}
        />
      ) : null}

      {keyEditing ? (
        <KeyEntryEditorSheet
          kind={keyEditing.kind}
          entry={keyEditing.entry}
          isNew={keyEditing.index < 0}
          onClose={() => setKeyEditing(null)}
          onSave={(next) => {
            persist.mutate({ kind: keyEditing.kind, index: keyEditing.index, entry: next });
            setKeyEditing(null);
          }}
        />
      ) : null}

      {secondary === "alias" ? <ModelAliasDialog onClose={() => setSecondary(null)} /> : null}
      {secondary === "excluded" ? <ExcludedModelsDialog onClose={() => setSecondary(null)} /> : null}
      {secondary === "keys" ? <AccessKeysDialog onClose={() => setSecondary(null)} /> : null}

      {/* Model Inspector Dialog */}
      {inspectingModels ? (
        <ProviderModelsDialog
          open
          onClose={() => setInspectingModels(null)}
          providerName={inspectingModels.name}
          kind={inspectingModels.kind}
          models={(inspectingModels.entry.models as ModelEntry[] | undefined) ?? []}
        />
      ) : null}

      {/* Quick cURL Integration Dialog */}
      {inspectingCurl ? (
        <ProviderCurlDialog
          open
          onClose={() => setInspectingCurl(null)}
          providerName={inspectingCurl.name}
          defaultModel={String(((inspectingCurl.entry.models as ModelEntry[] | undefined) ?? [])[0]?.name ?? "gpt-4o")}
        />
      ) : null}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("providers.removeConfirmTitle", { name: pendingDelete?.name || "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("providers.removeConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-white hover:bg-destructive/90"
              onClick={() => pendingDelete && deleteRow(pendingDelete)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ------------------------------------------------------------------- Sub-components

function KindPill({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-all duration-150 shadow-2xs ${
        active
          ? "bg-blue-600 font-medium text-white shadow-xs"
          : "bg-white/80 text-slate-600 hover:bg-white hover:text-slate-900 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      <span className={`rounded-full px-1.5 text-[10px] tabular-nums font-semibold ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
        {count}
      </span>
    </button>
  );
}

function maskIdentity(entry: Entry, kind: KindMeta): string {
  const prefix = entry.prefix ? String(entry.prefix) : "";
  if (prefix) return prefix;
  const key = String(entry[kind.identity ?? "api-key"] ?? "");
  return key ? key.slice(0, 6) + "…" + key.slice(-4) : "—";
}

/** Spacious, High-Density, Breathable Provider Card */
function ProviderCardElement({
  row,
  onEdit,
  onEditKey,
  onDelete,
  onToggle,
  onOpenModels,
  onOpenCurl,
}: {
  row: ProviderRow;
  onEdit: (value: { index: number; provider: CompatProvider }) => void;
  onEditKey: (value: { kind: KindMeta; index: number; entry: Entry }) => void;
  onDelete: (row: ProviderRow) => void;
  onToggle: (row: ProviderRow, enabled: boolean) => void;
  onOpenModels: () => void;
  onOpenCurl: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [copiedBase, setCopiedBase] = useState(false);

  const Icon = KIND_ICONS[row.kind.id] ?? Boxes;
  const color = KIND_COLORS[row.kind.id] ?? KIND_COLORS["openai-compatibility"]!;
  const isCompat = row.kind.id === "openai-compatibility";
  const defaultModelName = String(((row.entry.models as ModelEntry[] | undefined) ?? [])[0]?.name ?? "gpt-4o");

  const copyBaseURL = () => {
    const url = row.baseURL || row.kind.defaultBase || "";
    if (url) {
      void navigator.clipboard.writeText(url);
      setCopiedBase(true);
      toast.success(t("providers.copyBaseURL"));
      setTimeout(() => setCopiedBase(false), 1500);
    }
  };

  const handleEdit = () => {
    if (isCompat) onEdit({ index: row.index, provider: structuredClone(row.entry) as CompatProvider });
    else onEditKey({ kind: row.kind, index: row.index, entry: structuredClone(row.entry) });
  };

  const jumpToPlayground = () => {
    navigate(`/playground?model=${encodeURIComponent(defaultModelName)}`);
  };

  return (
    <div
      className={`card-surface flex flex-col justify-between p-5 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/95 transition-all duration-200 hover:shadow-md ${
        row.disabled ? "opacity-60 bg-slate-50/50 dark:bg-slate-900/50" : ""
      }`}
    >
      <div className="space-y-4">
        {/* Card Header: Type Pill & Enable Switch */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`flex size-8 items-center justify-center rounded-xl border ${color.bg} ${color.text} ${color.border}`}>
              <Icon className="size-4" />
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                {t(`providers.kind.${row.kind.labelKey}`)}
              </span>
              {row.priority !== undefined && (
                <Badge variant="outline" className="text-[10px] font-mono text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-900/50">
                  P{row.priority}
                </Badge>
              )}
            </div>
          </div>

          {/* Quick Enable/Disable switch right on the card */}
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                row.disabled
                  ? "bg-slate-300 dark:bg-slate-600"
                  : "bg-emerald-500"
              }`}
            />
            <Switch
              checked={!row.disabled}
              onCheckedChange={(checked) => onToggle(row, checked)}
              aria-label={t("providers.enabled")}
            />
          </div>
        </div>

        {/* Identity & Status */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="truncate font-bold text-sm text-slate-900 dark:text-slate-100" title={row.name}>
              {row.name || t("common.unknown")}
            </h4>

            {row.disabled ? (
              <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-200">
                {t("providers.disabledTag")}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-emerald-600/80 border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20">
                {t("providers.ready")}
              </Badge>
            )}
          </div>

          {/* Base URL with dedicated 1-click Copy button */}
          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800/60 px-3 py-1.5 text-xs font-mono text-slate-500 dark:text-slate-400">
            <span className="truncate flex-1" title={row.baseURL}>
              {row.baseURL || row.kind.defaultBase || t("providers.baseURLOptionalHint")}
            </span>
            <button
              type="button"
              onClick={copyBaseURL}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition shrink-0"
              title={t("common.copy")}
            >
              {copiedBase ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </button>
          </div>
        </div>

        {/* Interactive Feature Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Models Pill (Click to open Model Inspector dialog!) */}
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50/80 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 px-2.5 py-1 text-[11px] font-medium text-purple-700 dark:text-purple-300 transition border border-purple-200/50 dark:border-purple-800/40"
            title={t("providers.modelsList")}
          >
            <Cpu className="size-3 text-purple-500" />
            <span>{row.modelCount > 0 ? t("providers.modelsPreview", { count: row.modelCount }) : t("providers.allModels")}</span>
            <ChevronRight className="size-3 text-purple-400" />
          </button>

          {/* Keys Count Pill */}
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/40">
            <KeyRound className="size-3 text-emerald-500" />
            <span>{t("providers.keysCount_other", { count: row.keyCount })}</span>
          </span>

          {/* Prefix Pill */}
          {row.prefix && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50/80 dark:bg-blue-950/40 px-2 py-1 font-mono text-[10px] text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/40">
              {t("providers.fieldPrefix")}: {row.prefix}
            </span>
          )}

          {/* Proxy Pill */}
          {Boolean(row.entry["proxy-url"]) && (
            <span
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-mono text-[10px] text-slate-600 dark:text-slate-300 truncate max-w-44"
              title={String(row.entry["proxy-url"])}
            >
              {t("providers.proxy")}: {String(row.entry["proxy-url"])}
            </span>
          )}
        </div>
      </div>

      {/* Card Footer Actions: Rich & Effortless */}
      <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/70 pt-3 mt-4">
        <div className="flex items-center gap-1.5">
          {/* One-click Playground Test */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7.5 gap-1.5 px-2.5 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg"
            onClick={jumpToPlayground}
            title={t("providers.debug")}
          >
            <Terminal className="size-3.5" />
            <span>{t("providers.debug")}</span>
          </Button>

          {/* Quick cURL Integration Snippet */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7.5 gap-1.5 px-2.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-lg"
            onClick={onOpenCurl}
            title={t("providers.connect")}
          >
            <Code2 className="size-3.5" />
            <span>{t("providers.connect")}</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7.5 text-xs rounded-lg px-2.5" onClick={handleEdit}>
            {t("common.edit")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7.5 rounded-lg text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            onClick={() => onDelete(row)}
            title={t("common.delete")}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Provider Table Row Element with Matching Ergonomics */
function ProviderTableRowElement({
  row,
  onEdit,
  onEditKey,
  onDelete,
  onToggle,
  onOpenModels,
  onOpenCurl,
}: {
  row: ProviderRow;
  onEdit: (value: { index: number; provider: CompatProvider }) => void;
  onEditKey: (value: { kind: KindMeta; index: number; entry: Entry }) => void;
  onDelete: (row: ProviderRow) => void;
  onToggle: (row: ProviderRow, enabled: boolean) => void;
  onOpenModels: () => void;
  onOpenCurl: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [copiedBase, setCopiedBase] = useState(false);

  const Icon = KIND_ICONS[row.kind.id] ?? Boxes;
  const isCompat = row.kind.id === "openai-compatibility";
  const defaultModelName = String(((row.entry.models as ModelEntry[] | undefined) ?? [])[0]?.name ?? "gpt-4o");

  const copyBaseURL = () => {
    const url = row.baseURL || row.kind.defaultBase || "";
    if (url) {
      void navigator.clipboard.writeText(url);
      setCopiedBase(true);
      toast.success(t("providers.copyBaseURL"));
      setTimeout(() => setCopiedBase(false), 1500);
    }
  };

  const handleEdit = () => {
    if (isCompat) onEdit({ index: row.index, provider: structuredClone(row.entry) as CompatProvider });
    else onEditKey({ kind: row.kind, index: row.index, entry: structuredClone(row.entry) });
  };

  return (
    <TableRow className={`border-b border-slate-100 dark:border-slate-800/60 ${row.disabled ? "opacity-60 bg-slate-50/50 dark:bg-slate-900/50" : ""}`}>
      {/* Type */}
      <TableCell>
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="bg-slate-100 dark:bg-slate-800 flex size-7.5 items-center justify-center rounded-xl">
            <Icon className="size-3.5 text-blue-500" />
          </span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">{t(`providers.kind.${row.kind.labelKey}`)}</span>
        </span>
      </TableCell>

      {/* Identity & Name */}
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-bold text-slate-800 dark:text-slate-200">{row.name || t("common.unknown")}</span>
            {row.priority !== undefined ? <Badge variant="outline" className="text-[10px] font-mono">P{row.priority}</Badge> : null}
            {row.prefix && row.name !== row.prefix ? <Badge variant="outline" className="font-mono text-[10px] text-blue-600 bg-blue-50">{row.prefix}</Badge> : null}
          </div>
          {row.entry["proxy-url"] ? (
            <span className="text-[11px] text-slate-400 font-mono truncate max-w-48">{t("providers.proxy")}: {String(row.entry["proxy-url"])}</span>
          ) : null}
        </div>
      </TableCell>

      {/* Address with copy button */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="block max-w-56 truncate font-mono text-xs text-slate-600 dark:text-slate-400" title={row.baseURL}>
            {row.baseURL || row.kind.defaultBase || t("providers.baseURLOptionalHint")}
          </span>
          <button
            type="button"
            onClick={copyBaseURL}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
            title={t("common.copy")}
          >
            {copiedBase ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </button>
        </div>
      </TableCell>

      {/* Models & Keys */}
      <TableCell>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 hover:text-purple-700 dark:text-purple-400 underline underline-offset-2"
          >
            <Cpu className="size-3" />
            <span>{row.modelCount > 0 ? t("providers.modelsPreview", { count: row.modelCount }) : t("providers.allModels")}</span>
          </button>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span className="text-slate-500 text-[11px] font-medium">{t("providers.keysCount_other", { count: row.keyCount })}</span>
        </div>
      </TableCell>

      {/* Status */}
      <TableCell className="text-center">
        {row.disabled ? (
          <Badge variant="outline" className="text-[10px] text-slate-400">{t("providers.disabledTag")}</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-emerald-600/80 border-emerald-500/20">{t("providers.ready")}</Badge>
        )}
      </TableCell>

      {/* Enable/Disable Switch */}
      <TableCell className="text-center">
        <Switch
          checked={!row.disabled}
          onCheckedChange={(checked) => onToggle(row, checked)}
          aria-label={t("providers.enabled")}
        />
      </TableCell>

      {/* Actions */}
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7.5 rounded-lg text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40"
            title={t("providers.debug")}
            onClick={() => navigate(`/playground?model=${encodeURIComponent(defaultModelName)}`)}
          >
            <Terminal className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-7.5 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title={t("providers.connect")}
            onClick={onOpenCurl}
          >
            <Code2 className="size-3.5" />
          </Button>

          <Button variant="ghost" size="sm" className="h-7.5 text-xs rounded-lg px-2" onClick={handleEdit}>
            {t("common.edit")}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 size-7.5 rounded-lg"
            title={t("common.delete")}
            onClick={() => onDelete(row)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
