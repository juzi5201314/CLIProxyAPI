import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatNumber } from "@/lib/format";

export interface ComboboxOption {
  label: string;
  value: string;
  count?: number;
}

interface MultiSelectComboboxProps {
  placeholder: string;
  selected: string[];
  onChange: (selected: string[]) => void;
  options: ComboboxOption[];
  className?: string;
  icon?: LucideIcon;
  searchPlaceholder?: string;
}

export function MultiSelectCombobox({
  placeholder,
  selected,
  onChange,
  options,
  className,
  icon: Icon,
  searchPlaceholder,
}: MultiSelectComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(term) ||
        opt.value.toLowerCase().includes(term)
    );
  }, [options, search]);

  const toggleOption = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((item) => item !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const handleSelectAll = () => {
    const allValues = filteredOptions.map((opt) => opt.value);
    const combined = Array.from(new Set([...selected, ...allValues]));
    onChange(combined);
  };

  const handleClear = () => {
    onChange([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={`h-8 justify-between border-border/70 text-xs font-normal ${
            selected.length > 0 ? "border-primary/50 bg-primary/5 text-foreground" : "text-muted-foreground"
          } ${className ?? ""}`}
        >
          <div className="flex items-center gap-1.5 truncate">
            {Icon ? <Icon className="size-3.5 shrink-0 opacity-70" /> : null}
            <span className="truncate">{placeholder}</span>
            {selected.length > 0 ? (
              <Badge
                variant="secondary"
                className="ml-1 h-4 px-1.5 text-[10px] font-semibold text-primary"
              >
                {selected.length}
              </Badge>
            ) : null}
          </div>
          <ChevronsUpDown className="ml-1.5 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 shadow-lg rounded-2xl" align="start">
        <div className="mb-2 flex items-center gap-1.5">
          <Input
            placeholder={searchPlaceholder ?? `${t("common.search")}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
            autoFocus
          />
          {search ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              onClick={() => setSearch("")}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <div className="mb-2 flex items-center justify-between border-b pb-1.5 text-[11px] text-muted-foreground">
          <button
            type="button"
            className="hover:text-primary transition-colors cursor-pointer"
            onClick={handleSelectAll}
          >
            {t("common.selectAll", "全选当前")}
          </button>
          {selected.length > 0 ? (
            <button
              type="button"
              className="hover:text-rose-500 transition-colors cursor-pointer"
              onClick={handleClear}
            >
              {t("common.clearSelection", { count: selected.length, defaultValue: `清空 (${selected.length})` })}
            </button>
          ) : null}
        </div>

        <ScrollArea className="max-h-56">
          {filteredOptions.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("common.noMatches", "未找到匹配项")}</p>
          ) : (
            <div className="space-y-0.5">
              {filteredOptions.map((opt) => {
                const isSelected = selected.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => toggleOption(opt.value)}
                    className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs cursor-pointer select-none transition-colors ${
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div
                        className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40 bg-background"
                        }`}
                      >
                        {isSelected ? <Check className="size-2.5 stroke-[3]" /> : null}
                      </div>
                      <span className="truncate font-mono text-[11px]" title={opt.value}>
                        {opt.label}
                      </span>
                    </div>
                    {opt.count !== undefined ? (
                      <span className="ml-2 shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {formatNumber(opt.count)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
