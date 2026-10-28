import type { ComponentType, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  loading?: boolean;
  className?: string;
  valueClassName?: string;
};

export function StatCard({ label, value, sub, icon: Icon, loading, className, valueClassName }: StatCardProps) {
  return (
    <Card className={cn("gap-0 py-5 rounded-2xl border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 shadow-2xs hover:shadow-xs transition", className)}>
      <CardContent className="flex items-start justify-between gap-4 px-5">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-24 rounded-lg" />
          ) : (
            <p className={cn("mt-1 truncate text-2xl sm:text-3xl font-bold tracking-tight tabular-nums font-mono text-slate-900 dark:text-slate-100", valueClassName)}>{value}</p>
          )}
          {sub && !loading ? <div className="text-muted-foreground mt-1.5 text-xs">{sub}</div> : null}
        </div>
        {Icon ? (
          <div className="bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <Icon className="size-5" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
