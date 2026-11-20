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
    <Card className={cn("card-surface gap-0 py-4 sm:py-5 transition-all duration-200 hover:border-primary/30 hover:shadow-md", className)}>
      <CardContent className="flex items-start justify-between gap-3 px-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-24 rounded-lg" />
          ) : (
            <p className={cn("mt-1 truncate text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight tabular-nums font-mono text-foreground", valueClassName)}>{value}</p>
          )}
          {sub && !loading ? <div className="text-muted-foreground mt-1.5 text-xs">{sub}</div> : null}
        </div>
        {Icon ? (
          <div className="bg-primary/10 text-primary flex size-10 sm:size-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-primary/15">
            <Icon className="size-5" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
