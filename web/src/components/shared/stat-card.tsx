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
    <Card className={cn("card-surface gap-0 py-4 sm:py-5", className)}>
      <CardContent className="px-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground/60" /> : null}
        </div>
        {loading ? (
          <Skeleton className="mt-2.5 h-8 w-24 rounded-md" />
        ) : (
          <p className={cn("mt-2 truncate text-2xl sm:text-[26px] font-semibold tracking-tight tabular-nums font-mono text-foreground", valueClassName)}>
            {value}
          </p>
        )}
        {sub && !loading ? <div className="text-muted-foreground mt-1.5 text-xs">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
