import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowUpDown,
  Building2,
  Coins,
  Cpu,
  Download,
  Filter,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import bannerImage from "@/assets/dashboard-banner.png";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard, SampledBadge, RequestDBDisabled } from "@/components/shared/misc";
import { TimeRangeSelect } from "@/components/shared/time-range-select";
import { MultiSelectCombobox, type ComboboxOption } from "@/components/shared/multi-select-combobox";
import {
  intervalLabel,
  useBreakdownQuery,
  useStatsQuery,
  useTimeseriesQuery,
} from "@/hooks/use-analytics";
import {
  dayjs,
  downloadText,
  formatDuration,
  formatInt,
  formatNumber,
  formatPercent,
  formatTPS,
  formatUSD,
  toCSV,
} from "@/lib/format";
import { errStatus, type BreakdownRow } from "@/api/types";
import { usePrefsStore, type TimeRange } from "@/stores/prefs";
import type { RecordFilter } from "@/api/management";
import { ModelPricingDialog } from "@/components/model-pricing-dialog";

const chartConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  failed: { label: "Failed", color: "var(--chart-5)" },
  cost: { label: "Cost (USD)", color: "var(--chart-3)" },
  input_tokens: { label: "Input", color: "var(--chart-2)" },
  output_tokens: { label: "Output", color: "var(--chart-1)" },
  tps: { label: "TPS", color: "var(--chart-6)" },
  ttft: { label: "TTFT", color: "var(--chart-4)" },
  latency: { label: "Avg", color: "var(--chart-3)" },
  count: { label: "Requests", color: "var(--chart-6)" },
} satisfies ChartConfig;

type SortKey = "cost" | "requests" | "tokens" | "tps";

export function DashboardPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<TimeRange>({ preset: usePrefsStore.getState().defaultRange });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshMs = autoRefresh ? 30_000 : 0;

  // Multi-dimensional filters
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);

  // Manual Model Pricing Dialog State
  const [pricingModalOpen, setPricingModalOpen] = useState(false);
  const [pricingTargetModel, setPricingTargetModel] = useState<string>("");

  // Query options for comboboxes (unfiltered within the same time range)
  const baseRangeFilter = useMemo<RecordFilter>(() => ({}), []);
  const availableModelsQuery = useBreakdownQuery("model", range, baseRangeFilter, 0, 100);
  const availableProvidersQuery = useBreakdownQuery("provider", range, baseRangeFilter, 0, 50);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    return (availableModelsQuery.data ?? []).map((row) => ({
      label: row.key,
      value: row.key,
      count: row.requests,
    }));
  }, [availableModelsQuery.data]);

  const providerOptions = useMemo<ComboboxOption[]>(() => {
    return (availableProvidersQuery.data ?? []).map((row) => ({
      label: row.key,
      value: row.key,
      count: row.requests,
    }));
  }, [availableProvidersQuery.data]);

  // Sliced filter based on user selections
  const currentFilter = useMemo<RecordFilter>(() => {
    const filter: RecordFilter = {};
    if (selectedModels.length > 0) filter.models = selectedModels;
    if (selectedProviders.length > 0) filter.providers = selectedProviders;
    return filter;
  }, [selectedModels, selectedProviders]);

  const stats = useStatsQuery(range, currentFilter, refreshMs);
  const timeseries = useTimeseriesQuery(range, currentFilter, refreshMs);
  const models = useBreakdownQuery("model", range, currentFilter, refreshMs, 100);
  const providers = useBreakdownQuery("provider", range, currentFilter, refreshMs, 50);

  const clearAllFilters = () => {
    setSelectedModels([]);
    setSelectedProviders([]);
  };

  const observedModelNames = useMemo(() => {
    return (availableModelsQuery.data ?? []).map((row) => row.key);
  }, [availableModelsQuery.data]);

  const handleOpenPricing = (model?: string) => {
    setPricingTargetModel(model ?? "");
    setPricingModalOpen(true);
  };

  const hasActiveFilters = selectedModels.length > 0 || selectedProviders.length > 0;

  if (stats.error && errStatus(stats.error) === 503) {
    return (
      <>
        <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} />
        <RequestDBDisabled />
      </>
    );
  }

  const points = timeseries.data?.points ?? [];
  const step = timeseries.data?.interval_ms ?? 0;
  const stepLabel = intervalLabel(step);
  const timeRange = range.preset === "custom" || (timeseries.data && timeseries.data.to_ms - timeseries.data.from_ms > 4 * 86_400_000);
  const xTick = (value: number) => dayjs(value).format(timeRange ? "MM-DD" : "HH:mm");

  const totalReqs = stats.data?.total_requests ?? 0;
  const failedReqs = stats.data?.failed_requests ?? 0;
  const successRate = totalReqs > 0 ? (totalReqs - failedReqs) / totalReqs : 1;

  // Cache hit calculation
  const inTok = stats.data?.input_tokens ?? 0;
  const cachedTok = stats.data?.cached_tokens ?? 0;
  const promptTokens = inTok >= cachedTok ? inTok : inTok + cachedTok;
  const cacheHitRate = promptTokens > 0 ? cachedTok / promptTokens : 0;

  // Daily cost estimate based on range duration
  const rangeDurationDays = Math.max(
    1 / 24,
    ((timeseries.data?.to_ms ?? Date.now()) - (timeseries.data?.from_ms ?? Date.now() - 86400000)) / (86400000)
  );
  const totalCost = stats.data?.estimated_cost_usd ?? 0;
  const dailyCost = totalCost / rangeDurationDays;

  const updated = timeseries.isFetching ? null : (
    <span suppressHydrationWarning>{t("dashboard.refreshedAt", { time: dayjs().format("HH:mm:ss") })}</span>
  );

  return (
    <>
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")}>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-xl text-xs cursor-pointer text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
          onClick={() => handleOpenPricing()}
        >
          <Coins className="size-3.5 text-amber-500" />
          <span>{t("dashboard.pricing.button", "模型价格")}</span>
        </Button>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          {t("common.autoRefresh")}
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
        </label>
        <TimeRangeSelect value={range} onChange={setRange} />
        <Button
          variant="outline"
          size="icon"
          className="size-8 rounded-xl"
          onClick={() => {
            stats.refetch();
            timeseries.refetch();
            models.refetch();
            providers.refetch();
          }}
        >
          {stats.isFetching ? <Loader2 className="size-4 animate-spin text-blue-500" /> : <RefreshCw className="size-4" />}
        </Button>
      </PageHeader>

      {/* Interactive Multi-Select Filter Toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card/60 p-2.5 backdrop-blur-sm shadow-xs">
        <div className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
          <Filter className="size-3.5 text-primary" />
          <span>自由筛选</span>
        </div>

        {/* Model Multi-Select */}
        <MultiSelectCombobox
          placeholder={t("dashboard.filters.models", "筛选模型")}
          selected={selectedModels}
          onChange={setSelectedModels}
          options={modelOptions}
          icon={Cpu}
          searchPlaceholder="搜索模型..."
        />

        {/* Provider Multi-Select */}
        <MultiSelectCombobox
          placeholder={t("dashboard.filters.providers", "筛选供应商")}
          selected={selectedProviders}
          onChange={setSelectedProviders}
          options={providerOptions}
          icon={Building2}
          searchPlaceholder="搜索供应商..."
        />

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-rose-500 cursor-pointer"
          >
            <RotateCcw className="size-3" />
            <span>{t("dashboard.filters.reset", "重置筛选")}</span>
          </Button>
        ) : null}

        <div className="flex-1" />

        {/* Active Filter Chips */}
        {hasActiveFilters ? (
          <div className="flex flex-wrap items-center gap-1.5 pl-2">
            {selectedModels.map((m) => (
              <Badge
                key={m}
                variant="secondary"
                className="gap-1 border-primary/20 bg-primary/10 text-[11px] font-mono text-primary"
              >
                {m}
                <X
                  className="size-3 cursor-pointer opacity-70 hover:opacity-100"
                  onClick={() => setSelectedModels(selectedModels.filter((item) => item !== m))}
                />
              </Badge>
            ))}
            {selectedProviders.map((p) => (
              <Badge
                key={p}
                variant="secondary"
                className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-[11px] font-mono text-emerald-600 dark:text-emerald-400"
              >
                {p}
                <X
                  className="size-3 cursor-pointer opacity-70 hover:opacity-100"
                  onClick={() => setSelectedProviders(selectedProviders.filter((item) => item !== p))}
                />
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {/* Hero Welcome Banner */}
      <div className="mb-6 relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-6 text-slate-900 shadow-2xs dark:border-slate-800/80 dark:bg-slate-900/90 dark:text-slate-100">
        <div className="absolute right-8 -bottom-4 hidden sm:block">
          <img
            src={bannerImage}
            alt=""
            width={115}
            height={115}
            className="size-[115px] object-contain"
          />
        </div>
        <div className="relative z-10 max-w-xl pr-0 sm:pr-36">
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t("dashboard.heroTitle")}
          </h2>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed dark:text-slate-400">
            {t("dashboard.heroDesc")}
          </p>
        </div>
      </div>

      {/* 4 Core KPI StatCards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {/* Cost KPI */}
        <StatCard
          label={t("dashboard.kpi.cost", "预估总花费")}
          value={formatUSD(stats.data?.estimated_cost_usd)}
          sub={
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs">
                日均 ~{formatUSD(dailyCost)} · {formatInt(stats.data?.total_requests)} 次调用
              </span>
              <button
                type="button"
                onClick={() => handleOpenPricing()}
                className="cursor-pointer text-[10px] text-primary hover:underline ml-1"
                title="管理模型价格"
              >
                {t("dashboard.pricing.configurePrice", "设置价格")}
              </button>
            </div>
          }
          icon={Coins}
          loading={stats.isLoading}
        />

        {/* Requests & Success Rate */}
        <StatCard
          label={t("dashboard.kpi.requests")}
          value={formatInt(stats.data?.total_requests)}
          sub={
            <>
              <span className={failedReqs > 0 ? "text-amber-500 font-medium" : "text-emerald-500 font-medium"}>
                成功率 {formatPercent(successRate)}
              </span>
              <span className="text-muted-foreground ml-1.5">
                ({failedReqs} 失败 · {formatInt(stats.data?.stream_requests)} 流式)
              </span>
            </>
          }
          icon={Activity}
          loading={stats.isLoading}
        />

        {/* Tokens & Cache */}
        <StatCard
          label={t("dashboard.kpi.tokens")}
          value={formatNumber(stats.data?.total_tokens)}
          sub={
            <div className="font-mono text-[11px] truncate" title={`输入: ${formatInt(stats.data?.input_tokens)} | 输出: ${formatInt(stats.data?.output_tokens)} | 命中率: ${formatPercent(cacheHitRate)}`}>
              <span className="text-sky-500">入 {formatNumber(stats.data?.input_tokens)}</span>
              <span className="mx-1 text-muted-foreground/50">/</span>
              <span className="text-emerald-500">出 {formatNumber(stats.data?.output_tokens)}</span>
              <span className="mx-1 text-muted-foreground/50">·</span>
              <span className="text-foreground">命中 {formatPercent(cacheHitRate)}</span>
            </div>
          }
          icon={Layers}
          loading={stats.isLoading}
        />

        {/* Throughput & Latency */}
        <StatCard
          label={t("dashboard.kpi.tps")}
          value={formatTPS(stats.data?.tps_avg)}
          sub={
            <div className="font-mono text-[11px] truncate">
              <span>p50 {formatDuration(stats.data?.ttft_p50_ms)}</span>
              <span className="mx-1 text-muted-foreground/50">·</span>
              <span>均值 {formatDuration(stats.data?.latency_avg_ms)}</span>
              <SampledBadge sampled={Boolean(stats.data?.tps_sampled)} />
            </div>
          }
          icon={Gauge}
          loading={stats.isLoading}
        />
      </div>

      {/* Interactive Charts Section */}
      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Traffic Chart */}
        <SectionCard
          title={t("dashboard.charts.traffic")}
          hint={t("dashboard.charts.trafficHint", { interval: stepLabel })}
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={points.length === 0}
              onClick={() => downloadText(`cpa-traffic-${range.preset}.csv`, exportTimeseries(points))}
            >
              <Download className="mr-1 size-3.5" />
              {t("common.export")}
            </Button>
          }
        >
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <AreaChart data={points} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={38} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value, name) => (
                      <span className="font-mono">
                        {formatInt(Number(value))} {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                      </span>
                    )}
                  />
                }
              />
              <Area dataKey="failed" stroke="var(--color-failed)" fill="var(--color-failed)" fillOpacity={0.25} strokeWidth={1.5} />
              <Area dataKey="requests" stroke="var(--color-requests)" fill="var(--color-requests)" fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </SectionCard>

        {/* Cost Trend Chart */}
        <SectionCard
          title={t("dashboard.charts.cost", "费用消耗走势")}
          hint={t("dashboard.charts.costHint", "按模型单价每 {{interval}} 预估消费 (USD)", { interval: stepLabel })}
        >
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <AreaChart data={points} margin={{ left: 4, right: 8 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatUSD(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value) => (
                      <span className="font-mono text-sky-500 font-semibold">
                        {formatUSD(Number(value))}
                      </span>
                    )}
                  />
                }
              />
              <Area dataKey="estimated_cost_usd" name="cost" stroke="#0ea5e9" fill="url(#costGradient)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </SectionCard>

        {/* Token Input vs Output Stacked Chart */}
        <SectionCard title={t("dashboard.charts.tokens")} hint={t("dashboard.charts.tokensHint", { interval: stepLabel })}>
          <ChartContainer config={chartConfig} className="h-60 w-full">
            <AreaChart data={points} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={38} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value, name) => (
                      <span className="font-mono">
                        {formatNumber(Number(value))} {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                      </span>
                    )}
                  />
                }
              />
              <Area dataKey="input_tokens" stackId="tokens" stroke="var(--color-input_tokens)" fill="var(--color-input_tokens)" fillOpacity={0.3} strokeWidth={1.5} />
              <Area dataKey="output_tokens" stackId="tokens" stroke="var(--color-output_tokens)" fill="var(--color-output_tokens)" fillOpacity={0.3} strokeWidth={1.5} />
            </AreaChart>
          </ChartContainer>
        </SectionCard>

        {/* Latency and TTFT Chart */}
        <SectionCard title={t("dashboard.charts.latency")} hint={t("dashboard.charts.latencyHint")}>
          <ChartContainer config={chartConfig} className="h-60 w-full">
            <LineChart data={points} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatDuration(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value) => <span className="font-mono">{formatDuration(Number(value))}</span>}
                  />
                }
              />
              {stats.data && stats.data.latency_p50_ms > 0 && (
                <ReferenceLine y={stats.data.latency_p50_ms} stroke="var(--color-latency)" strokeDasharray="4 4" strokeOpacity={0.7} />
              )}
              {stats.data && stats.data.latency_p99_ms > 0 && (
                <ReferenceLine y={stats.data.latency_p99_ms} stroke="var(--color-failed)" strokeDasharray="4 4" strokeOpacity={0.7} />
              )}
              <Line dataKey="latency_avg_ms" stroke="var(--color-latency)" strokeWidth={2} dot={false} name="avg" />
              <Line dataKey="ttft_avg_ms" stroke="var(--color-ttft)" strokeWidth={2} strokeDasharray="3 3" dot={false} name="ttft" />
            </LineChart>
          </ChartContainer>
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 text-xs">
            <span>p50 {formatDuration(stats.data?.latency_p50_ms)}</span>
            <span>p90 {formatDuration(stats.data?.latency_p90_ms)}</span>
            <span>p99 {formatDuration(stats.data?.latency_p99_ms)}</span>
            <SampledBadge sampled={Boolean(stats.data?.latency_sampled)} />
          </div>
        </SectionCard>
      </div>

      {/* Comprehensive Analytics Breakdown Table */}
      <div className="mt-6">
        <ComprehensiveBreakdownTable
          modelRows={models.data}
          providerRows={providers.data}
          modelsLoading={models.isLoading}
          providersLoading={providers.isLoading}
          totalRequests={stats.data?.total_requests ?? 0}
          onConfigureModelPrice={handleOpenPricing}
        />
      </div>

      <ModelPricingDialog
        open={pricingModalOpen}
        onOpenChange={setPricingModalOpen}
        initialModel={pricingTargetModel}
        observedModels={observedModelNames}
      />

      {updated ? <p className="text-muted-foreground mt-4 text-center text-xs">{updated}</p> : null}
    </>
  );
}

// ---------------------------------------------------------------- Comprehensive Breakdown Table

interface ComprehensiveBreakdownTableProps {
  modelRows: BreakdownRow[] | undefined;
  providerRows: BreakdownRow[] | undefined;
  modelsLoading: boolean;
  providersLoading: boolean;
  totalRequests: number;
  onConfigureModelPrice?: (model: string) => void;
}

function ComprehensiveBreakdownTable({
  modelRows,
  providerRows,
  modelsLoading,
  providersLoading,
  totalRequests,
  onConfigureModelPrice,
}: ComprehensiveBreakdownTableProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"model" | "provider">("model");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortAsc, setSortAsc] = useState(false);

  const rawRows = activeTab === "model" ? modelRows : providerRows;
  const loading = activeTab === "model" ? modelsLoading : providersLoading;

  const filteredAndSortedRows = useMemo(() => {
    let list = [...(rawRows ?? [])];
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter((r) => r.key.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let valA = 0;
      let valB = 0;
      switch (sortKey) {
        case "cost":
          valA = a.estimated_cost_usd ?? 0;
          valB = b.estimated_cost_usd ?? 0;
          break;
        case "requests":
          valA = a.requests;
          valB = b.requests;
          break;
        case "tokens":
          valA = a.total_tokens;
          valB = b.total_tokens;
          break;
        case "tps":
          valA = a.tps_avg;
          valB = b.tps_avg;
          break;
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return list;
  }, [rawRows, searchTerm, sortKey, sortAsc]);

  const maxRequests = Math.max(...(rawRows ?? []).map((r) => r.requests), 1);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const handleExportCSV = () => {
    const headers = [
      activeTab === "model" ? "Model" : "Provider",
      "Cost_USD",
      "Requests",
      "Failed",
      "Success_Rate",
      "Input_Tokens",
      "Output_Tokens",
      "Reasoning_Tokens",
      "Cache_Read_Tokens",
      "Total_Tokens",
      "Avg_Latency_ms",
      "Avg_TPS",
    ];

    const rows = filteredAndSortedRows.map((r) => [
      r.key,
      (r.estimated_cost_usd ?? 0).toFixed(4),
      r.requests,
      r.failed,
      r.requests > 0 ? (((r.requests - r.failed) / r.requests) * 100).toFixed(1) + "%" : "100%",
      r.input_tokens,
      r.output_tokens,
      r.reasoning_tokens ?? 0,
      r.cache_read_tokens ?? 0,
      r.total_tokens,
      r.latency_avg_ms.toFixed(1),
      r.tps_avg.toFixed(2),
    ]);

    downloadText(`cpa-${activeTab}-analytics.csv`, toCSV(headers, rows));
  };

  return (
    <div className="card-surface overflow-hidden">
      {/* Table Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
        <div className="flex items-center gap-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "model" | "provider")}>
            <TabsList className="h-8">
              <TabsTrigger value="model" className="h-6 px-3 text-xs">
                {t("dashboard.breakdown.byModel", "按模型明细")}
              </TabsTrigger>
              <TabsTrigger value="provider" className="h-6 px-3 text-xs">
                {t("dashboard.breakdown.byProvider", "按供应商明细")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <span className="text-muted-foreground text-xs font-mono">
            {filteredAndSortedRows.length} 项
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Table Search */}
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-2.5 size-3.5" />
            <Input
              placeholder={t("dashboard.breakdown.search", "搜索...")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 w-44 pl-8 text-xs sm:w-56"
            />
            {searchTerm ? (
              <X
                className="text-muted-foreground hover:text-foreground absolute right-2.5 top-2.5 size-3.5 cursor-pointer"
                onClick={() => setSearchTerm("")}
              />
            ) : null}
          </div>

          {/* Model Pricing Shortcut Button */}
          {activeTab === "model" && onConfigureModelPrice && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onConfigureModelPrice("")}
              className="h-8 gap-1.5 text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10 cursor-pointer"
            >
              <Coins className="size-3.5 text-amber-500" />
              <span>{t("dashboard.pricing.button", "模型价格")}</span>
            </Button>
          )}

          {/* Export CSV */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={filteredAndSortedRows.length === 0}
            className="h-8 gap-1.5 text-xs"
          >
            <Download className="size-3.5" />
            <span>{t("common.export", "导出 CSV")}</span>
          </Button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-xs table-fixed">
          <thead>
            <tr className="text-muted-foreground border-b border-border/60 bg-muted/20 text-left">
              <th className="py-2.5 pl-4 font-medium w-auto">{t("dashboard.table.key", "名称")}</th>
              <th
                onClick={() => toggleSort("cost")}
                className="py-2.5 text-right font-medium w-28 cursor-pointer hover:text-primary transition-colors select-none"
              >
                <div className="inline-flex items-center gap-1 justify-end">
                  <span>{t("dashboard.breakdown.cost", "预估费用")}</span>
                  <ArrowUpDown className={`size-3 ${sortKey === "cost" ? "text-primary" : "opacity-40"}`} />
                </div>
              </th>
              <th
                onClick={() => toggleSort("requests")}
                className="py-2.5 text-right font-medium w-28 cursor-pointer hover:text-primary transition-colors select-none"
              >
                <div className="inline-flex items-center gap-1 justify-end">
                  <span>{t("dashboard.table.requests", "请求次数")}</span>
                  <ArrowUpDown className={`size-3 ${sortKey === "requests" ? "text-primary" : "opacity-40"}`} />
                </div>
              </th>
              <th className="py-2.5 text-right font-medium w-20">{t("dashboard.kpi.successRate", "成功率")}</th>
              <th className="py-2.5 text-right font-medium w-24">{t("dashboard.breakdown.inputTokens", "输入 Tokens")}</th>
              <th className="py-2.5 text-right font-medium w-24">{t("dashboard.breakdown.outputTokens", "输出 Tokens")}</th>
              <th className="py-2.5 text-right font-medium w-24">{t("dashboard.breakdown.reasoningTokens", "思考 Tokens")}</th>
              <th className="py-2.5 text-right font-medium w-24">{t("dashboard.breakdown.cacheRead", "缓存读取")}</th>
              <th className="py-2.5 text-right font-medium w-20">{t("dashboard.breakdown.cacheHit", "命中率")}</th>
              <th className="py-2.5 text-right font-medium w-20">{t("dashboard.table.avgLatency", "平均耗时")}</th>
              <th
                onClick={() => toggleSort("tps")}
                className="py-2.5 pr-4 text-right font-medium w-20 cursor-pointer hover:text-primary transition-colors select-none"
              >
                <div className="inline-flex items-center gap-1 justify-end">
                  <span>{t("dashboard.table.tps", "平均 TPS")}</span>
                  <ArrowUpDown className={`size-3 ${sortKey === "tps" ? "text-primary" : "opacity-40"}`} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span>{t("common.loading", "加载中...")}</span>
                  </div>
                </td>
              </tr>
            ) : filteredAndSortedRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-muted-foreground">
                  {t("dashboard.charts.empty", "该条件下暂无数据")}
                </td>
              </tr>
            ) : (
              filteredAndSortedRows.map((row) => {
                const reqShare = totalRequests > 0 ? (row.requests / totalRequests) * 100 : 0;
                const errRate = row.requests > 0 ? row.failed / row.requests : 0;
                const succRate = 1 - errRate;

                // Cache hit rate calculation for row
                const inTok = row.input_tokens || 0;
                const cacheRead = row.cache_read_tokens || 0;
                const promptTotal = inTok >= cacheRead ? inTok : inTok + cacheRead;
                const hitRate = promptTotal > 0 ? (cacheRead / promptTotal) * 100 : 0;

                return (
                  <tr key={row.key} className="border-b border-border/50 hover:bg-secondary/40 transition-colors">
                    {/* Model/Provider Name with volume bar */}
                    <td className="py-2.5 pl-4 overflow-hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="bg-primary/15 h-1.5 w-10 shrink-0 overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${(row.requests / maxRequests) * 100}%` }}
                          />
                        </div>
                        <span className="truncate font-mono text-[11px] font-medium" title={row.key}>
                          {row.key}
                        </span>
                      </div>
                    </td>

                    {/* Cost */}
                    <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-sky-600 dark:text-sky-400">
                      <div className="flex items-center justify-end gap-1.5">
                        <span>{formatUSD(row.estimated_cost_usd)}</span>
                        {activeTab === "model" && onConfigureModelPrice && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onConfigureModelPrice(row.key);
                            }}
                            title={
                              (row.estimated_cost_usd ?? 0) === 0
                                ? "外部来源未收录或单价为 0，点击手动设置价格"
                                : "点击调整该模型单价"
                            }
                            aria-label={t("dashboard.pricing.configurePrice", "设置价格")}
                            className={`cursor-pointer inline-flex items-center justify-center rounded p-1 text-[10px] font-sans font-normal transition-all ${
                              (row.estimated_cost_usd ?? 0) === 0
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 font-medium shadow-2xs"
                                : "text-muted-foreground/60 hover:text-primary hover:bg-primary/10"
                            }`}
                          >
                            <Coins className="size-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Requests & Share */}
                    <td className="py-2.5 text-right font-mono tabular-nums">
                      <span>{formatInt(row.requests)}</span>
                      <span className="text-muted-foreground ml-1 text-[10px]">
                        ({reqShare.toFixed(1)}%)
                      </span>
                    </td>

                    {/* Success Rate */}
                    <td
                      className={`py-2.5 text-right font-mono tabular-nums ${
                        errRate > 0.05 ? "text-rose-500 font-medium" : "text-emerald-500"
                      }`}
                    >
                      {formatPercent(succRate)}
                    </td>

                    {/* Input Tokens */}
                    <td className="py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {formatNumber(row.input_tokens)}
                    </td>

                    {/* Output Tokens */}
                    <td className="py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {formatNumber(row.output_tokens)}
                    </td>

                    {/* Reasoning Tokens */}
                    <td className="py-2.5 text-right font-mono tabular-nums text-orange-500 dark:text-orange-400">
                      {row.reasoning_tokens ? formatNumber(row.reasoning_tokens) : "—"}
                    </td>

                    {/* Cache Read Tokens */}
                    <td className="py-2.5 text-right font-mono tabular-nums text-sky-500">
                      {row.cache_read_tokens ? formatNumber(row.cache_read_tokens) : "—"}
                    </td>

                    {/* Cache Hit Rate */}
                    <td className="py-2.5 text-right font-mono tabular-nums">
                      {hitRate > 0 ? `${hitRate.toFixed(1)}%` : "0%"}
                    </td>

                    {/* Avg Latency */}
                    <td className="py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {formatDuration(row.latency_avg_ms)}
                    </td>

                    {/* Avg TPS */}
                    <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                      {formatTPS(row.tps_avg)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Timeseries Export helper

function exportTimeseries(
  points: {
    bucket_ms: number;
    requests: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd?: number;
    latency_avg_ms: number;
    tps_avg: number;
  }[]
) {
  return toCSV(
    ["time", "cost_usd", "requests", "failed", "input_tokens", "output_tokens", "total_tokens", "latency_avg_ms", "tps_avg"],
    points.map((p) => [
      dayjs(p.bucket_ms).format("YYYY-MM-DD HH:mm:ss"),
      (p.estimated_cost_usd ?? 0).toFixed(4),
      p.requests,
      p.failed,
      p.input_tokens,
      p.output_tokens,
      p.total_tokens,
      p.latency_avg_ms.toFixed(1),
      p.tps_avg.toFixed(2),
    ])
  );
}
