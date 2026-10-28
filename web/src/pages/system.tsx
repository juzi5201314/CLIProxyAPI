import { useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  Bug,
  Clock3,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Github,
  Link2,
  Puzzle,
  ShieldCheck,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import faviconImage from "@/assets/favicon.png";
import faceImage from "@/assets/face-1.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { client } from "@/api/client";
import { server } from "@/api/management";
import { errMessage } from "@/api/types";
import { useAuthStore } from "@/stores/auth";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANNELS = ["gemini", "gemini-interactions", "claude", "codex", "antigravity", "vertex", "aistudio", "kimi", "xai", "devin", "meta"];
const PROJECT_URL = "https://github.com/juzi5201314/CLIProxyAPI";

type StaticModel = {
  id?: string;
  display_name?: string;
};

type InfoCardProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  overflowVisible?: boolean;
};

export function SystemPage() {
  const { t } = useTranslation();
  const info = useQuery({ queryKey: ["server-info"], queryFn: server.info });
  const latest = useQuery({ queryKey: ["latest-version"], queryFn: server.latestVersion, staleTime: 300_000 });
  const [channel, setChannel] = useState("gemini");
  const models = useQuery({
    queryKey: ["model-definitions", channel],
    queryFn: async () => {
      const { data } = await client.get<{ models: StaticModel[] }>(`/routing/model-definitions/${channel}`);
      return data.models;
    },
    staleTime: 300_000,
    retry: false,
  });

  const upToDate =
    latest.data && info.data?.version
      ? latest.data.replace(/^v/, "").startsWith(info.data.version.replace(/-s$/, ""))
      : null;

  return (
    <>
      <PageHeader title={t("nav.systemItem")} subtitle={t("system.subtitle")} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t("system.version")} value={info.data ? `v${info.data.version}` : "—"} sub={info.data?.commit} icon={ShieldCheck} loading={info.isLoading} valueClassName="text-xl sm:text-2xl" />
        <StatCard label={t("system.uptime")} value={info.data ? formatDuration(info.data.uptime_seconds * 1000) : "—"} icon={Clock3} loading={info.isLoading} valueClassName="text-xl sm:text-2xl" />
        <StatCard label={t("system.buildDate")} value={info.data?.build_date ?? "—"} icon={Cpu} loading={info.isLoading} valueClassName="text-xl sm:text-2xl" />
        <StatCard
          label={t("system.latest")}
          value={latest.data ? `v${latest.data.replace(/^v/, "")}` : "—"}
          sub={
            upToDate === null ? undefined : upToDate ? (
              <span className="text-emerald-500">{t("system.upToDate")}</span>
            ) : (
              <span className="text-amber-500">{t("system.updateAvailable")}</span>
            )
          }
          icon={Download}
          loading={latest.isLoading}
          valueClassName="text-xl sm:text-2xl"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <InfoCard icon={Activity} title={t("system.runtime")} hint={t("system.runtimeHint")} className="h-full">
          <div className="space-y-2.5">
            <CapabilityRow
              icon={Puzzle}
              label={t("system.pluginSupport")}
              hint={t("system.pluginSupportHint")}
              enabled={info.data ? info.data.plugin_support === "true" : undefined}
              loading={info.isLoading}
            />
            <CapabilityRow
              icon={Database}
              label={t("system.requestDb")}
              hint={t("system.requestDbHint")}
              enabled={info.data?.request_db.enabled}
              loading={info.isLoading}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-9 w-full justify-start gap-2 rounded-xl text-xs text-muted-foreground hover:border-destructive/30 hover:text-destructive"
            onClick={() => {
              useAuthStore.getState().clear();
              toast.success(t("system.clearedLocal"));
            }}
          >
            <Trash2 className="size-3.5" />
            {t("system.clearLocalData")}
          </Button>
        </InfoCard>

        <InfoCard
          icon={Github}
          title={t("system.project")}
          hint={t("system.projectHint")}
          className="h-full"
          contentClassName="flex flex-col"
          overflowVisible
          actions={
            <div className="relative h-9 w-[68px]">
              <img
                src={faceImage}
                alt=""
                className="absolute right-0 -bottom-6 h-[68px] w-[68px] object-contain"
              />
            </div>
          }
        >
          <div className="flex flex-1 items-center">
            <div className="flex items-start gap-3">
              <img
                src={faviconImage}
                alt=""
                className="size-12 shrink-0 rounded-2xl border border-border/60 bg-muted/30 object-contain p-1.5"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">CLIProxyAPI</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("system.projectDesc")}</p>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <a
              href={PROJECT_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/25 px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Link2 className="size-3.5 shrink-0" />
                <span className="truncate">github.com/juzi5201314/CLIProxyAPI</span>
              </span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <ProjectLink href={`${PROJECT_URL}/releases`} icon={Tag} label={t("system.releases")} />
              <ProjectLink href={`${PROJECT_URL}/issues`} icon={Bug} label={t("system.issues")} />
            </div>
          </div>
        </InfoCard>
      </div>

      <InfoCard
        icon={Boxes}
        title={t("system.models")}
        hint={t("system.modelsHint")}
        actions={<Badge variant="outline" className="font-mono text-[10px]">{models.data?.length ?? "—"}</Badge>}
        className="mt-5"
      >
        <div className="flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/30 p-1">
          {CHANNELS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setChannel(name)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-mono transition",
                channel === name
                  ? "bg-background text-primary shadow-xs ring-1 ring-border/60"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {models.isFetching ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-9 animate-pulse rounded-xl bg-muted/50" />
              ))}
            </div>
          ) : models.error ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-10 text-center">
              <Boxes className="size-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{errMessage(models.error)}</p>
            </div>
          ) : (models.data?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-10 text-center">
              <Boxes className="size-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{t("system.noModels")}</p>
            </div>
          ) : (
            <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
              {models.data?.map((model, index) => (
                <div
                  key={model.id ?? index}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2"
                >
                  <span className="truncate font-mono text-xs">{model.id ?? "?"}</span>
                  {model.display_name ? (
                    <span className="shrink-0 truncate text-[10px] text-muted-foreground">{model.display_name}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </InfoCard>
    </>
  );
}

function InfoCard({ icon: Icon, title, hint, actions, children, className, contentClassName, overflowVisible }: InfoCardProps) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xs dark:border-slate-800/80 dark:bg-slate-900/90",
        overflowVisible ? "overflow-visible" : "overflow-hidden",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 overflow-visible border-b border-border/60 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("flex-1 p-5", contentClassName)}>{children}</div>
    </section>
  );
}

function CapabilityRow({
  icon: Icon,
  label,
  hint,
  enabled,
  loading,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  enabled?: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/25 px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border/60">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium">{label}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>
        </div>
      </div>
      {loading ? (
        <span className="h-5 w-12 animate-pulse rounded-full bg-muted" />
      ) : enabled === undefined ? (
        <Badge variant="outline" className="shrink-0 text-[10px]">—</Badge>
      ) : (
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-[10px]",
            enabled
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        >
          {enabled ? t("common.enabled") : t("common.disabled")}
        </Badge>
      )}
    </div>
  );
}

function ProjectLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/25 px-3.5 py-2.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
    >
      <span className="flex items-center gap-2">
        <Icon className="size-3.5" />
        {label}
      </span>
      <ExternalLink className="size-3.5" />
    </a>
  );
}
