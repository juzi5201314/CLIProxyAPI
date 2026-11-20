import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronRight,
  KeyRound,
  RefreshCw,
  Settings2,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { server, credentials, requestDB } from "@/api/management";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface InspectorDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function InspectorDrawer({ open, onClose }: InspectorDrawerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ["server-info"], queryFn: server.info, staleTime: 60_000 });
  const authFiles = useQuery({ queryKey: ["auth-files"], queryFn: () => credentials.list(), staleTime: 30_000 });
  const stats = useQuery({
    queryKey: ["request-db-quick-stats"],
    queryFn: () => requestDB.stats({}),
    staleTime: 30_000,
  });

  const [visible, setVisible] = useState(open);
  const closing = !open && visible;

  useEffect(() => {
    if (open) {
      if (!visible) setVisible(true);
      return;
    }
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!visible) return null;

  const totalAuthFiles = authFiles.data?.files?.length ?? 0;
  const activeAuthFiles = authFiles.data?.files?.filter((f) => !f.disabled && !f.unavailable)?.length ?? 0;
  const totalReqs = stats.data?.total_requests ?? 0;
  const failedReqs = stats.data?.failed_requests ?? 0;
  const successRate = totalReqs > 0 ? (totalReqs - failedReqs) / totalReqs : 1;
  const isRefreshing = info.isFetching || authFiles.isFetching || stats.isFetching;

  const handleRefresh = () => {
    void info.refetch();
    void authFiles.refetch();
    void stats.refetch();
  };

  const handleNav = (to: string) => {
    navigate(to);
    onClose();
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-[2px] dark:bg-black/50",
          closing
            ? "animate-out fade-out duration-200 fill-mode-forwards"
            : "animate-in fade-in duration-200",
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-80 sm:w-88 flex-col border-l border-border bg-card/95 shadow-2xl backdrop-blur-xl transition-all duration-300 select-none",
          closing
            ? "animate-out slide-out-to-right duration-200 fill-mode-forwards"
            : "animate-in slide-in-from-right duration-200",
        )}
      >
        {/* Top Banner Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Activity className="size-4" />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-xs sm:text-sm">
                {t("inspector.title", "网关测控状态")}
              </h3>
              <p className="text-[10px] text-muted-foreground">
                {t("inspector.subtitle", "CLIProxyAPI · 实时状态概览")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-muted-foreground hover:text-foreground"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title={t("common.refresh")}
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title={t("common.close")}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5">
          {/* Gateway Health & Version Card */}
          <div className="rounded-2xl border border-border/80 bg-muted/40 p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {t("inspector.gatewayOnline", "网关在线")}
                </span>
              </div>
              {info.data ? (
                <Badge variant="outline" className="font-mono text-[10px] border-border">
                  v{info.data.version}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-1.5 text-xs text-foreground/80">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">{t("inspector.uptime", "运行时长")}</span>
                <span className="font-mono font-medium text-foreground">
                  {info.data ? formatDuration(info.data.uptime_seconds * 1000) : t("inspector.connecting", "连接中...")}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">{t("inspector.gitCommit", "Git Commit")}</span>
                <span className="font-mono text-muted-foreground truncate max-w-[140px]" title={info.data?.commit}>
                  {info.data?.commit || "—"}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">{t("inspector.activeCredentials", "活跃凭据")}</span>
                <span className="font-mono font-semibold text-primary">
                  {activeAuthFiles} / {totalAuthFiles}
                </span>
              </div>
            </div>
          </div>

          {/* 24h Traffic & Request Stats */}
          <div className="rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-foreground">
                {t("inspector.trafficMetrics", "请求指标统计")}
              </span>
              {stats.data && totalReqs > 0 ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-mono px-1.5 py-0",
                    failedReqs > 0
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {formatPercent(successRate)}
                </Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  {t("inspector.liveStats", "实时统计")}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-muted/50 p-2.5">
                <span className="text-[10px] text-muted-foreground block">
                  {t("inspector.totalRequests", "累计请求")}
                </span>
                <span className="mt-0.5 block font-mono text-sm font-bold text-foreground">
                  {stats.data ? formatNumber(stats.data.total_requests) : "—"}
                </span>
              </div>
              <div className="rounded-xl bg-muted/50 p-2.5">
                <span className="text-[10px] text-muted-foreground block">
                  {t("inspector.failedRequests", "失败请求")}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block font-mono text-sm font-bold",
                    stats.data?.failed_requests ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {stats.data ? formatNumber(stats.data.failed_requests) : "—"}
                </span>
              </div>
              <div className="rounded-xl bg-muted/50 p-2.5">
                <span className="text-[10px] text-muted-foreground block">
                  {t("inspector.totalTokens", "消耗 Token")}
                </span>
                <span className="mt-0.5 block font-mono text-sm font-bold text-foreground">
                  {stats.data ? formatNumber(stats.data.total_tokens) : "—"}
                </span>
              </div>
              <div className="rounded-xl bg-muted/50 p-2.5">
                <span className="text-[10px] text-muted-foreground block">
                  {t("inspector.avgLatency", "平均延迟")}
                </span>
                <span className="mt-0.5 block font-mono text-sm font-bold text-foreground">
                  {stats.data && stats.data.latency_avg_ms > 0 ? `${Math.round(stats.data.latency_avg_ms)} ms` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Direct Jump Links */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground px-1 uppercase tracking-wider block">
              {t("inspector.quickLinks", "功能导航直达")}
            </span>

            <button
              type="button"
              onClick={() => handleNav("/playground")}
              className="group flex w-full items-center justify-between rounded-2xl border border-border/60 bg-muted/30 p-2.5 text-left transition hover:bg-primary/5 hover:border-primary/30 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  <Terminal className="size-3.5" />
                </div>
                <div>
                  <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("inspector.playgroundTitle", "接口调试 (Playground)")}
                  </span>
                  <p className="text-[10px] text-muted-foreground">
                    {t("inspector.playgroundDesc", "模型实时推理与流式测控")}
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
            </button>

            <button
              type="button"
              onClick={() => handleNav("/providers")}
              className="group flex w-full items-center justify-between rounded-2xl border border-border/60 bg-muted/30 p-2.5 text-left transition hover:bg-primary/5 hover:border-primary/30 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Zap className="size-3.5" />
                </div>
                <div>
                  <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("inspector.providersTitle", "供应商管理")}
                  </span>
                  <p className="text-[10px] text-muted-foreground">
                    {t("inspector.providersDesc", "上游模型映射与端点配置")}
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
            </button>

            <button
              type="button"
              onClick={() => handleNav("/auth-files")}
              className="group flex w-full items-center justify-between rounded-2xl border border-border/60 bg-muted/30 p-2.5 text-left transition hover:bg-primary/5 hover:border-primary/30 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <KeyRound className="size-3.5" />
                </div>
                <div>
                  <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("inspector.authFilesTitle", "凭据文件")}
                  </span>
                  <p className="text-[10px] text-muted-foreground">
                    {t("inspector.authFilesDesc", { count: totalAuthFiles, defaultValue: `${totalAuthFiles} 个凭据管理与健康检查` })}
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
            </button>

            <button
              type="button"
              onClick={() => handleNav("/request-logs")}
              className="group flex w-full items-center justify-between rounded-2xl border border-border/60 bg-muted/30 p-2.5 text-left transition hover:bg-primary/5 hover:border-primary/30 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400">
                  <Activity className="size-3.5" />
                </div>
                <div>
                  <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("inspector.requestLogsTitle", "请求日志")}
                  </span>
                  <p className="text-[10px] text-muted-foreground">
                    {t("inspector.requestLogsDesc", "全链路请求追踪与诊断")}
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
            </button>

            <button
              type="button"
              onClick={() => handleNav("/config")}
              className="group flex w-full items-center justify-between rounded-2xl border border-border/60 bg-muted/30 p-2.5 text-left transition hover:bg-primary/5 hover:border-primary/30 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                  <Settings2 className="size-3.5" />
                </div>
                <div>
                  <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("inspector.configTitle", "系统配置")}
                  </span>
                  <p className="text-[10px] text-muted-foreground">
                    {t("inspector.configDesc", "YAML 配置与热重载")}
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
            </button>
          </div>
        </div>

        {/* Slogan Footer */}
        <div className="border-t border-border/80 p-3 text-center">
          <p className="text-[11px] font-medium text-foreground/80">
            {t("inspector.footerTitle", "CLIProxyAPI 智能网关")}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {t("inspector.footerDesc", "高性能 AI API 聚合代理与负载分发")}
          </p>
        </div>
      </aside>
    </>
  );
}
