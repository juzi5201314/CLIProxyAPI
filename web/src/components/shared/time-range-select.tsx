import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TimeRange, TimeRangePreset } from "@/stores/prefs";
import { resolveRange } from "@/stores/prefs";

const PRESETS: TimeRangePreset[] = ["24h", "today", "yesterday", "7d", "30d", "thisMonth"];

interface TimeRangeSelectProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

/** Preset + custom absolute-range picker used by the analytics views. */
export function TimeRangeSelect({ value, onChange }: TimeRangeSelectProps) {
  const { t } = useTranslation();
  const [customOpen, setCustomOpen] = useState(false);
  const resolved = resolveRange(value);
  const label = value.preset === "custom" ? t("common.range.custom") : t(`common.range.${value.preset}`);

  const applyCustom = (from: Date | undefined, to: Date | undefined, close: boolean) => {
    if (!from || !to) return;
    // A bare date input means "whole day": extend the end to 23:59:59.999.
    const toMS = to.getHours() === 0 && to.getMinutes() === 0 ? to.getTime() + 24 * 3_600_000 - 1 : to.getTime();
    onChange({ preset: "custom", from: from.getTime(), to: Math.max(toMS, from.getTime() + 60_000) });
    if (close) setCustomOpen(false);
  };

  return (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border/70 bg-card p-1 shadow-2xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {PRESETS.map((preset) => (
        <Button
          key={preset}
          variant={value.preset === preset ? "secondary" : "ghost"}
          size="sm"
          className={`h-7 shrink-0 rounded-full px-2.5 text-xs ${value.preset === preset ? "bg-primary/10 text-primary font-semibold hover:bg-primary/15" : ""}`}
          onClick={() => onChange({ preset })}
        >
          {t(`common.range.${preset}`)}
        </Button>
      ))}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={value.preset === "custom" ? "secondary" : "ghost"}
            size="sm"
            className={`h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs ${value.preset === "custom" ? "bg-primary/10 text-primary font-semibold hover:bg-primary/15" : ""}`}
          >
            <CalendarClock className="size-3.5" />
            {value.preset === "custom" ? customLabel(resolved.from, resolved.to) : label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-3 rounded-2xl">
          <CustomRangeBody
            from={resolved.from}
            to={resolved.to}
            onApply={(from, to) => applyCustom(from, to, true)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function customLabel(from: number, to: number): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(from)} – ${fmt(to)}`;
}

function CustomRangeBody({
  from,
  to,
  onApply,
}: {
  from: number;
  to: number;
  onApply: (from: Date, to: Date) => void;
}) {
  const { t } = useTranslation();
  const [fromDate, setFromDate] = useState<Date | undefined>(new Date(from));
  const [toDate, setToDate] = useState<Date | undefined>(new Date(to));
  const disabled = !fromDate || !toDate;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("common.range.from", "Start")}</Label>
          <Input
            type="date"
            className="h-8 text-xs"
            value={toDateInput(fromDate)}
            onChange={(event) => setFromDate(fromInputValue(event.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("common.range.to", "End")}</Label>
          <Input
            type="date"
            className="h-8 text-xs"
            value={toDateInput(toDate)}
            onChange={(event) => setToDate(fromInputValue(event.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[7, 30].map((days) => (
          <Button
            key={days}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              const now = new Date();
              const start = new Date(now.getTime() - days * 86_400_000);
              setFromDate(start);
              setToDate(now);
              onApply(start, now);
            }}
          >
            {days}d
          </Button>
        ))}
      </div>
      <Button size="sm" className="h-8 w-full text-xs" disabled={disabled} onClick={() => fromDate && toDate && onApply(fromDate, toDate)}>
        {t("common.apply", "Apply")}
      </Button>
    </div>
  );
}

function toDateInput(date: Date | undefined): string {
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromInputValue(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}
