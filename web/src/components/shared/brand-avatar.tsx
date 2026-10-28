import avatarImage from "@/assets/avatar.png";
import { cn } from "@/lib/utils";

type BrandAvatarProps = {
  size?: number;
  online?: boolean;
  className?: string;
};

/** Circular brand avatar with an optional online badge. */
export function BrandAvatar({ size = 40, online = true, className }: BrandAvatarProps) {
  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <div
        style={{ width: size, height: size }}
        className="relative overflow-hidden rounded-full border-2 border-white/90 bg-gradient-to-b from-blue-50/80 to-blue-100/60 shadow-sm ring-1 ring-blue-200/50 dark:border-slate-800 dark:from-slate-800 dark:to-slate-900 dark:ring-blue-900/40"
      >
        <img src={avatarImage} alt="" className="size-full rounded-full object-cover" />
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white dark:border-slate-900",
            online ? "bg-emerald-500" : "bg-slate-400",
          )}
        />
      )}
    </div>
  );
}
