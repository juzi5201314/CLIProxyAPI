import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Database,
  Eraser,
  ExternalLink,
  HardDrive,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Scissors,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton, RequestDBDisabled } from "@/components/shared/misc";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { TimeRangeSelect } from "@/components/shared/time-range-select";
import { requestDB } from "@/api/management";
import { errMessage, errStatus, type RequestDBCleanOptions, type RequestDBCleanResult } from "@/api/types";
import {
  dayjs,
  formatBytes,
  formatFullTime,
  formatInt,
  formatTime,
  formatTokens,
  formatUSD,
  fromNow,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { resolveRange, type TimeRange, usePrefsStore } from "@/stores/prefs";

interface ConfirmDialogState {
  open: boolean;
  action: RequestDBCleanOptions["action"];
  title: string;
  desc: string;
  requiresClearInput?: boolean;
  params: RequestDBCleanOptions;
}

const DEFAULT_CONFIRM_STATE: ConfirmDialogState = {
  open: false,
  action: "strip_payloads",
  title: "",
  desc: "",
  params: { action: "strip_payloads" },
};

export function RequestDBPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Storage metrics query
  const storageQuery = useQuery({
    queryKey: ["request-db", "storage"],
    queryFn: requestDB.storage,
    refetchInterval: 20_000,
  });

  // Time Range Explorer state & query
  const [explorerRange, setExplorerRange] = useState<TimeRange>({
    preset: usePrefsStore.getState().defaultRange,
  });

  const resolvedRange = useMemo(() => resolveRange(explorerRange), [explorerRange]);

  const explorerStatsQuery = useQuery({
    queryKey: ["request-db", "explorer-stats", resolvedRange.from, resolvedRange.to],
    queryFn: () =>
      requestDB.stats({
        from: resolvedRange.from,
        to: explorerRange.preset === "custom" ? resolvedRange.to : undefined,
      }),
    enabled: storageQuery.data?.enabled !== false,
  });

  // Cleanup parameter states
  const [stripDays, setStripDays] = useState<number>(7);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [capSizeMB, setCapSizeMB] = useState<number>(100);
  const [autoVacuum, setAutoVacuum] = useState<boolean>(true);

  // Dialog & Execution states
  const [confirmState, setConfirmState] = useState<ConfirmDialogState>(DEFAULT_CONFIRM_STATE);
  const [clearInput, setClearInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<RequestDBCleanResult | null>(null);

  const storage = storageQuery.data;

  // Handle service disabled
  if (
    storageQuery.error &&
    errStatus(storageQuery.error) === 503
  ) {
    return <RequestDBDisabled />;
  }

  const handleRefresh = async () => {
    await Promise.all([storageQuery.refetch(), explorerStatsQuery.refetch()]);
    toast.success(t("common.refresh"));
  };

  const openConfirm = (opts: {
    action: RequestDBCleanOptions["action"];
    title: string;
    desc: string;
    requiresClearInput?: boolean;
    params: RequestDBCleanOptions;
  }) => {
    setClearInput("");
    setConfirmState({
      open: true,
      action: opts.action,
      title: opts.title,
      desc: opts.desc,
      requiresClearInput: opts.requiresClearInput,
      params: opts.params,
    });
  };

  const executeClean = async () => {
    setIsExecuting(true);
    try {
      const res = await requestDB.clean(confirmState.params);
      setLastResult(res);
      setConfirmState(DEFAULT_CONFIRM_STATE);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["request-db"] }),
        queryClient.invalidateQueries({ queryKey: ["rdb"] }),
      ]);
      const savedBytes = res.file_size_bytes_before - res.file_size_bytes_after;
      const savedMsg = savedBytes > 0 ? ` (${formatBytes(savedBytes)})` : "";
      toast.success(
        `${t("requestDb.dialog.successTitle")}: ${t("requestDb.dialog.affectedRows", { count: res.affected_rows })}${savedMsg}`
      );
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setIsExecuting(false);
    }
  };

  // Derived metrics
  const totalDiskBytes = storage?.total_file_size_bytes ?? 0;
  const mainDbBytes = storage?.file_size_bytes ?? 0;
  const walBytes = storage?.wal_size_bytes ?? 0;
  const compressedBytes = storage?.compressed_payload_bytes ?? 0;
  const theoreticalBytes = storage?.estimated_uncompressed_bytes ?? 0;
  const ratio = storage?.compression_ratio ?? 1;
  const savingPct =
    theoreticalBytes > 0 && theoreticalBytes > compressedBytes
      ? Math.round(((theoreticalBytes - compressedBytes) / theoreticalBytes) * 100)
      : 0;

  const totalRecords = storage?.total_records ?? 0;
  const failedRecords = storage?.failed_records ?? 0;
  const payloadRecords = storage?.payload_records ?? 0;

  const earliestMS = storage?.earliest_record_ms;
  const latestMS = storage?.latest_record_ms;
  const timespanDays =
    earliestMS && latestMS ? Math.max(1, dayjs(latestMS).diff(dayjs(earliestMS), "day")) : 0;

  // Explorer metrics
  const explorerTotalReqs = explorerStatsQuery.data?.total_requests ?? 0;
  const explorerFailedReqs = explorerStatsQuery.data?.failed_requests ?? 0;
  const explorerSharePct =
    totalRecords > 0 ? Math.min(100, Math.round((explorerTotalReqs / totalRecords) * 1000) / 10) : 0;
  const explorerEstimatedBytes =
    totalRecords > 0 ? Math.round((explorerTotalReqs / totalRecords) * totalDiskBytes) : 0;

  return (
    <>
      <PageHeader title={t("requestDb.title")} subtitle={t("requestDb.subtitle")}>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => navigate("/request-logs")}
        >
          <Activity className="size-3.5" />
          {t("requestDb.viewLogs")}
          <ExternalLink className="size-3 text-muted-foreground" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleRefresh}
          disabled={storageQuery.isFetching}
        >
          <RefreshCw className={cn("size-3.5", storageQuery.isFetching && "animate-spin")} />
          {t("requestDb.refresh")}
        </Button>
      </PageHeader>

      {/* Result feedback banner if clean was executed */}
      {lastResult && (
        <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 text-sm text-foreground flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-900 dark:text-emerald-300">
                {t("requestDb.dialog.successTitle")} — {lastResult.action}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("requestDb.dialog.affectedRows", { count: lastResult.affected_rows })} ·{" "}
                {t("requestDb.dialog.sizeReduced", {
                  before: formatBytes(lastResult.file_size_bytes_before),
                  after: formatBytes(lastResult.file_size_bytes_after),
                })}
                {lastResult.vacuum_run && ` · ${t("requestDb.dialog.vacuumCompleted")}`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setLastResult(null)}
          >
            {t("common.close")}
          </Button>
        </div>
      )}

      {/* Status & Database Info Bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 px-5 py-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
          <Badge
            variant="outline"
            className={cn(
              "font-medium gap-1 px-2.5 py-0.5",
              storage?.enabled
                ? "border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                : "border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                storage?.enabled ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
              )}
            />
            {storage?.enabled ? t("requestDb.statusEnabled") : t("requestDb.statusDisabled")}
          </Badge>

          {storage?.path && (
            <div className="flex items-center gap-1.5 text-muted-foreground font-mono bg-slate-100/80 dark:bg-slate-800/80 px-2.5 py-1 rounded-lg">
              <Database className="size-3.5 shrink-0 text-slate-500" />
              <span className="truncate max-w-[280px] sm:max-w-md" title={storage.path}>
                {storage.path}
              </span>
              <CopyButton text={storage.path} label={t("common.copy")} className="size-5" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {t("requestDb.retentionPolicy")}:
          </span>
          <Badge variant="secondary" className="font-mono text-xs">
            {storage?.retention_days && storage.retention_days > 0
              ? t("requestDb.retentionDays", { days: storage.retention_days })
              : t("requestDb.retentionInfinite")}
          </Badge>
        </div>
      </div>

      {/* KPI Stat Cards Grid */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4 mb-6">
        <StatCard
          label={t("requestDb.metrics.diskSize")}
          value={formatBytes(totalDiskBytes)}
          sub={
            <span>
              {t("requestDb.metrics.mainDbSize", { size: formatBytes(mainDbBytes) })} ·{" "}
              {t("requestDb.metrics.walSize", { size: formatBytes(walBytes) })}
            </span>
          }
          icon={HardDrive}
          loading={storageQuery.isLoading}
        />

        <StatCard
          label={t("requestDb.metrics.payloadSize")}
          value={formatBytes(compressedBytes)}
          sub={
            <span>
              ~{formatBytes(theoreticalBytes)} ·{" "}
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {t("requestDb.metrics.compressionSaving", { percent: savingPct })}
              </span>{" "}
              ({ratio.toFixed(1)}x)
            </span>
          }
          icon={Layers}
          loading={storageQuery.isLoading}
        />

        <StatCard
          label={t("requestDb.metrics.totalRecords")}
          value={formatInt(totalRecords)}
          sub={
            <span>
              {t("requestDb.metrics.failedRecords", { count: formatInt(failedRecords) })} ·{" "}
              {t("requestDb.metrics.payloadRecords", { count: formatInt(payloadRecords) })}
            </span>
          }
          icon={Database}
          loading={storageQuery.isLoading}
        />

        <StatCard
          label={t("requestDb.metrics.timeSpan")}
          value={
            timespanDays > 0
              ? t("common.daysUnit", { count: timespanDays, defaultValue: `${timespanDays} 天` })
              : totalRecords > 0
                ? t("common.lessThanOneDay", "< 1 天")
                : "—"
          }
          sub={
            earliestMS && latestMS ? (
              <span title={`${formatFullTime(earliestMS)} ~ ${formatFullTime(latestMS)}`}>
                {formatTime(earliestMS)} ~ {fromNow(latestMS)}
              </span>
            ) : (
              t("requestDb.metrics.noRecords")
            )
          }
          icon={CalendarClock}
          loading={storageQuery.isLoading}
        />
      </div>

      {/* Time-Range Log Explorer */}
      <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 shadow-2xs mb-8">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarClock className="size-4 text-blue-600 dark:text-blue-400" />
              {t("requestDb.explorer.title")}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {t("requestDb.explorer.subtitle")}
            </CardDescription>
          </div>
          <div className="shrink-0">
            <TimeRangeSelect value={explorerRange} onChange={setExplorerRange} />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800/60">
            <div>
              <p className="text-xs text-muted-foreground">{t("requestDb.explorer.rangeRecords")}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">
                  {explorerStatsQuery.isLoading ? "…" : formatInt(explorerTotalReqs)}
                </span>
                <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                  {explorerSharePct}%
                </Badge>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">{t("requestDb.explorer.estimatedSize")}</p>
              <p className="mt-1 text-xl font-bold font-mono text-blue-600 dark:text-blue-400">
                {explorerStatsQuery.isLoading ? "…" : formatBytes(explorerEstimatedBytes)}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">{t("requestDb.explorer.failureCount")}</p>
              <p className={cn("mt-1 text-xl font-bold font-mono", explorerFailedReqs > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                {explorerStatsQuery.isLoading ? "…" : formatInt(explorerFailedReqs)}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">{t("requestDb.explorer.tokensTotal")}</p>
              <p className="mt-1 text-xl font-bold font-mono text-slate-900 dark:text-slate-100">
                {explorerStatsQuery.isLoading
                  ? "…"
                  : formatTokens(explorerStatsQuery.data?.total_tokens)}
              </p>
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{t("requestDb.explorer.totalCost")}</p>
                <p className="mt-1 text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {explorerStatsQuery.isLoading
                    ? "…"
                    : formatUSD(explorerStatsQuery.data?.estimated_cost_usd)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 -mb-1 mt-2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 p-0 justify-start gap-1"
                onClick={() => navigate("/request-logs")}
              >
                {t("requestDb.explorer.jumpToLogs")}
                <ExternalLink className="size-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Maintenance & Purging Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t("requestDb.cleanup.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("requestDb.cleanup.subtitle")}
          </p>
        </div>

        {/* Auto Vacuum Toggle Checkbox */}
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/90 px-3.5 py-2 shadow-2xs">
          <Checkbox
            id="auto-vacuum"
            checked={autoVacuum}
            onCheckedChange={(c) => setAutoVacuum(Boolean(c))}
          />
          <Label
            htmlFor="auto-vacuum"
            className="text-xs font-medium cursor-pointer select-none"
            title={t("requestDb.cleanup.autoVacuumHint")}
          >
            {t("requestDb.cleanup.autoVacuum")}
          </Label>
        </div>
      </div>

      {/* Cleanup Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
        {/* Card 1: Strip Payloads (Recommended) */}
        <Card className="rounded-2xl border-blue-200/80 dark:border-blue-900/50 bg-blue-50/20 dark:bg-blue-950/10 shadow-2xs hover:shadow-xs transition flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-blue-600 dark:text-blue-400" />
                <CardTitle className="text-sm font-semibold">
                  {t("requestDb.cleanup.strip.title")}
                </CardTitle>
              </div>
              <Badge className="bg-blue-600 text-white dark:bg-blue-500 text-[10px]">
                {t("common.recommended", "推荐")}
              </Badge>
            </div>
            <CardDescription className="text-xs leading-relaxed mt-2 text-muted-foreground">
              {t("requestDb.cleanup.strip.description")}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-4">
              <Label htmlFor="strip-days" className="text-xs shrink-0 text-muted-foreground">
                {t("requestDb.cleanup.strip.olderThan")}
              </Label>
              <Input
                id="strip-days"
                type="number"
                min="1"
                max="365"
                value={stripDays}
                onChange={(e) => setStripDays(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-20 text-xs font-mono"
              />
              <span className="text-xs text-muted-foreground">
                {t("requestDb.cleanup.strip.days")}
              </span>
            </div>

            <div className="flex items-center gap-1.5 mb-4">
              {[3, 7, 14, 30].map((d) => (
                <Button
                  key={d}
                  variant={stripDays === d ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 text-[11px] px-2 rounded-md"
                  onClick={() => setStripDays(d)}
                >
                  {d}d
                </Button>
              ))}
            </div>

            <Button
              className="w-full text-xs font-medium gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() =>
                openConfirm({
                  action: "strip_payloads",
                  title: t("requestDb.cleanup.strip.title"),
                  desc: t("requestDb.cleanup.strip.confirm", { days: stripDays }),
                  params: {
                    action: "strip_payloads",
                    before_days: stripDays,
                    vacuum: autoVacuum,
                  },
                })
              }
            >
              <Scissors className="size-3.5" />
              {t("requestDb.cleanup.strip.actionBtn")}
            </Button>
          </CardContent>
        </Card>

        {/* Card 2: Retention-based Delete */}
        <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 shadow-2xs hover:shadow-xs transition flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-slate-700 dark:text-slate-300" />
              <CardTitle className="text-sm font-semibold">
                {t("requestDb.cleanup.time.title")}
              </CardTitle>
            </div>
            <CardDescription className="text-xs leading-relaxed mt-2 text-muted-foreground">
              {t("requestDb.cleanup.time.description")}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-4">
              <Label htmlFor="retention-days" className="text-xs shrink-0 text-muted-foreground">
                {t("requestDb.cleanup.time.keepWithin")}
              </Label>
              <Input
                id="retention-days"
                type="number"
                min="1"
                max="365"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-20 text-xs font-mono"
              />
              <span className="text-xs text-muted-foreground">
                {t("requestDb.cleanup.time.days")}
              </span>
            </div>

            <div className="flex items-center gap-1.5 mb-4">
              {[7, 15, 30, 60, 90].map((d) => (
                <Button
                  key={d}
                  variant={retentionDays === d ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 text-[11px] px-2 rounded-md"
                  onClick={() => setRetentionDays(d)}
                >
                  {d}d
                </Button>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full text-xs font-medium gap-1.5"
              onClick={() =>
                openConfirm({
                  action: "delete_before",
                  title: t("requestDb.cleanup.time.title"),
                  desc: t("requestDb.cleanup.time.confirm", { days: retentionDays }),
                  params: {
                    action: "delete_before",
                    before_days: retentionDays,
                    vacuum: autoVacuum,
                  },
                })
              }
            >
              <Eraser className="size-3.5" />
              {t("requestDb.cleanup.time.actionBtn")}
            </Button>
          </CardContent>
        </Card>

        {/* Card 3: Cap Database Size */}
        <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 shadow-2xs hover:shadow-xs transition flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-2">
              <HardDrive className="size-4 text-slate-700 dark:text-slate-300" />
              <CardTitle className="text-sm font-semibold">
                {t("requestDb.cleanup.cap.title")}
              </CardTitle>
            </div>
            <CardDescription className="text-xs leading-relaxed mt-2 text-muted-foreground">
              {t("requestDb.cleanup.cap.description")}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-4">
              <Label htmlFor="cap-size" className="text-xs shrink-0 text-muted-foreground">
                {t("requestDb.cleanup.cap.targetSize")}
              </Label>
              <Input
                id="cap-size"
                type="number"
                min="10"
                max="10000"
                step="10"
                value={capSizeMB}
                onChange={(e) => setCapSizeMB(Math.max(5, Number(e.target.value) || 10))}
                className="h-8 w-24 text-xs font-mono"
              />
              <span className="text-xs text-muted-foreground">MB</span>
            </div>

            <div className="flex items-center gap-1.5 mb-4">
              {[50, 100, 200, 500].map((mb) => (
                <Button
                  key={mb}
                  variant={capSizeMB === mb ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 text-[11px] px-2 rounded-md"
                  onClick={() => setCapSizeMB(mb)}
                >
                  {mb}MB
                </Button>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full text-xs font-medium gap-1.5"
              onClick={() =>
                openConfirm({
                  action: "cap_size",
                  title: t("requestDb.cleanup.cap.title"),
                  desc: t("requestDb.cleanup.cap.confirm", { size: capSizeMB }),
                  params: {
                    action: "cap_size",
                    target_size_mb: capSizeMB,
                    vacuum: autoVacuum,
                  },
                })
              }
            >
              <HardDrive className="size-3.5" />
              {t("requestDb.cleanup.cap.actionBtn")}
            </Button>
          </CardContent>
        </Card>

        {/* Card 4: Purge Failed Requests */}
        <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 shadow-2xs hover:shadow-xs transition flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              <CardTitle className="text-sm font-semibold">
                {t("requestDb.cleanup.failed.title")}
              </CardTitle>
            </div>
            <CardDescription className="text-xs leading-relaxed mt-2 text-muted-foreground">
              {t("requestDb.cleanup.failed.description")}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 p-3 mb-4 text-xs text-amber-800 dark:text-amber-300">
              {t("requestDb.cleanup.failed.banner", {
                count: formatInt(failedRecords),
                defaultValue: `当前共有 ${formatInt(failedRecords)} 条调用异常或失败的错误记录。`,
              })}
            </div>

            <Button
              variant="outline"
              className="w-full text-xs font-medium gap-1.5 border-amber-200 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-800 dark:text-amber-300"
              disabled={failedRecords === 0}
              onClick={() =>
                openConfirm({
                  action: "delete_failed",
                  title: t("requestDb.cleanup.failed.title"),
                  desc: t("requestDb.cleanup.failed.confirm"),
                  params: {
                    action: "delete_failed",
                    vacuum: autoVacuum,
                  },
                })
              }
            >
              <Trash2 className="size-3.5" />
              {t("requestDb.cleanup.failed.actionBtn")}
            </Button>
          </CardContent>
        </Card>

        {/* Card 5: VACUUM & Defragmentation */}
        <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 shadow-2xs hover:shadow-xs transition flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="size-4 text-slate-700 dark:text-slate-300" />
              <CardTitle className="text-sm font-semibold">
                {t("requestDb.cleanup.vacuum.title")}
              </CardTitle>
            </div>
            <CardDescription className="text-xs leading-relaxed mt-2 text-muted-foreground">
              {t("requestDb.cleanup.vacuum.description")}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="rounded-lg bg-slate-100/70 dark:bg-slate-800/60 p-3 mb-4 text-xs text-muted-foreground flex items-center justify-between">
              <span>{t("requestDb.cleanup.vacuum.walUsage", "WAL 缓冲区占用")}</span>
              <span className="font-mono font-medium text-foreground">
                {formatBytes(walBytes)}
              </span>
            </div>

            <Button
              variant="outline"
              className="w-full text-xs font-medium gap-1.5"
              onClick={() =>
                openConfirm({
                  action: "vacuum",
                  title: t("requestDb.cleanup.vacuum.title"),
                  desc: t("requestDb.cleanup.vacuum.confirm"),
                  params: { action: "vacuum" },
                })
              }
            >
              <RefreshCw className="size-3.5" />
              {t("requestDb.cleanup.vacuum.actionBtn")}
            </Button>
          </CardContent>
        </Card>

        {/* Card 6: Danger Zone - Clear All */}
        <Card className="rounded-2xl border-red-200/80 dark:border-red-950/80 bg-red-50/10 dark:bg-red-950/10 shadow-2xs hover:shadow-xs transition flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-red-600 dark:text-red-400" />
              <CardTitle className="text-sm font-semibold text-red-600 dark:text-red-400">
                {t("requestDb.cleanup.clearAll.title")}
              </CardTitle>
            </div>
            <CardDescription className="text-xs leading-relaxed mt-2 text-muted-foreground">
              {t("requestDb.cleanup.clearAll.description")}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="rounded-lg bg-red-50/60 dark:bg-red-950/40 border border-red-200/60 dark:border-red-900/60 p-3 mb-4 text-xs text-red-800 dark:text-red-300">
              {t("requestDb.cleanup.clearAll.warning", {
                count: formatInt(totalRecords),
                defaultValue: `警告：将彻底删除所有 ${formatInt(totalRecords)} 条请求记录，统计数据将被重置！`,
              })}
            </div>

            <Button
              variant="destructive"
              className="w-full text-xs font-medium gap-1.5"
              disabled={totalRecords === 0}
              onClick={() =>
                openConfirm({
                  action: "clear_all",
                  title: t("requestDb.cleanup.clearAll.title"),
                  desc: t("requestDb.cleanup.clearAll.confirm"),
                  requiresClearInput: true,
                  params: { action: "clear_all", vacuum: true },
                })
              }
            >
              <Trash2 className="size-3.5" />
              {t("requestDb.cleanup.clearAll.actionBtn")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation & Execution Dialog */}
      <Dialog
        open={confirmState.open}
        onOpenChange={(open) => {
          if (!isExecuting && !open) {
            setConfirmState(DEFAULT_CONFIRM_STATE);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {confirmState.action === "clear_all" ? (
                <ShieldAlert className="size-5 text-red-600 dark:text-red-400" />
              ) : (
                <Info className="size-5 text-blue-600 dark:text-blue-400" />
              )}
              {confirmState.title || t("requestDb.dialog.confirmTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed pt-2 text-foreground/80">
              {confirmState.desc}
            </DialogDescription>
          </DialogHeader>

          {confirmState.requiresClearInput && (
            <div className="space-y-2 py-2">
              <Label htmlFor="clear-verify" className="text-xs text-muted-foreground">
                {t("requestDb.cleanup.clearAll.typeClearPrompt", "请输入 CLEAR 以确认执行清空：")}
              </Label>
              <Input
                id="clear-verify"
                value={clearInput}
                onChange={(e) => setClearInput(e.target.value)}
                placeholder="CLEAR"
                className="font-mono text-xs uppercase"
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmState(DEFAULT_CONFIRM_STATE)}
              disabled={isExecuting}
              className="text-xs"
            >
              {t("requestDb.dialog.cancel")}
            </Button>
            <Button
              variant={confirmState.action === "clear_all" ? "destructive" : "default"}
              size="sm"
              onClick={executeClean}
              disabled={
                isExecuting ||
                (confirmState.requiresClearInput && clearInput.trim() !== "CLEAR")
              }
              className="text-xs gap-1.5"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("requestDb.dialog.running")}
                </>
              ) : (
                t("requestDb.dialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
