import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface SensitivePatternRule {
  pattern: string;
  replacement: string;
}

export interface SensitiveRulesValue {
  "sensitive-words"?: string[];
  "sensitive-words-replace"?: Record<string, string>;
  "sensitive-patterns-replace"?: SensitivePatternRule[];
}

interface ReplaceRow {
  from: string;
  to: string;
}

function recordToRows(map: Record<string, string> | undefined): ReplaceRow[] {
  if (!map || typeof map !== "object") return [];
  return Object.entries(map).map(([from, to]) => ({ from, to: String(to ?? "") }));
}

function rowsToRecord(rows: ReplaceRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.from.trim();
    if (key) out[key] = row.to;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizePatterns(list: unknown): SensitivePatternRule[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      pattern: String(item.pattern ?? ""),
      replacement: String(item.replacement ?? ""),
    }));
}

function cleanPatterns(rows: SensitivePatternRule[]): SensitivePatternRule[] | undefined {
  const out = rows
    .map((row) => ({ pattern: row.pattern.trim(), replacement: row.replacement }))
    .filter((row) => row.pattern !== "");
  return out.length > 0 ? out : undefined;
}

/**
 * Reusable editor for the three sensitive-text rule fields shared across
 * Claude cloak, Antigravity OAuth, and Devin OAuth configs:
 *   - sensitive-words: string[]
 *   - sensitive-words-replace: Record<string, string>
 *   - sensitive-patterns-replace: { pattern, replacement }[]
 */
export function SensitiveRulesEditor({
  value,
  onChange,
  collapsible = false,
  title,
  hint,
  defaultOpen = false,
}: {
  value: SensitiveRulesValue;
  onChange: (changes: SensitiveRulesValue) => void;
  collapsible?: boolean;
  title?: string;
  hint?: string;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const words = Array.isArray(value["sensitive-words"])
    ? value["sensitive-words"].map((w) => String(w)).filter((w) => w.trim() !== "")
    : [];

  const [wordDraft, setWordDraft] = useState("");
  const [replaceRows, setReplaceRows] = useState<ReplaceRow[]>(() => recordToRows(value["sensitive-words-replace"]));
  const [patternRows, setPatternRows] = useState<SensitivePatternRule[]>(() =>
    normalizePatterns(value["sensitive-patterns-replace"]),
  );

  // Re-sync local draft rows when parent value changes externally (e.g. discard or raw JSON apply).
  const replaceSig = JSON.stringify(value["sensitive-words-replace"] ?? {});
  useEffect(() => {
    setReplaceRows((prev) => {
      const currentClean = JSON.stringify(rowsToRecord(prev) ?? {});
      if (currentClean === replaceSig) return prev;
      return recordToRows(value["sensitive-words-replace"]);
    });
  }, [replaceSig]);

  const patternSig = JSON.stringify(value["sensitive-patterns-replace"] ?? []);
  useEffect(() => {
    setPatternRows((prev) => {
      const currentClean = JSON.stringify(cleanPatterns(prev) ?? []);
      if (currentClean === patternSig) return prev;
      return normalizePatterns(value["sensitive-patterns-replace"]);
    });
  }, [patternSig]);

  const totalCount =
    words.length +
    Object.keys(value["sensitive-words-replace"] ?? {}).length +
    normalizePatterns(value["sensitive-patterns-replace"]).filter((r) => r.pattern.trim() !== "").length;

  const [expanded, setExpanded] = useState(defaultOpen);

  const commitWords = (nextWords: string[]) => {
    const cleaned = [...new Set(nextWords.map((w) => w.trim()).filter(Boolean))];
    onChange({ "sensitive-words": cleaned.length > 0 ? cleaned : undefined });
  };

  const addWordFromDraft = () => {
    const parts = wordDraft
      .split(/[,，\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    setWordDraft("");
    if (parts.length === 0) return;
    commitWords([...words, ...parts]);
  };

  const updateReplaceRows = (next: ReplaceRow[]) => {
    setReplaceRows(next);
    onChange({ "sensitive-words-replace": rowsToRecord(next) });
  };

  const updatePatternRows = (next: SensitivePatternRule[]) => {
    setPatternRows(next);
    onChange({ "sensitive-patterns-replace": cleanPatterns(next) });
  };

  const body = (
    <div className="space-y-4">
      {/* sensitive-words */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t("providers.sensitiveWordsLabel")}</Label>
        <p className="text-muted-foreground text-[11px] leading-snug">{t("providers.sensitiveWordsHint")}</p>
        {words.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {words.map((word) => (
              <Badge key={word} variant="outline" className="gap-1 font-mono text-[11px]">
                {word}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive cursor-pointer"
                  onClick={() => commitWords(words.filter((item) => item !== word))}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        <Input
          className="h-8 font-mono text-xs"
          value={wordDraft}
          placeholder={t("providers.sensitiveWordsPlaceholder")}
          onChange={(e) => setWordDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addWordFromDraft();
            }
          }}
          onBlur={addWordFromDraft}
        />
      </div>

      {/* sensitive-words-replace */}
      <div className="space-y-2 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label className="text-xs">{t("providers.sensitiveWordsReplaceLabel")}</Label>
            <p className="text-muted-foreground text-[11px] leading-snug">{t("providers.sensitiveWordsReplaceHint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={() => setReplaceRows([...replaceRows, { from: "", to: "" }])}
          >
            <Plus className="size-3.5" />
            {t("common.add")}
          </Button>
        </div>
        {replaceRows.length === 0 ? (
          <p className="text-muted-foreground text-[11px]">{t("providers.sensitiveRulesEmpty")}</p>
        ) : (
          <div className="space-y-1.5">
            {replaceRows.map((row, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  value={row.from}
                  placeholder={t("providers.sensitiveReplaceFromPlaceholder")}
                  onChange={(e) => {
                    const next = replaceRows.map((item, i) => (i === index ? { ...item, from: e.target.value } : item));
                    updateReplaceRows(next);
                  }}
                />
                <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  value={row.to}
                  placeholder={t("providers.sensitiveReplaceToPlaceholder")}
                  onChange={(e) => {
                    const next = replaceRows.map((item, i) => (i === index ? { ...item, to: e.target.value } : item));
                    updateReplaceRows(next);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive size-7 shrink-0"
                  title={t("common.delete")}
                  onClick={() => updateReplaceRows(replaceRows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* sensitive-patterns-replace */}
      <div className="space-y-2 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label className="text-xs">{t("providers.sensitivePatternsReplaceLabel")}</Label>
            <p className="text-muted-foreground text-[11px] leading-snug">{t("providers.sensitivePatternsReplaceHint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={() => setPatternRows([...patternRows, { pattern: "", replacement: "" }])}
          >
            <Plus className="size-3.5" />
            {t("common.add")}
          </Button>
        </div>
        {patternRows.length === 0 ? (
          <p className="text-muted-foreground text-[11px]">{t("providers.sensitiveRulesEmpty")}</p>
        ) : (
          <div className="space-y-1.5">
            {patternRows.map((row, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  value={row.pattern}
                  placeholder={t("providers.sensitivePatternPlaceholder")}
                  onChange={(e) => {
                    const next = patternRows.map((item, i) => (i === index ? { ...item, pattern: e.target.value } : item));
                    updatePatternRows(next);
                  }}
                />
                <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  value={row.replacement}
                  placeholder={t("providers.sensitiveReplaceToPlaceholder")}
                  onChange={(e) => {
                    const next = patternRows.map((item, i) => (i === index ? { ...item, replacement: e.target.value } : item));
                    updatePatternRows(next);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive size-7 shrink-0"
                  title={t("common.delete")}
                  onClick={() => updatePatternRows(patternRows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (!collapsible) {
    return body;
  }

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/60 dark:border-slate-800 dark:bg-slate-950/40">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
              {title ?? t("providers.sensitiveRulesTitle")}
            </p>
            {totalCount > 0 ? (
              <Badge variant="outline" className="h-4.5 px-1.5 font-mono text-[10px] font-normal">
                {t("providers.sensitiveRulesCount", { count: totalCount })}
              </Badge>
            ) : null}
          </div>
          {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{hint}</p> : null}
        </div>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-slate-400 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded ? (
        <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">{body}</div>
      ) : null}
    </div>
  );
}
