import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronRight,
  KeyRound,
  PanelRight,
  Settings2,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { server, credentials, requestDB } from "@/api/management";
import { formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface InspectorDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function InspectorDrawer({ open, onClose }: InspectorDrawerProps) {
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

  if (!visible) return null;

  const totalAuthFiles = authFiles.data?.files?.length ?? 0;
  const activeAuthFiles = authFiles.data?.files?.filter((f) => !f.disabled && !f.unavailable)?.length ?? 0;

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
          "fixed inset-y-0 right-0 z-50 flex w-80 sm:w-88 flex-col border-l border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-xl transition-all duration-300 dark:border-slate-800/80 dark:bg-slate-900/95 select-none",
          closing
            ? "animate-out slide-out-to-right duration-200 fill-mode-forwards"
            : "animate-in slide-in-from-right duration-200",
        )}
      >
      {/* Top Banner Header */}
      <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <PanelRight className="size-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
              网关测控状态
            </h3>
            <p className="text-[10px] text-slate-400">CLIProxyAPI · 实时状态概览</p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5">
        {/* Gateway Health & Version Card */}
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800/60 dark:bg-slate-800/40">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">网关在线</span>
            </div>
            {info.data ? (
              <Badge variant="outline" className="font-mono text-[10px] border-slate-200 dark:border-slate-700">
                v{info.data.version}
              </Badge>
            ) : null}
          </div>

          <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">运行时长</span>
              <span className="font-mono font-medium">
                {info.data ? formatDuration(info.data.uptime_seconds * 1000) : "连接中..."}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Git Commit</span>
              <span className="font-mono text-slate-500 truncate max-w-[120px]">
                {info.data?.commit || "—"}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">活跃凭据</span>
              <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                {activeAuthFiles} / {totalAuthFiles}
              </span>
            </div>
          </div>
        </div>

        {/* 24h Traffic & Request Stats */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">请求指标统计</span>
            <span className="text-[10px] text-slate-400">实时统计</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 block">累计请求</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                {stats.data ? formatNumber(stats.data.total_requests) : "—"}
              </span>
            </div>
            <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 block">失败请求</span>
              <span className={`font-mono font-bold ${stats.data?.failed_requests ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                {stats.data ? formatNumber(stats.data.failed_requests) : "—"}
              </span>
            </div>
            <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 block">消耗 Token</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                {stats.data ? formatNumber(stats.data.total_tokens) : "—"}
              </span>
            </div>
            <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 block">平均延迟</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                {stats.data && stats.data.latency_avg_ms > 0 ? `${Math.round(stats.data.latency_avg_ms)} ms` : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Direct Jump Links */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold text-slate-400 px-1 uppercase tracking-wider block">
            功能导航直达
          </span>

          <button
            type="button"
            onClick={() => handleNav("/playground")}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5 text-left transition hover:bg-blue-50/70 hover:border-blue-200 dark:border-slate-800/60 dark:bg-slate-800/40 dark:hover:bg-slate-800"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
                <Terminal className="size-3.5" />
              </div>
              <div>
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">接口调试 (Playground)</span>
                <p className="text-[10px] text-slate-400">模型实时推理与流式测控</p>
              </div>
            </div>
            <ChevronRight className="size-4 text-slate-400" />
          </button>

          <button
            type="button"
            onClick={() => handleNav("/providers")}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5 text-left transition hover:bg-blue-50/70 hover:border-blue-200 dark:border-slate-800/60 dark:bg-slate-800/40 dark:hover:bg-slate-800"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                <Zap className="size-3.5" />
              </div>
              <div>
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">供应商管理</span>
                <p className="text-[10px] text-slate-400">上游模型映射与端点配置</p>
              </div>
            </div>
            <ChevronRight className="size-4 text-slate-400" />
          </button>

          <button
            type="button"
            onClick={() => handleNav("/auth-files")}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5 text-left transition hover:bg-blue-50/70 hover:border-blue-200 dark:border-slate-800/60 dark:bg-slate-800/40 dark:hover:bg-slate-800"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                <KeyRound className="size-3.5" />
              </div>
              <div>
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">凭据文件</span>
                <p className="text-[10px] text-slate-400">{totalAuthFiles} 个凭据管理与健康检查</p>
              </div>
            </div>
            <ChevronRight className="size-4 text-slate-400" />
          </button>

          <button
            type="button"
            onClick={() => handleNav("/request-logs")}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5 text-left transition hover:bg-blue-50/70 hover:border-blue-200 dark:border-slate-800/60 dark:bg-slate-800/40 dark:hover:bg-slate-800"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400">
                <Activity className="size-3.5" />
              </div>
              <div>
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">请求日志</span>
                <p className="text-[10px] text-slate-400">全链路请求追踪与诊断</p>
              </div>
            </div>
            <ChevronRight className="size-4 text-slate-400" />
          </button>

          <button
            type="button"
            onClick={() => handleNav("/config")}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5 text-left transition hover:bg-blue-50/70 hover:border-blue-200 dark:border-slate-800/60 dark:bg-slate-800/40 dark:hover:bg-slate-800"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
                <Settings2 className="size-3.5" />
              </div>
              <div>
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">系统配置</span>
                <p className="text-[10px] text-slate-400">YAML 配置与热重载</p>
              </div>
            </div>
            <ChevronRight className="size-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Slogan Footer */}
      <div className="border-t border-slate-200/80 p-3 dark:border-slate-800/80 text-center">
        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
          CLIProxyAPI 智能网关
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          高性能 AI API 聚合代理与负载分发
        </p>
      </div>
    </aside>
    </>
  );
}
