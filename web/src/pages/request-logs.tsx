import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, Database, Download, EyeOff, Eye, Loader2, PauseCircle, PlayCircle, RadioTower, RefreshCw, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { CopyButton, DetailList, JsonView, StatusPill } from "@/components/shared/misc";
import { RequestDBDisabled } from "@/components/shared/misc";
import { TimingBreakdownCard } from "@/components/shared/timing-breakdown-card";
import { TimeRangeSelect } from "@/components/shared/time-range-select";
import { requestDB, fileLogs, type RecordFilter } from "@/api/management";
import { errMessage, errStatus, type RequestRecord } from "@/api/types";
import { useLiveRecords } from "@/hooks/use-live-records";
import { computeCacheHitRate, computeTPS, dayjs, downloadText, formatDuration, formatInt, formatLatencySeconds, formatNumber, formatTPS, formatTime, formatUSD, getLatencyColorClass, getTTFTColorClass, maskKey, resolveTotalInputTokens, toCSV } from "@/lib/format";
import { buildProviderTooltip, formatAuthTypeBadge, formatProviderKeyFallback, getAuthTypeBadgeClass, resolveProviderLabel, splitProviderLabel } from "@/lib/provider-display";
import { cn } from "@/lib/utils";
import { usePrefsStore, resolveRange, type TimeRange } from "@/stores/prefs";

interface Filters {
  model: string;
  provider: string;
  apiKey: string;
  sessionId: string;
  requestId: string;
  traceId: string;
  statusCode: string;
  onlyFailed: boolean;
}

const EMPTY_FILTERS: Filters = { model: "", provider: "", apiKey: "", sessionId: "", requestId: "", traceId: "", statusCode: "", onlyFailed: false };

function toRecordFilter(filters: Filters, range: TimeRange): RecordFilter {
  const result: RecordFilter = {};
  if (filters.model) result.model = filters.model;
  if (filters.provider) result.provider = filters.provider;
  if (filters.apiKey) result.api_key = filters.apiKey;
  if (filters.sessionId) result.session_id = filters.sessionId;
  if (filters.requestId) result.request_id = filters.requestId;
  if (filters.traceId) result.trace_id = filters.traceId;
  if (filters.statusCode) result.status_code = Number(filters.statusCode);
  if (filters.onlyFailed) result.failed = true;

  const resolved = resolveRange(range);
  result.from = resolved.from;
  if (range.preset === "custom") {
    result.to = resolved.to;
  }
  return result;
}

function ModelChainDisplay({ record }: { record: RequestRecord }) {
  const { t } = useTranslation();
  const requested = record.alias?.trim() || record.model?.trim() || "—";
  const sent = record.model?.trim() || "";
  const response = record.response_model?.trim() || "";

  const hasAliasDiff = Boolean(record.alias?.trim() && sent && record.alias.trim() !== sent);
  const hasResponseDiff = Boolean(response && response !== sent && response !== requested);

  // Marks requests whose upstream call ran over the Codex WebSocket transport.
  const wsBadge = record.upstream_websocket ? (
    <span className="shrink-0 text-amber-500 dark:text-amber-400">{" (ws)"}</span>
  ) : null;

  if (!hasAliasDiff && !hasResponseDiff) {
    const name = sent || requested || "—";
    return (
      <span className="flex w-full min-w-0 items-center font-mono text-xs">
        <span className="block min-w-0 truncate text-foreground" title={name}>{name}</span>
        {wsBadge}
      </span>
    );
  }

  // Warning amber only applies when upstream unexpectedly substituted a model different
  // from what was sent, during an existing alias chain (requested -> sent -> unexpected response).
  // A direct requested -> response transition is normal alias/canonical mapping and should be muted gray.
  const isUnexpectedResponse = hasAliasDiff && hasResponseDiff;

  const tooltipLines = [
    `${t("requestLogs.detail.requestedModel", "Requested model")}: ${requested}`,
    hasAliasDiff && sent ? `${t("requestLogs.detail.upstreamModel", "Actual model")}: ${sent}` : null,
    hasResponseDiff ? `${t("requestLogs.detail.responseModel", "Response model")}: ${response}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="flex w-full items-center gap-1 font-mono text-xs min-w-0" title={tooltipLines}>
      <span className="truncate min-w-0 shrink">{requested}</span>
      {hasAliasDiff && sent && !isUnexpectedResponse ? (
        <>
          <span className="text-muted-foreground/60 shrink-0">→</span>
          <span className="text-muted-foreground truncate min-w-0 shrink">{sent}</span>
        </>
      ) : null}
      {hasResponseDiff ? (
        <>
          <span className={cn("shrink-0", isUnexpectedResponse ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground/60")}>→</span>
          <span className={cn("truncate min-w-0 shrink", isUnexpectedResponse ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>{response}</span>
        </>
      ) : null}
      {wsBadge}
    </div>
  );
}

function ProviderDisplay({ record }: { record: RequestRecord }) {
  const label = resolveProviderLabel(record);
  if (!label) {
    return <span className="text-muted-foreground">—</span>;
  }

  const { prefix, qualifier } = splitProviderLabel(label);
  const badge = formatAuthTypeBadge(record.auth_type);
  const fullTitle = buildProviderTooltip(record);

  return (
    <div className="flex min-w-0 items-center gap-1" title={fullTitle}>
      <span className="font-mono text-xs truncate min-w-0">
        <span className="text-foreground">{prefix || "—"}</span>
        {qualifier ? <span className="text-muted-foreground/80 font-normal">({qualifier})</span> : null}
      </span>
      {badge ? (
        <span
          className={cn(
            "shrink-0 rounded border px-1 py-0 text-[9px] font-medium leading-3.5",
            getAuthTypeBadgeClass(record.auth_type),
          )}
        >
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function resolveActualServiceTier(record: {
  response_service_tier?: string;
  effective_service_tier?: string;
  service_tier?: string;
}): string {
  return (
    record.response_service_tier?.trim() ||
    record.effective_service_tier?.trim() ||
    record.service_tier?.trim() ||
    ""
  );
}

function ServiceTierDisplay({ record }: { record: RequestRecord }) {
  const { t } = useTranslation();
  const responseTier = record.response_service_tier?.trim();
  const sentTier = record.effective_service_tier?.trim();
  const requestedTier = record.service_tier?.trim();
  const displayed = resolveActualServiceTier(record);

  if (!displayed) {
    return <span className="text-muted-foreground">—</span>;
  }

  const tooltipLines = [
    responseTier ? `${t("requestLogs.detail.responseTier", "上游响应层级")}: ${responseTier}` : null,
    sentTier ? `${t("requestLogs.detail.sentTier", "发送上游层级")}: ${sentTier}` : null,
    requestedTier ? `${t("requestLogs.detail.requestedTier", "下游请求层级")}: ${requestedTier}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span className="font-mono text-xs text-foreground truncate block max-w-full" title={tooltipLines || displayed}>
      {displayed}
    </span>
  );
}

function ThinkingLevelDisplay({ record }: { record: RequestRecord }) {
  const { t } = useTranslation();
  const requested = record.requested_reasoning_effort?.trim();
  const actual = record.reasoning_effort?.trim();

  if (!requested && !actual) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (requested && actual && requested !== actual) {
    const tooltip = `${t("requestLogs.detail.requestedReasoning", "请求思考等级")}: ${requested}\n${t("requestLogs.detail.actualReasoning", "实际响应等级")}: ${actual}`;
    return (
      <div className="flex w-full items-center gap-1 font-mono text-xs min-w-0" title={tooltip}>
        <span className="truncate min-w-0 shrink text-foreground">{requested}</span>
        <span className="text-muted-foreground/60 shrink-0">→</span>
        <span className="text-muted-foreground truncate min-w-0 shrink">{actual}</span>
      </div>
    );
  }

  const level = actual || requested;
  return (
    <span className="font-mono text-xs text-foreground truncate block max-w-full" title={level}>
      {level}
    </span>
  );
}

function TokenMetricCell({ record }: { record: RequestRecord }) {
  const totalInput = resolveTotalInputTokens(record);
  const cachePct = computeCacheHitRate(record);
  const uncachedPart = totalInput !== (record.input_tokens || 0) ? ` (Uncached: ${formatInt(record.input_tokens)})` : "";
  const title = `Input: ${formatInt(totalInput)}${uncachedPart} | Output: ${formatInt(record.output_tokens)} | Thinking: ${formatInt(record.reasoning_tokens)} | Cache: ${cachePct}`;

  return (
    <div className="flex items-center justify-end gap-1 font-mono text-xs" title={title}>
      <span className="text-sky-500" title={`Input${uncachedPart}`}>{formatNumber(totalInput)}</span>
      <span className="text-muted-foreground/40">/</span>
      <span className="text-emerald-500" title="Output">{formatNumber(record.output_tokens)}</span>
      <span className="text-muted-foreground/40">/</span>
      <span className="text-orange-500 dark:text-orange-400 font-medium" title="Thinking">{formatNumber(record.reasoning_tokens)}</span>
      <span className="text-muted-foreground/60 ml-1">·</span>
      <span className="text-foreground" title="Cache hit rate">{cachePct}</span>
    </div>
  );
}

export function RequestLogsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>({ preset: usePrefsStore.getState().defaultRange });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<RequestRecord | null>(null);

  const filter = useMemo(() => toRecordFilter(filters, range), [filters, range]);
  const liveState = useLiveRecords(filter);
  const maskKeys = usePrefsStore((state) => state.maskApiKeys);
  const setMaskKeys = usePrefsStore((state) => state.setMaskApiKeys);

  const [loadingOlder, setLoadingOlder] = useState(false);
  const oldestID = liveState.records.length > 0 ? (liveState.records[liveState.records.length - 1]?.id ?? 0) : 0;

  const advancedActiveCount = useMemo(() => {
    let count = 0;
    if (filters.sessionId) count++;
    if (filters.requestId) count++;
    if (filters.traceId) count++;
    if (filters.statusCode) count++;
    if (filters.onlyFailed) count++;
    return count;
  }, [filters]);

  const hasAnyFilter = Boolean(
    filters.model ||
    filters.provider ||
    filters.apiKey ||
    advancedActiveCount > 0,
  );

  const loadOlder = async () => {
    if (!oldestID) return;
    setLoadingOlder(true);
    try {
      const page = await requestDB.records({ ...filter, before_id: oldestID, page_size: 200 });
      liveState.appendOlder(page.records);
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setLoadingOlder(false);
    }
  };

  const exportCSV = () => {
    const rows = liveState.records.map((record) => {
      const provider = resolveProviderLabel(record);
      const reqEffort = record.requested_reasoning_effort?.trim();
      const actEffort = record.reasoning_effort?.trim();
      const thinkingLevel = reqEffort && actEffort && reqEffort !== actEffort
        ? `${reqEffort} -> ${actEffort}`
        : (actEffort || reqEffort || "");
      return [
        dayjs(record.requested_at).format("YYYY-MM-DD HH:mm:ss"),
        record.failed ? record.status_code : 200,
        record.alias ? `${record.alias} -> ${record.model}` : (record.model ?? ""),
        record.response_model ?? "",
        provider,
        resolveActualServiceTier(record),
        thinkingLevel,
        record.api_key ?? "",
        resolveTotalInputTokens(record),
        record.output_tokens,
        record.reasoning_tokens,
        computeCacheHitRate(record),
        record.total_tokens,
        record.latency_ms,
        record.ttft_ms,
        computeTPS(record.output_tokens, record.latency_ms).toFixed(2),
        record.estimated_cost_usd !== undefined ? record.estimated_cost_usd.toFixed(4) : "",
      ];
    });
    downloadText(
      `cpa-request-logs.csv`,
      toCSV([t("common.time"), "status", t("common.model"), "response_model", t("common.provider"), "tier", "thinking_level", t("common.apiKey"), "input", "output", "reasoning", "cache_hit_rate", "total", "latency_ms", "ttft_ms", "tps", "cost_usd"], rows),
    );
  };

  const statusBadge = (() => {
    if (liveState.status === "reconnecting") {
      return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"><RadioTower className="mr-1 size-3" />{t("requestLogs.live.reconnecting")}</Badge>;
    }
    if (liveState.status === "connecting") {
      return <Badge variant="outline" className="text-muted-foreground"><Loader2 className="mr-1 size-3 animate-spin" />{t("requestLogs.live.connecting")}</Badge>;
    }
    return null;
  })();

  return (
    <>
      <PageHeader title={t("requestLogs.title")} subtitle={t("requestLogs.subtitle")}>
        <TimeRangeSelect value={range} onChange={setRange} />
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMaskKeys(!maskKeys)} title={t("common.apiKey")}>
          {maskKeys ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate("/request-db")}>
          <Database className="size-3.5" />
          {t("nav.requestDb")}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportCSV} disabled={liveState.records.length === 0}>
          <Download className="size-3.5" />
          {t("common.export")}
        </Button>
      </PageHeader>

      <RequestDBGate hasRecords={liveState.records.length > 0} status={liveState.status}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ModelFilterCombobox
            placeholder={t("requestLogs.filters.model")}
            value={filters.model}
            range={range}
            onChange={(value) => setFilters((f) => ({ ...f, model: value }))}
          />
          <ProviderFilterCombobox
            placeholder={t("requestLogs.filters.provider")}
            value={filters.provider}
            range={range}
            onChange={(value) => setFilters((f) => ({ ...f, provider: value }))}
          />
          <FilterInput placeholder={t("requestLogs.filters.apiKey")} value={filters.apiKey} onChange={(value) => setFilters((f) => ({ ...f, apiKey: value }))} className="w-44 font-mono" />
          <Button
            variant={advancedOpen || advancedActiveCount > 0 ? "secondary" : "outline"}
            size="sm"
            className={cn("h-8 text-xs gap-1.5", advancedActiveCount > 0 && "border-primary/40 bg-primary/10 text-primary")}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <SlidersHorizontal className="size-3.5" />
            {advancedActiveCount > 0 ? (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono bg-primary text-primary-foreground">
                {advancedActiveCount}
              </Badge>
            ) : null}
          </Button>
          {hasAnyFilter ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-rose-500"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              <RotateCcw className="size-3" />
              <span>{t("requestLogs.resetFilters", "重置筛选")}</span>
            </Button>
          ) : null}
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            {liveState.status === "live" && !liveState.live && liveState.pending > 0 ? (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => liveState.setLive(true)}>
                {t("requestLogs.live.paused", { count: liveState.pending })}
              </Button>
            ) : null}
            <Button
              variant={liveState.live ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => liveState.setLive(!liveState.live)}
            >
              {liveState.live ? <PauseCircle className="size-3.5" /> : <PlayCircle className="size-3.5" />}
              {liveState.live ? (
                <>
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                  {t("common.live")}
                </>
              ) : (
                t("common.resume")
              )}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" onClick={liveState.reload}>
                  <RefreshCw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.refresh")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {advancedOpen ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border-border/60 bg-secondary/50 p-2">
            <FilterInput placeholder={t("requestLogs.filters.sessionId")} value={filters.sessionId} onChange={(value) => setFilters((f) => ({ ...f, sessionId: value }))} className="w-52 font-mono" />
            <FilterInput placeholder={t("requestLogs.filters.requestId")} value={filters.requestId} onChange={(value) => setFilters((f) => ({ ...f, requestId: value }))} className="w-52 font-mono" />
            <FilterInput placeholder={t("requestLogs.filters.traceId")} value={filters.traceId} onChange={(value) => setFilters((f) => ({ ...f, traceId: value }))} className="w-40 font-mono" />
            <FilterInput placeholder={t("requestLogs.filters.statusCode")} value={filters.statusCode} onChange={(value) => setFilters((f) => ({ ...f, statusCode: value.replace(/\D/g, "") }))} className="w-24" />
            <label className="ml-2 flex items-center gap-2 text-sm">
              {t("requestLogs.filters.onlyFailures")}
              <Switch checked={filters.onlyFailed} onCheckedChange={(checked) => setFilters((f) => ({ ...f, onlyFailed: checked }))} />
            </label>
          </div>
        ) : null}

        <div className="card-surface overflow-hidden">
          <div className="max-h-[calc(100vh-16rem)] overflow-auto">
            <Table className="min-w-[1240px] table-fixed">
              <TableHeader className="bg-card/95 sticky top-0 z-10 backdrop-blur-sm">
                <TableRow>
                  <TableHead className="w-32">{t("requestLogs.table.time")}</TableHead>
                  <TableHead className="w-16">{t("requestLogs.table.status")}</TableHead>
                  <TableHead className="w-auto">{t("requestLogs.table.model")}</TableHead>
                  <TableHead className="w-56">{t("requestLogs.table.provider")}</TableHead>
                  <TableHead className="w-24">{t("requestLogs.table.tier")}</TableHead>
                  <TableHead className="w-32">{t("requestLogs.table.thinkingLevel")}</TableHead>
                  <TableHead className="w-52 text-right">{t("requestLogs.table.tokens")}</TableHead>
                  <TableHead className="w-20 text-right">{t("requestLogs.table.ttft")}</TableHead>
                  <TableHead className="w-20 text-right">{t("requestLogs.table.latency")}</TableHead>
                  <TableHead className="w-20 text-right">{t("requestLogs.table.tps")}</TableHead>
                  <TableHead className="w-24 text-right">{t("requestLogs.table.cost", "价格")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveState.records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-44 text-center text-muted-foreground text-xs">
                      {liveState.status === "connecting" ? (
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="size-4 animate-spin text-blue-500" />
                          <span>{t("common.loading")}</span>
                        </div>
                      ) : (
                        t("requestLogs.emptyHint") || "当前时间范围与筛选条件下暂无请求记录"
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  liveState.records.map((record) => (
                    <TableRow key={record.id > 0 ? record.id : `${record.request_id || ""}-${record.requested_at}`} className="cursor-pointer" onClick={() => setSelected(record)}>
                      <TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">{formatTime(record.requested_at, true)}</TableCell>
                      <TableCell>
                        <StatusPill
                          failed={record.failed}
                          statusCode={record.status_code}
                          recordId={record.id}
                          errorBody={record.error_body}
                          responseHeaders={record.response_headers}
                          responsePreview={record.response_preview}
                        />
                      </TableCell>
                      <TableCell className="overflow-hidden">
                        <ModelChainDisplay record={record} />
                      </TableCell>
                      <TableCell className="text-xs overflow-hidden">
                        <ProviderDisplay record={record} />
                      </TableCell>
                      <TableCell className="overflow-hidden">
                        <ServiceTierDisplay record={record} />
                      </TableCell>
                      <TableCell className="overflow-hidden">
                        <ThinkingLevelDisplay record={record} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                        <TokenMetricCell record={record} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                        <span className={getTTFTColorClass(record.ttft_ms)}>
                          {formatLatencySeconds(record.ttft_ms)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                        <span className={getLatencyColorClass(record.latency_ms)}>
                          {formatLatencySeconds(record.latency_ms)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">{record.failed ? "—" : formatTPS(computeTPS(record.output_tokens, record.latency_ms))}</TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                        {record.failed && !record.estimated_cost_usd ? "—" : formatUSD(record.estimated_cost_usd)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-xs">
            <span className="flex items-center gap-2">
              {statusBadge}
              {t("requestLogs.recordsCount", { count: liveState.records.length, defaultValue: `${formatInt(liveState.records.length)} records` })}
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={loadOlder} disabled={loadingOlder || !oldestID}>
              {loadingOlder ? <Loader2 className="size-3 animate-spin" /> : <ChevronUp className="size-3.5" />}
              {t("requestLogs.loadOlder", "Load older")}
            </Button>
          </div>
        </div>
      </RequestDBGate>

      <RecordDetailSheet
        record={selected}
        onClose={() => setSelected(null)}
        onTrace={(traceId) => {
          setFilters((f) => ({ ...f, traceId }));
          setAdvancedOpen(true);
          setSelected(null);
        }}
      />
    </>
  );
}

/** Wraps the page body; shows the request-db hint when the store is disabled. */
function RequestDBGate({ children, hasRecords, status }: { children: React.ReactNode; hasRecords: boolean; status: string }) {
  const probe = useQuery({
    queryKey: ["rdb", "probe"],
    queryFn: () => requestDB.records({ page_size: 1 }),
    enabled: !hasRecords && status === "reconnecting",
    retry: false,
    staleTime: 60_000,
  });

  if (!hasRecords && probe.error && errStatus(probe.error) === 503) {
    return <RequestDBDisabled />;
  }
  return <>{children}</>;
}

/** Debounced text filter: keystrokes settle for 300ms before the live
 *  subscription is torn down and re-attached with the new value. */
function FilterInput({ placeholder, value, onChange, className }: { placeholder: string; value: string; onChange: (value: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  const settled = useRef(text);
  useEffect(() => {
    if (text !== settled.current) return;
    // Sync external clears (e.g. related-trace chips) into the local field.
    setText(value);
    settled.current = value;
  }, [value]);
  useEffect(() => {
    if (text === settled.current) return;
    const timer = setTimeout(() => {
      settled.current = text;
      onChange(text);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <div className={cn("relative", className)}>
      <Input
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={cn("h-8 w-full text-xs", text && "pr-6")}
      />
      {text ? (
        <button
          type="button"
          onClick={() => {
            setText("");
            settled.current = "";
            onChange("");
          }}
          className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

/** Model filter that doubles as a picker: focusing it lists the models seen in
 *  the last 24h (request counts included) while free-typed input still
 *  substring-filters server-side. */
function ModelFilterCombobox({ placeholder, value, range, onChange }: { placeholder: string; value: string; range: TimeRange; onChange: (value: string) => void; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const settled = useRef(text);
  useEffect(() => {
    if (text !== settled.current) return;
    setText(value);
    settled.current = value;
  }, [value]);
  useEffect(() => {
    if (text === settled.current) return;
    const timer = setTimeout(() => {
      settled.current = text;
      onChange(text);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  const recent = useQuery({
    queryKey: ["rdb", "model-options", range],
    queryFn: () => {
      const resolved = resolveRange(range);
      return requestDB.breakdown("model", { from: resolved.from, to: range.preset === "custom" ? resolved.to : undefined }, 100);
    },
    enabled: open,
    staleTime: 30_000,
  });
  const term = text.trim().toLowerCase();
  const options = (recent.data ?? []).filter((row) => !term || row.key.toLowerCase().includes(term));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-44">
          <Input
            placeholder={placeholder}
            className={cn("h-8 w-full font-mono text-xs", text && "pr-6")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
          />
          {text ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setText("");
                settled.current = "";
                onChange("");
              }}
              className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-64 p-0" align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
        <Command shouldFilter={false}>
          <CommandList>
            {recent.isLoading ? (
              <p className="text-muted-foreground py-6 text-center text-xs">{t("common.loading")}</p>
            ) : options.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">{t("requestLogs.filters.noRecentModels")}</p>
            ) : (
              options.map((row) => (
                <CommandItem
                  key={row.key}
                  value={row.key}
                  className="text-xs"
                  onSelect={() => {
                    setText(row.key);
                    settled.current = row.key;
                    onChange(row.key);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{row.key}</span>
                  <span className="text-muted-foreground ml-2 shrink-0 text-[10px] tabular-nums">{formatNumber(row.requests)}</span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Provider filter that doubles as an instance picker: focusing lists distinct
 *  provider instances seen in the current time range while free-typed input
 *  still filters server-side across provider type, name, email, host, and auth ID. */
function ProviderFilterCombobox({ placeholder, value, range, onChange }: { placeholder: string; value: string; range: TimeRange; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? formatProviderKeyFallback(value) : "");
  const settledValue = useRef(value);
  const displayByValue = useRef(new Map<string, string>());
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (value === settledValue.current) return;
    settledValue.current = value;
    setText(value ? (displayByValue.current.get(value) ?? formatProviderKeyFallback(value)) : "");
  }, [value]);

  useEffect(() => {
    const currentDisplay = settledValue.current
      ? (displayByValue.current.get(settledValue.current) ?? settledValue.current)
      : "";
    if (text === currentDisplay) return;
    const timer = setTimeout(() => {
      settledValue.current = text;
      onChangeRef.current(text);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  const recent = useQuery({
    queryKey: ["rdb", "provider-options", range],
    queryFn: () => {
      const resolved = resolveRange(range);
      return requestDB.breakdown("provider", { from: resolved.from, to: range.preset === "custom" ? resolved.to : undefined }, 100);
    },
    enabled: open,
    staleTime: 30_000,
  });

  const selectedLabel = settledValue.current ? (displayByValue.current.get(settledValue.current) ?? "") : "";
  const term = text.trim() && text !== selectedLabel ? text.trim().toLowerCase() : "";
  const options = (recent.data ?? []).filter((row) => {
    if (!term) return true;
    const label = resolveProviderLabel(row);
    const badge = formatAuthTypeBadge(row.auth_type);
    return (
      label.toLowerCase().includes(term) ||
      row.key.toLowerCase().includes(term) ||
      (row.provider ?? "").toLowerCase().includes(term) ||
      (row.provider_name ?? "").toLowerCase().includes(term) ||
      (row.base_url ?? "").toLowerCase().includes(term) ||
      (row.auth_id ?? "").toLowerCase().includes(term) ||
      (row.auth_type ?? "").toLowerCase().includes(term) ||
      badge.toLowerCase().includes(term)
    );
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-52">
          <Input
            placeholder={placeholder}
            className={cn("h-8 w-full font-mono text-xs", text && "pr-6")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
          />
          {text ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setText("");
                settledValue.current = "";
                onChange("");
              }}
              className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-80 p-0" align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
        <Command shouldFilter={false}>
          <CommandList>
            {recent.isLoading ? (
              <p className="text-muted-foreground py-6 text-center text-xs">{t("common.loading")}</p>
            ) : options.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">{t("requestLogs.filters.noRecentProviders", "当前范围内暂无供应商记录")}</p>
            ) : (
              options.map((row) => {
                const label = resolveProviderLabel(row);
                const badge = formatAuthTypeBadge(row.auth_type);
                return (
                  <CommandItem
                    key={row.key}
                    value={row.key}
                    className="text-xs"
                    onSelect={() => {
                      displayByValue.current.set(row.key, label);
                      settledValue.current = row.key;
                      setText(label);
                      onChange(row.key);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono" title={buildProviderTooltip(row)}>
                      {label}
                    </span>
                    {badge ? (
                      <span
                        className={cn(
                          "ml-1.5 shrink-0 rounded border px-1 py-0 text-[9px] font-medium leading-4",
                          getAuthTypeBadgeClass(row.auth_type),
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground ml-2 shrink-0 text-[10px] tabular-nums">{formatNumber(row.requests)}</span>
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RecordDetailSheet({ record, onClose, onTrace }: { record: RequestRecord | null; onClose: () => void; onTrace: (traceId: string) => void }) {
  const { t } = useTranslation();
  const open = Boolean(record);
  const detail = useQuery({
    queryKey: ["rdb", "detail", record?.id],
    queryFn: () => requestDB.recordDetail(record!.id),
    enabled: open,
  });
  const data = detail.data ?? record;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl!">
        {data ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 font-mono text-sm">
                #{data.id}{" "}
                <StatusPill
                  failed={data.failed}
                  statusCode={data.status_code}
                  recordId={data.id}
                  errorBody={data.error_body}
                  responseHeaders={data.response_headers}
                  responsePreview={data.response_preview}
                />
                <CopyButton text={data.request_id} />
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">{data.request_id}</SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="overview" className="mt-2">
              <TabsList className="w-full flex-wrap">
                <TabsTrigger value="overview">{t("requestLogs.detail.overview")}</TabsTrigger>
                <TabsTrigger value="headers">{t("requestLogs.detail.headers")}</TabsTrigger>
                {data.error_body ? <TabsTrigger value="error">{t("requestLogs.detail.error")}</TabsTrigger> : null}
                {data.request_preview || data.response_preview ? <TabsTrigger value="preview">{t("requestLogs.detail.preview")}</TabsTrigger> : null}
                {data.token_breakdown ? <TabsTrigger value="breakdown">{t("requestLogs.detail.breakdown")}</TabsTrigger> : null}
              </TabsList>
              <TabsContent value="overview" className="space-y-3">
                {data.timing_breakdown ? (
                  <TimingBreakdownCard timing={data.timing_breakdown} latencyMs={data.latency_ms} />
                ) : null}
                <DetailList
                  rows={[
                    [t("common.time"), formatTime(data.requested_at, true)],
                    [t("requestLogs.table.latency"), formatDuration(data.latency_ms)],
                    [t("requestLogs.table.ttft"), data.ttft_ms > 0 ? formatDuration(data.ttft_ms) : "—"],
                    [t("requestLogs.table.tps"), data.failed ? "—" : formatTPS(computeTPS(data.output_tokens, data.latency_ms))],
                    [t("requestLogs.detail.cost", "预估价格"), data.failed && !data.estimated_cost_usd ? "—" : formatUSD(data.estimated_cost_usd)],
                    (() => {
                      const totalInput = resolveTotalInputTokens(data);
                      const inputLabel = totalInput !== (data.input_tokens || 0)
                        ? `${formatInt(totalInput)} (uncached: ${formatInt(data.input_tokens)})`
                        : formatInt(data.input_tokens);
                      return ["Input / Output / Reasoning", `${inputLabel} / ${formatInt(data.output_tokens)} / ${formatInt(data.reasoning_tokens)}`];
                    })(),
                    ["Cached", `${formatInt(data.cached_tokens)} · read ${formatInt(data.cache_read_tokens)} · create ${formatInt(data.cache_creation_tokens)} (hit: ${computeCacheHitRate(data)})`],
                    [t("requestLogs.detail.endpoint"), data.endpoint || "—"],
                    [t("requestLogs.detail.requestedModel", "请求模型"), data.alias?.trim() || data.model?.trim() || "—"],
                    [t("requestLogs.detail.upstreamModel", "实际模型"), data.model?.trim() || data.alias?.trim() || "—"],
                    [t("requestLogs.detail.responseModel", "响应模型"), data.response_model?.trim() || "—"],
                    [t("common.provider"), resolveProviderLabel(data) || "—"],
                    [t("requestLogs.detail.authType", "认证方式"), formatAuthTypeBadge(data.auth_type) || data.auth_type || "—"],
                    [t("requestLogs.detail.auth"), data.auth_id || data.auth_index ? `${data.auth_id || ""} ${data.auth_index ? `(#${data.auth_index})` : ""}` : "—"],
                    [t("common.apiKey"), data.api_key ? maskKey(data.api_key) : "—"],
                    [t("requestLogs.detail.baseUrl"), data.base_url || "—"],
                    [t("requestLogs.detail.session"), data.session_id || "—"],
                    [t("requestLogs.detail.clientIp"), data.client_ip || "—"],
                    [t("requestLogs.detail.userAgent"), data.user_agent || "—"],
                    [t("requestLogs.detail.tier"), (() => {
                      const resp = data.response_service_tier?.trim();
                      const sent = data.effective_service_tier?.trim();
                      const req = data.service_tier?.trim();
                      const primary = resp || sent || req;
                      if (!primary) return "—";
                      if (resp && sent && sent !== resp) {
                        return `${resp} (${t("requestLogs.detail.sentTier", "发送上游层级")}: ${sent})`;
                      }
                      return primary;
                    })()],
                    [t("requestLogs.detail.reasoning"), (() => {
                      const req = data.requested_reasoning_effort?.trim();
                      const act = data.reasoning_effort?.trim();
                      if (req && act && req !== act) {
                        return `${req} → ${act}`;
                      }
                      return act || req || "—";
                    })()],
                    ["Stream", String(data.stream)],
                  ]}
                />
                {data.trace_id ? (
                  <Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={() => onTrace(data.trace_id!)}>
                    {t("requestLogs.detail.relatedTrace")} · {data.trace_id}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full text-xs"
                  onClick={async () => {
                    try {
                      await fileLogs.downloadRequestLog(data.request_id);
                    } catch (error) {
                      toast.error(errMessage(error));
                    }
                  }}
                >
                  <Download className="size-3.5" />
                  {t("requestLogs.detail.openFullLog")}
                </Button>
              </TabsContent>
              <TabsContent value="headers" className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-medium">{t("requestLogs.detail.requestHeaders")}</p>
                  <JsonView value={data.request_headers ?? {}} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">{t("requestLogs.detail.responseHeaders")}</p>
                  <JsonView value={data.response_headers ?? {}} />
                </div>
              </TabsContent>
              {data.error_body ? (
                <TabsContent value="error">
                  <JsonView value={data.error_body} />
                </TabsContent>
              ) : null}
              {data.request_preview || data.response_preview ? (
                <TabsContent value="preview" className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-medium">Request</p>
                    <JsonView value={data.request_preview ?? ""} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium">Response</p>
                    <JsonView value={data.response_preview ?? ""} />
                  </div>
                </TabsContent>
              ) : null}
              {data.token_breakdown ? (
                <TabsContent value="breakdown">
                  <JsonView value={data.token_breakdown} />
                </TabsContent>
              ) : null}
            </Tabs>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>{t("common.loading")}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
