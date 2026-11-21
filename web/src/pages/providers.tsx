import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Ellipsis,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
  ServerOff,
  Terminal,
  Trash2,
  X,
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
import { StatCard } from "@/components/shared/stat-card";
import { CompatEditorSheet, type CompatProvider } from "@/components/providers/compat-editor";
import { KeyEntryEditorSheet } from "@/components/providers/key-entry-editor";
import { AccessKeysDialog, ExcludedModelsDialog, ModelAliasDialog } from "@/components/providers/secondary-editors";
import { ProviderCurlDialog, ProviderModelsDialog } from "@/components/providers/provider-dialogs";
import type { ModelEntry } from "@/components/providers/model-editor";
import {
  ALL_KINDS,
  COMPAT_KIND,
  KIND_COLORS,
  KIND_ICONS,
  type Entry,
  type KindMeta,
} from "@/components/providers/provider-tools";
import { apiKeyProviders } from "@/api/management";
import { errMessage } from "@/api/types";

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
const STORAGE_KEY_PROVIDERS_LAST_KIND = "cpa-providers-last-kind";

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
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [lastKindId, setLastKindId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PROVIDERS_LAST_KIND);
      if (saved && ALL_KINDS.some((k) => k.id === saved)) {
        return saved;
      }
    } catch {
      // ignore
    }
    return COMPAT_KIND.id;
  });

  const effectiveAddKind = useMemo<KindMeta>(() => {
    if (kindFilter !== "all") {
      const matched = ALL_KINDS.find((k) => k.id === kindFilter);
      if (matched) return matched;
    }
    return ALL_KINDS.find((k) => k.id === lastKindId) ?? COMPAT_KIND;
  }, [kindFilter, lastKindId]);

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
        const isDisabled = Boolean(entry.disabled) || excludedList.some((m) => String(m).trim() === "*");

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

  const addProvider = (kind: KindMeta, seed?: { name?: string; baseURL?: string }) => {
    setLastKindId(kind.id);
    try {
      localStorage.setItem(STORAGE_KEY_PROVIDERS_LAST_KIND, kind.id);
    } catch {
      // ignore
    }
    setAddMenuOpen(false);
    const seedName = seed?.name?.trim() ?? "";
    const seedBase = seed?.baseURL?.trim() ?? "";
    if (kind.id === "openai-compatibility") {
      setKeyEditing(null);
      setCompatEditing({
        index: -1,
        provider: { name: seedName, "base-url": seedBase, models: [] },
      });
    } else {
      setCompatEditing(null);
      setKeyEditing({
        kind,
        index: -1,
        entry: {
          ...(seedName ? { name: seedName } : {}),
          "api-key": "",
          "base-url": seedBase,
        },
      });
    }
  };

  const deleteRow = (row: ProviderRow) => {
    persist.mutate({ kind: row.kind, index: row.index, entry: null });
    setPendingDelete(null);
  };

  const toggleDisabled = (row: ProviderRow, enabled: boolean) => {
    const currentExcluded = ((row.entry["excluded-models"] as string[] | undefined) ?? [])
      .map((m) => String(m).trim())
      .filter((m) => Boolean(m) && m !== "*");
    const { disabled: _dropDisabled, "excluded-models": _dropExcluded, ...rest } = row.entry;
    const nextEntry: Entry = {
      ...rest,
      ...(currentExcluded.length > 0 ? { "excluded-models": currentExcluded } : {}),
      ...(!enabled ? { disabled: true } : {}),
    };
    persist.mutate({ kind: row.kind, index: row.index, entry: nextEntry });
  };

  return (
    <>
      <PageHeader title={t("nav.providersItem")} subtitle={t("providers.subtitle")} />

      {/* Top Overview Metrics Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label={t("providers.stats.totalProviders")}
          value={totalCount}
          sub={t("providers.stats.enabledBreakdown", { enabled: enabledCount, disabled: disabledCount })}
          icon={Boxes}
        />
        <StatCard
          label={t("providers.stats.activeKeys")}
          value={totalKeysCount}
          sub={t("providers.stats.loadBalancing")}
          icon={KeyRound}
        />
        <StatCard
          label={t("providers.stats.modelsCount")}
          value={totalModelsCount}
          sub={t("providers.stats.modelsSubtitle")}
          icon={Cpu}
        />
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
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            className="h-9 w-60 sm:w-72 rounded-lg pl-8.5 pr-7 text-xs bg-card border-border"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("providers.searchPlaceholder")}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* Status Filter Segmented Buttons */}
        <div className="flex h-9 items-center rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 h-full text-xs font-medium rounded-md transition-colors ${
              statusFilter === "all" ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("providers.filter.allStatus")}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("enabled")}
            className={`px-2.5 h-full text-xs font-medium rounded-md transition-colors ${
              statusFilter === "enabled" ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("providers.filter.onlyEnabled")}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("disabled")}
            className={`px-2.5 h-full text-xs font-medium rounded-md transition-colors ${
              statusFilter === "disabled" ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("providers.filter.onlyDisabled")}
          </button>
        </div>

        {/* Sort Mode Dropdown */}
        <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
          <SelectTrigger className="h-9 w-36 rounded-lg text-xs bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-lg">
            <SelectItem value="enabled">{t("providers.sort.enabledFirst") || "优先已启用"}</SelectItem>
            <SelectItem value="priority">{t("providers.sort.priority") || "按优先级"}</SelectItem>
            <SelectItem value="name">{t("providers.sort.name") || "按名称"}</SelectItem>
          </SelectContent>
        </Select>

        {/* View Mode Toggle (Cards vs Table) */}
        <div className="flex h-9 items-center rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => handleViewModeChange("cards")}
            className={`flex size-7.5 items-center justify-center rounded-md transition-colors ${
              viewMode === "cards" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            title="卡片视图"
          >
            <LayoutGrid className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange("table")}
            className={`flex size-7.5 items-center justify-center rounded-md transition-colors ${
              viewMode === "table" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
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
              <Button variant="outline" size="sm" className="h-9 rounded-lg text-xs bg-card border-border">
                <Ellipsis className="size-3.5" />
                <span>{t("providers.more")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-lg">
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

          {/* Add Provider Split Button: 1-Click Direct Add + Spacious 2-Column Visual Kind Grid */}
          <div className="inline-flex items-center rounded-lg shadow-2xs">
            <Button
              size="sm"
              onClick={() => addProvider(effectiveAddKind)}
              className="h-9 gap-1.5 rounded-l-lg rounded-r-none bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
            >
              <Plus className="size-3.5" />
              <span>{t("providers.addKind", { kind: t(`providers.kind.${effectiveAddKind.labelKey}`) })}</span>
            </Button>

            <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  aria-label={t("providers.selectKind")}
                  title={t("providers.selectKind")}
                  className="h-9 rounded-l-none rounded-r-lg border-l border-primary-foreground/20 bg-primary px-2.5 text-primary-foreground hover:bg-primary/90 cursor-pointer"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[340px] sm:w-[400px] rounded-xl p-3 shadow-xl">
                <div className="px-1 pb-2">
                  <p className="text-xs font-bold text-foreground">{t("providers.addProvider")}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t("providers.switchKindHint")}</p>
                </div>
                <DropdownMenuSeparator className="mb-2.5" />
                <div className="grid grid-cols-2 gap-2">
                  {ALL_KINDS.map((kind) => {
                    const Icon = KIND_ICONS[kind.id] ?? Boxes;
                    const colors = KIND_COLORS[kind.id] ?? KIND_COLORS["openai-compatibility"]!;
                    const isDefault = kind.id === effectiveAddKind.id;
                    return (
                      <button
                        key={kind.id}
                        type="button"
                        onClick={() => addProvider(kind)}
                        className={`group relative flex min-h-[56px] cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all ${
                          isDefault
                            ? "border-primary bg-primary/8 text-foreground ring-1 ring-primary/30 shadow-2xs"
                            : "border-border/70 bg-card hover:border-primary/40 hover:bg-accent/60"
                        }`}
                      >
                        <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl border ${colors.bg} ${colors.text} ${colors.border}`}>
                          <Icon className="size-4.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs sm:text-[13px] leading-snug ${isDefault ? "font-bold text-primary" : "font-semibold text-foreground"}`}>
                            {t(`providers.kind.${kind.labelKey}`)}
                          </p>
                          {isDefault ? (
                            <span className="mt-0.5 inline-block text-[10px] font-medium text-primary/80">
                              {t("providers.defaultKindBadge")}
                            </span>
                          ) : null}
                        </div>
                        {isDefault ? (
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-2.5 stroke-[3]" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
          onSelectKind={compatEditing.index < 0 ? (nextKind, seed) => addProvider(nextKind, seed) : undefined}
          onSave={(next) => {
            persist.mutate({ kind: COMPAT_KIND, index: compatEditing.index, entry: next as Entry });
            setCompatEditing(null);
          }}
        />
      ) : null}

      {keyEditing ? (
        <KeyEntryEditorSheet
          key={keyEditing.kind.id}
          kind={keyEditing.kind}
          entry={keyEditing.entry}
          isNew={keyEditing.index < 0}
          onClose={() => setKeyEditing(null)}
          onSelectKind={keyEditing.index < 0 ? (nextKind, seed) => addProvider(nextKind, seed) : undefined}
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
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors duration-150 cursor-pointer ${
        active
          ? "border-foreground/15 bg-foreground text-background font-medium"
          : "border-border bg-card text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      <span className={`rounded px-1.5 text-[10px] tabular-nums font-mono font-medium ${active ? "bg-background/15 text-background" : "bg-muted text-muted-foreground"}`}>
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
      className={`card-surface flex flex-col justify-between p-5 transition-colors duration-150 hover:border-foreground/20 ${
        row.disabled ? "opacity-60 bg-muted/30" : ""
      }`}
    >
      <div className="space-y-4">
        {/* Card Header: Type Pill & Enable Switch */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`flex size-7.5 items-center justify-center rounded-lg border ${color.bg} ${color.text} ${color.border}`}>
              <Icon className="size-3.5" />
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-foreground">
                {t(`providers.kind.${row.kind.labelKey}`)}
              </span>
              {row.priority !== undefined && (
                <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground border-border">
                  P{row.priority}
                </Badge>
              )}
            </div>
          </div>

          {/* Quick Enable/Disable switch right on the card */}
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${
                row.disabled
                  ? "bg-muted-foreground/40"
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
            <h4
              onClick={handleEdit}
              className="truncate font-semibold text-sm text-foreground cursor-pointer hover:text-primary transition-colors"
              title={row.name}
            >
              {row.name || t("common.unknown")}
            </h4>

            {row.disabled ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                {t("providers.disabledTag")}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/25 bg-emerald-500/5">
                {t("providers.ready")}
              </Badge>
            )}
          </div>

          {/* Base URL with dedicated 1-click Copy button */}
          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 border border-border/70 px-3 py-1.5 text-xs font-mono text-muted-foreground">
            <span className="truncate flex-1" title={row.baseURL}>
              {row.baseURL || row.kind.defaultBase || t("providers.baseURLOptionalHint")}
            </span>
            <button
              type="button"
              onClick={copyBaseURL}
              className="text-muted-foreground/70 hover:text-foreground transition shrink-0 cursor-pointer"
              title={t("common.copy")}
            >
              {copiedBase ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </button>
          </div>
        </div>

        {/* Interactive Feature Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {/* Models Pill (Click to open Model Inspector dialog!) */}
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary/70 hover:bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors border border-border/70 cursor-pointer"
            title={t("providers.modelsList")}
          >
            <Cpu className="size-3 text-muted-foreground" />
            <span>{row.modelCount > 0 ? t("providers.modelsPreview", { count: row.modelCount }) : t("providers.allModels")}</span>
            <ChevronRight className="size-3 text-muted-foreground/70" />
          </button>

          {/* Keys Count Pill */}
          <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground border border-border/70">
            <KeyRound className="size-3 text-muted-foreground" />
            <span>{t("providers.keysCount_other", { count: row.keyCount })}</span>
          </span>

          {/* Prefix Pill */}
          {row.prefix && (
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary/70 px-2 py-1 font-mono text-[10px] text-muted-foreground border border-border/70">
              {t("providers.fieldPrefix")}: {row.prefix}
            </span>
          )}

          {/* Proxy Pill */}
          {Boolean(row.entry["proxy-url"]) && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-secondary/70 px-2 py-1 font-mono text-[10px] text-muted-foreground border border-border/70 truncate max-w-44"
              title={String(row.entry["proxy-url"])}
            >
              {t("providers.proxy")}: {String(row.entry["proxy-url"])}
            </span>
          )}
        </div>
      </div>

      {/* Card Footer Actions: Rich & Effortless */}
      <div className="flex items-center justify-between border-t border-border/60 pt-3 mt-4">
        <div className="flex items-center gap-1">
          {/* One-click Playground Test */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7.5 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground rounded-md"
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
            className="h-7.5 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground rounded-md"
            onClick={onOpenCurl}
            title={t("providers.connect")}
          >
            <Code2 className="size-3.5" />
            <span>{t("providers.connect")}</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7.5 text-xs rounded-md px-2.5" onClick={handleEdit}>
            {t("common.edit")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7.5 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10"
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
            <span
              onClick={handleEdit}
              className="truncate font-bold text-foreground cursor-pointer hover:text-primary transition-colors"
            >
              {row.name || t("common.unknown")}
            </span>
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
