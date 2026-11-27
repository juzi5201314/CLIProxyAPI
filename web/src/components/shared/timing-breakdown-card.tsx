import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RequestTimingBreakdown } from "@/api/types";
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TimingBreakdownCardProps {
  timing: RequestTimingBreakdown;
  latencyMs: number;
}

interface TimingSegment {
  key: string;
  label: string;
  ms: number;
  barClass: string;
  dotClass: string;
  subItems?: { key: string; label: string; ms: number }[];
}

function formatTimingMs(ms: number | undefined): string {
  const value = ms ?? 0;
  if (value <= 0) return "0ms";
  if (value < 1000) return `${Math.round(value)}ms`;
  return formatDuration(value);
}

export function TimingBreakdownCard({ timing, latencyMs }: TimingBreakdownCardProps) {
  const { t } = useTranslation();

  const inboundQueueMs = timing.inbound_queue_ms ?? 0;
  const cpaOverheadMs = timing.cpa_overhead_ms ?? 0;
  const dnsMs = timing.dns_ms ?? 0;
  const connectMs = timing.connect_ms ?? 0;
  const tlsMs = timing.tls_ms ?? 0;
  const connAcquireMs = timing.conn_acquire_ms ?? 0;
  const requestWriteMs = timing.request_write_ms ?? 0;
  const serverWaitMs = timing.server_wait_ms ?? 0;
  const firstTokenWaitMs = timing.first_token_wait_ms ?? 0;
  const streamTransferMs = timing.stream_transfer_ms ?? 0;

  const connSubItems: { key: string; label: string; ms: number }[] = [];
  if (dnsMs > 0 || connectMs > 0 || tlsMs > 0) {
    connSubItems.push(
      { key: "dns", label: t("requestLogs.detail.timing.dns"), ms: dnsMs },
      { key: "connect", label: t("requestLogs.detail.timing.connect"), ms: connectMs },
      { key: "tls", label: t("requestLogs.detail.timing.tls"), ms: tlsMs },
    );
  }

  const segments: TimingSegment[] = [
    {
      key: "cpa_overhead",
      label: t("requestLogs.detail.timing.cpaOverhead"),
      ms: cpaOverheadMs,
      barClass: "bg-indigo-500",
      dotClass: "bg-indigo-500",
    },
    {
      key: "conn_acquire",
      label: t("requestLogs.detail.timing.connAcquire"),
      ms: connAcquireMs,
      barClass: "bg-amber-500",
      dotClass: "bg-amber-500",
      subItems: connSubItems,
    },
    {
      key: "request_write",
      label: t("requestLogs.detail.timing.requestWrite"),
      ms: requestWriteMs,
      barClass: "bg-orange-500",
      dotClass: "bg-orange-500",
    },
    {
      key: "server_wait",
      label: t("requestLogs.detail.timing.serverWait"),
      ms: serverWaitMs,
      barClass: "bg-sky-500",
      dotClass: "bg-sky-500",
    },
    {
      key: "first_token_wait",
      label: t("requestLogs.detail.timing.firstTokenWait"),
      ms: firstTokenWaitMs,
      barClass: "bg-violet-500",
      dotClass: "bg-violet-500",
    },
    {
      key: "stream_transfer",
      label: t("requestLogs.detail.timing.streamTransfer"),
      ms: streamTransferMs,
      barClass: "bg-emerald-500",
      dotClass: "bg-emerald-500",
    },
  ];

  const trackedSum = segments.reduce((acc, seg) => acc + seg.ms, 0);
  const barDenom = Math.max(latencyMs, trackedSum, 1);
  const cpaLocalTotal = inboundQueueMs + cpaOverheadMs;
  const networkUploadTotal = connAcquireMs + requestWriteMs;
  const upstreamStreamTotal = serverWaitMs + firstTokenWaitMs + streamTransferMs;

  const isHTTP = timing.upstream_transport === "http" || (timing.round_trips ?? 0) > 0;

  return (
    <div className="bg-muted/30 space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-xs font-medium">{t("requestLogs.detail.timing.title")}</span>
        <div className="flex flex-wrap items-center gap-1">
          {timing.upstream_transport ? (
            <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] uppercase">
              {timing.upstream_transport}
            </Badge>
          ) : null}
          {isHTTP ? (
            timing.conn_reused ? (
              <Badge
                variant="outline"
                className="h-5 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
              >
                {t("requestLogs.detail.timing.connReused")}
                {timing.conn_was_idle && (timing.conn_idle_ms ?? 0) > 0
                  ? ` · ${t("requestLogs.detail.timing.connIdle", { duration: formatTimingMs(timing.conn_idle_ms) })}`
                  : ""}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
              >
                {t("requestLogs.detail.timing.connNew")}
              </Badge>
            )
          ) : null}
          {(timing.request_bytes ?? 0) > 0 ? (
            <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
              {t("requestLogs.detail.timing.requestSize", { size: formatBytes(timing.request_bytes) })}
            </Badge>
          ) : null}
          {(timing.round_trips ?? 0) > 1 ? (
            <Badge
              variant="outline"
              className="h-5 border-rose-500/40 bg-rose-500/10 px-1.5 text-[10px] text-rose-600 dark:text-rose-400"
            >
              {t("requestLogs.detail.timing.roundTrips", { count: timing.round_trips })}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* 3-bucket quick attribution summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-background/70 rounded-md border px-2.5 py-1.5">
          <div className="text-muted-foreground truncate text-[10px]">{t("requestLogs.detail.timing.cpaLocal")}</div>
          <div className="font-mono text-xs font-semibold tabular-nums">{formatTimingMs(cpaLocalTotal)}</div>
        </div>
        <div className="bg-background/70 rounded-md border px-2.5 py-1.5">
          <div className="text-muted-foreground truncate text-[10px]">{t("requestLogs.detail.timing.networkAndUpload")}</div>
          <div className="font-mono text-xs font-semibold tabular-nums">{formatTimingMs(networkUploadTotal)}</div>
        </div>
        <div className="bg-background/70 rounded-md border px-2.5 py-1.5">
          <div className="text-muted-foreground truncate text-[10px]">{t("requestLogs.detail.timing.upstreamAndStream")}</div>
          <div className="font-mono text-xs font-semibold tabular-nums">{formatTimingMs(upstreamStreamTotal)}</div>
        </div>
      </div>

      {/* Stacked proportion bar */}
      {trackedSum > 0 ? (
        <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
          {segments.map((seg) => {
            if (seg.ms <= 0) return null;
            const pct = (seg.ms / barDenom) * 100;
            return (
              <Tooltip key={seg.key}>
                <TooltipTrigger asChild>
                  <div
                    className={cn("h-full transition-opacity hover:opacity-80", seg.barClass)}
                    style={{ width: `${Math.max(pct, 1.5)}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-xs">
                  {seg.label}: {formatTimingMs(seg.ms)} ({pct.toFixed(1)}%)
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ) : null}

      {/* Phase table */}
      <div className="space-y-1 text-xs">
        {inboundQueueMs > 0 ? (
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-b border-dashed pb-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="bg-muted-foreground/50 size-2 shrink-0 rounded-full" />
              <span className="truncate">{t("requestLogs.detail.timing.inboundQueue")}</span>
              <span className="text-[10px] opacity-75">({t("requestLogs.detail.timing.inboundQueueHint")})</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">{formatTimingMs(inboundQueueMs)}</span>
          </div>
        ) : null}

        {segments.map((seg) => {
          const pct = barDenom > 0 ? (seg.ms / barDenom) * 100 : 0;
          return (
            <div key={seg.key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("size-2 shrink-0 rounded-full", seg.dotClass)} />
                  <span className="text-muted-foreground truncate">{seg.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
                  <span className="text-muted-foreground w-10 text-right text-[10px]">
                    {seg.ms > 0 ? `${pct.toFixed(0)}%` : "—"}
                  </span>
                  <span className={cn("w-16 text-right", seg.ms === 0 && "text-muted-foreground/60")}>
                    {formatTimingMs(seg.ms)}
                  </span>
                </span>
              </div>
              {seg.subItems && seg.subItems.length > 0 ? (
                <div className="border-muted-foreground/20 ml-3.5 space-y-0.5 border-l pl-2.5 text-[11px]">
                  {seg.subItems.map((sub) => (
                    <div key={sub.key} className="text-muted-foreground flex items-center justify-between gap-2">
                      <span className="truncate">{sub.label}</span>
                      <span className={cn("font-mono tabular-nums", sub.ms === 0 && "opacity-60")}>
                        {formatTimingMs(sub.ms)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
