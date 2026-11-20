import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, DatabaseZap, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { requestDB } from "@/api/management";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("size-6 p-0", className)}
      title={label ?? t("common.copy")}
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function formatJsonOrText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return trimmed;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ErrorStatusHoverCard({
  children,
  statusCode,
  recordId,
  errorBody,
  responseHeaders,
  responsePreview,
}: {
  children: ReactNode;
  statusCode?: number;
  recordId?: number;
  errorBody?: string;
  responseHeaders?: Record<string, string> | unknown;
  responsePreview?: string;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["rdb", "detail", recordId],
    queryFn: () => requestDB.recordDetail(recordId!),
    enabled: isOpen && !errorBody && typeof recordId === "number" && recordId > 0,
    staleTime: Infinity,
  });

  const rawError = errorBody ?? detailQuery.data?.error_body;
  const rawPreview = responsePreview ?? detailQuery.data?.response_preview;
  const rawHeaders = responseHeaders ?? detailQuery.data?.response_headers;

  const formattedError = useMemo(() => {
    return formatJsonOrText(rawError || rawPreview);
  }, [rawError, rawPreview]);

  const formattedHeaders = useMemo(() => {
    if (!rawHeaders) return "";
    if (typeof rawHeaders === "object" && !Array.isArray(rawHeaders) && Object.keys(rawHeaders as object).length === 0) {
      return "";
    }
    return formatJsonOrText(rawHeaders);
  }, [rawHeaders]);

  const textToCopy = useMemo(() => {
    const parts: string[] = [];
    if (formattedError) parts.push(formattedError);
    if (formattedHeaders) parts.push(`Headers:\n${formattedHeaders}`);
    return parts.join("\n\n");
  }, [formattedError, formattedHeaders]);

  return (
    <HoverCard openDelay={150} closeDelay={150} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[460px] max-w-[90vw] p-0 shadow-2xl border border-rose-500/25 bg-popover text-popover-foreground rounded-xl overflow-hidden z-50 animate-in fade-in-0 zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5">
          <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-rose-600 dark:text-rose-400">
            <span className="size-1.5 rounded-full bg-rose-500 shrink-0" />
            <span>HTTP {statusCode || "ERR"}</span>
          </div>
          {textToCopy ? (
            <CopyButton
              text={textToCopy}
              className="size-6 text-muted-foreground hover:text-foreground"
              label={t("requestLogs.copyError") || t("common.copy")}
            />
          ) : null}
        </div>
        <div className="max-h-72 overflow-auto p-3 text-xs font-mono leading-relaxed select-text space-y-2.5">
          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
              <Loader2 className="size-4 animate-spin text-rose-500" />
              <span className="text-xs">{t("common.loading") || "加载中..."}</span>
            </div>
          ) : textToCopy ? (
            <>
              {formattedError ? (
                <pre className="whitespace-pre-wrap break-all text-[11px] font-mono text-foreground/90 bg-muted/30 rounded-lg p-2.5 border border-border/40">
                  {formattedError}
                </pre>
              ) : null}
              {formattedHeaders ? (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                    Response Headers
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-[10px] font-mono text-muted-foreground bg-muted/20 rounded-lg p-2 border border-border/30">
                    {formattedHeaders}
                  </pre>
                </div>
              ) : null}
            </>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground italic">
              {t("requestLogs.noErrorBody") || "无错误响应内容"}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/** Success / failure pill for request records. */
export function StatusPill({
  failed,
  statusCode,
  recordId,
  errorBody,
  responseHeaders,
  responsePreview,
}: {
  failed: boolean;
  statusCode?: number;
  recordId?: number;
  errorBody?: string;
  responseHeaders?: Record<string, string> | unknown;
  responsePreview?: string;
}) {
  const isError = failed || (typeof statusCode === "number" && statusCode >= 400);
  if (!isError) {
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono">
        {statusCode || 200}
      </Badge>
    );
  }
  const code = statusCode && statusCode !== 200 ? statusCode : "ERR";
  const badge = (
    <Badge
      variant="outline"
      className="cursor-pointer border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono hover:bg-rose-500/20 transition-colors"
    >
      {code}
    </Badge>
  );

  if (recordId == null && !errorBody && !responsePreview) {
    return badge;
  }

  return (
    <ErrorStatusHoverCard
      statusCode={statusCode}
      recordId={recordId}
      errorBody={errorBody}
      responseHeaders={responseHeaders}
      responsePreview={responsePreview}
    >
      {badge}
    </ErrorStatusHoverCard>
  );
}

export function SampledBadge({ sampled }: { sampled: boolean }) {
  const { t } = useTranslation();
  if (!sampled) return null;
  return (
    <Badge variant="outline" className="text-muted-foreground text-[10px]">
      {t("common.sampled")}
    </Badge>
  );
}

/** Shown on analytics pages when the request database is switched off. */
export function RequestDBDisabled({ onOpenConfig }: { onOpenConfig?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 px-6 py-16 text-center">
      <div className="bg-secondary flex size-12 items-center justify-center rounded-2xl">
        <DatabaseZap className="text-muted-foreground size-6" />
      </div>
      <div>
        <p className="font-medium">{t("common.requestDBDisabled")}</p>
        <p className="text-muted-foreground mt-1 max-w-md text-sm">{t("common.requestDBDisabledHint")}</p>
      </div>
      {onOpenConfig ? (
        <Button size="sm" variant="outline" onClick={onOpenConfig}>
          {t("common.openConfig")}
        </Button>
      ) : null}
    </div>
  );
}

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="group/json relative">
      {text ? (
        <div className="absolute top-2 right-2 z-10 opacity-70 transition-opacity group-hover/json:opacity-100">
          <CopyButton text={text} className="size-6 rounded-md bg-background/80 backdrop-blur-xs border border-border/60 shadow-2xs" />
        </div>
      ) : null}
      <pre className={cn("bg-secondary/60 max-h-[420px] overflow-auto rounded-xl border border-border/50 p-3 pr-9 font-mono text-xs leading-relaxed select-text", className)}>
        {text}
      </pre>
    </div>
  );
}

export function SectionCard({ title, hint, actions, children, className }: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card-surface", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/** Key–value detail rows with hairline separators; values wrap instead of truncating. */
export function DetailList({ rows, className }: { rows: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("text-sm", className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[8.5rem_1fr] items-baseline gap-x-3 border-b border-border/50 py-2.5 last:border-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-mono text-xs leading-relaxed">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
