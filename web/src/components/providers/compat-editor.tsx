import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Boxes, Check, Eye, EyeOff, FlaskConical, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FetchModelsButton,
  ModelCombobox,
  ModelRowsEditor,
  NumberValue,
  ProbeStatusBadge,
  ScopedErrorsEditor,
  mergeModelNames,
  normalizeModelsForSave,
  type ModelEntry,
} from "./model-editor";
import {
  ALL_KINDS,
  COMPAT_KIND,
  KIND_COLORS,
  KIND_ICONS,
  probeChatCompletion,
  probeUpstream,
  targetFor,
  type KindMeta,
  type ProbeResult,
} from "./provider-tools";
import { maskKey } from "@/lib/format";

export interface CompatKeyEntry {
  "api-key"?: string;
  weight?: number;
  "max-concurrency"?: number;
  "proxy-url"?: string;
}

export interface CompatProvider {
  name?: string;
  "base-url"?: string;
  priority?: number;
  prefix?: string;
  disabled?: boolean;
  headers?: Record<string, string>;
  "support-prompt-cache-key"?: boolean;
  "disable-cooling"?: boolean;
  "request-retry"?: number;
  "max-concurrency"?: number;
  "request-scoped-errors"?: unknown[];
  "api-key-entries"?: CompatKeyEntry[];
  models?: ModelEntry[];
  "auth-index"?: string | number;
}

/** Right-side editor for one OpenAI-compatible provider. */
export function CompatEditorSheet({
  provider,
  isNew,
  onClose,
  onSave,
  onSelectKind,
}: {
  provider: CompatProvider;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: CompatProvider) => void;
  onSelectKind?: (kind: KindMeta, seed?: { name?: string; baseURL?: string }) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CompatProvider>(() => structuredClone(provider));
  const patch = (changes: Partial<CompatProvider>) => setDraft((current) => ({ ...current, ...changes }));

  const keys = draft["api-key-entries"] ?? [];
  const models = draft.models ?? [];

  // Probe results keyed by credential text so they survive row reordering.
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({});
  const [probeBusy, setProbeBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  // Chat-completion results for the connectivity section.
  const [chatResults, setChatResults] = useState<Record<string, ProbeResult>>({});
  const [chatBusy, setChatBusy] = useState(false);
  const [chatModel, setChatModel] = useState<string>(() => String(models.find((model) => model.name)?.name ?? ""));

  const upstreamTarget = (key: string, proxyURL?: string) =>
    targetFor({ auth: "bearer", modelsPath: "models", defaultBase: "" }, draft["base-url"] ?? "", key, proxyURL);

  const probeKey = async (key: string, proxyURL?: string) => {
    if (!key || !draft["base-url"]) {
      toast.warning(t("providers.probeNeedsBaseAndKey"));
      return;
    }
    setProbeBusy(key);
    try {
      const result = await probeUpstream(upstreamTarget(key, proxyURL));
      setProbeResults((current) => ({ ...current, [key]: result }));
    } finally {
      setProbeBusy(null);
    }
  };

  const probeAllKeys = async () => {
    const usable = keys.filter((entry) => entry["api-key"]);
    if (!draft["base-url"] || usable.length === 0) {
      toast.warning(t("providers.probeNeedsBaseAndKey"));
      return;
    }
    setBatchBusy(true);
    try {
      for (const entry of usable) {
        const key = entry["api-key"]!;
        const result = await probeUpstream(upstreamTarget(key, entry["proxy-url"]));
        setProbeResults((current) => ({ ...current, [key]: result }));
      }
    } finally {
      setBatchBusy(false);
    }
  };

  const chatTestAll = async () => {
    const usable = keys.filter((entry) => entry["api-key"]);
    if (!chatModel || usable.length === 0) {
      toast.warning(t("providers.connectivityNeedsModel"));
      return;
    }
    setChatBusy(true);
    try {
      for (const entry of usable) {
        const key = entry["api-key"]!;
        const result = await probeChatCompletion(upstreamTarget(key, entry["proxy-url"]), chatModel);
        setChatResults((current) => ({ ...current, [key]: result }));
      }
    } finally {
      setChatBusy(false);
    }
  };

  const setKey = (index: number, changes: Partial<CompatKeyEntry>) => {
    const next = keys.map((entry, i) => (i === index ? { ...entry, ...changes } : entry));
    patch({ "api-key-entries": next });
  };

  const save = () => {
    if (!draft.name?.trim()) {
      toast.warning(t("providers.nameRequired"));
      return;
    }
    if (!draft["base-url"]?.trim()) {
      toast.warning(t("providers.baseURLRequired"));
      return;
    }
    const { "auth-index": _drop, ...rest } = draft;
    const cleaned: CompatProvider = {
      ...rest,
      name: draft.name.trim(),
      "base-url": draft["base-url"].trim(),
      models: normalizeModelsForSave(models),
    };
    onSave(cleaned);
  };

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(provider), [draft, provider]);
  const confirmingRef = useRef(false);

  const confirmExit = (onConfirm: () => void) => {
    if (!isDirty) {
      onConfirm();
      return;
    }
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setTimeout(() => {
      try {
        const message = t("providers.unsavedConfirm") || "您有未保存的修改，确定要退出吗？未保存的内容将会丢失。";
        if (window.confirm(message)) {
          onConfirm();
        }
      } finally {
        confirmingRef.current = false;
      }
    }, 0);
  };

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          if (!isDirty) onClose();
        }
      }}
    >
      <SheetContent
        showCloseButton={false}
        className="flex w-full flex-col gap-0 sm:max-w-2xl!"
        onPointerDownOutside={(e) => {
          e.preventDefault();
          confirmExit(onClose);
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          confirmExit(onClose);
        }}
      >
        <SheetHeader className="relative border-b pb-4 pr-10">
          <Button
            variant="ghost"
            className="absolute top-0 right-0 size-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            size="icon"
            onClick={() => confirmExit(onClose)}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </Button>
          <SheetTitle>{isNew ? t("providers.newCompatProvider") : t("providers.editCompatProvider")}</SheetTitle>
          <SheetDescription>{draft["base-url"] || t("providers.editHint")}</SheetDescription>
        </SheetHeader>

        <div className="-mx-4 flex-1 space-y-7 overflow-y-auto px-4 py-5">
          {isNew && onSelectKind ? (
            <ProviderKindSelectorGrid
              activeKindId={COMPAT_KIND.id}
              onSelect={(nextKind) => onSelectKind(nextKind, { name: draft.name, baseURL: draft["base-url"] })}
            />
          ) : null}

          <EditorSection title={t("providers.basicInfo")}>
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <Field label={t("providers.fieldName")} required>
                <Input value={draft.name ?? ""} onChange={(event) => patch({ name: event.target.value })} placeholder="my-provider" />
              </Field>
              <Field label="Base URL" required>
                <Input className="font-mono text-xs" value={draft["base-url"] ?? ""} onChange={(event) => patch({ "base-url": event.target.value })} placeholder="https://api.example.com/v1" />
              </Field>
              <Field label={t("providers.fieldPriority")} hint={t("providers.priorityHint")}>
                <NumberValue value={draft.priority} onChange={(value) => patch({ priority: value })} />
              </Field>
              <Field label={t("providers.fieldPrefix")} hint={t("providers.prefixHint")}>
                <Input value={draft.prefix ?? ""} onChange={(event) => patch({ prefix: event.target.value })} placeholder="team-a" />
              </Field>
            </div>
          </EditorSection>

          <EditorSection title={t("providers.behavior")}>
            <div className="space-y-1">
              <SwitchRow
                label={t("providers.enabled")}
                hint={t("providers.enabledHint")}
                checked={!draft.disabled}
                onCheckedChange={(checked) => patch({ disabled: !checked })}
              />
              <SwitchRow
                label={t("providers.cacheKey")}
                hint={t("providers.cacheKeyHint")}
                checked={Boolean(draft["support-prompt-cache-key"])}
                onCheckedChange={(checked) => patch({ "support-prompt-cache-key": checked })}
              />
              <SwitchRow
                label={t("providers.cooling")}
                hint={t("providers.coolingHint")}
                control={
                  <Select
                    value={draft["disable-cooling"] === undefined ? "unset" : draft["disable-cooling"] ? "disabled" : "enabled"}
                    onValueChange={(value) => patch({ "disable-cooling": value === "unset" ? undefined : value === "disabled" })}
                  >
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">{t("providers.coolingFollow")}</SelectItem>
                      <SelectItem value="disabled">{t("providers.coolingDisable")}</SelectItem>
                      <SelectItem value="enabled">{t("providers.coolingEnable")}</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
              <SwitchRow
                label={t("providers.requestRetry")}
                hint={t("providers.requestRetryHint")}
                control={
                  <NumberValue
                    className="w-40"
                    value={draft["request-retry"]}
                    onChange={(value) => patch({ "request-retry": value })}
                    placeholder="∞"
                  />
                }
              />
              <SwitchRow
                label={t("providers.compatMaxConcurrency")}
                hint={t("providers.compatMaxConcurrencyHint")}
                control={
                  <NumberValue
                    className="w-40"
                    value={draft["max-concurrency"]}
                    onChange={(value) => patch({ "max-concurrency": value })}
                    placeholder="∞"
                  />
                }
              />
            </div>
          </EditorSection>

          <HeadersEditor headers={draft.headers} onChange={(headers) => patch({ headers })} />

          <EditorSection
            title={t("providers.apiKeys")}
            hint={t("providers.apiKeysHint")}
            actions={
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={probeAllKeys} disabled={batchBusy}>
                  {batchBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
                  {t("providers.testAllKeys")}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => patch({ "api-key-entries": [...keys, {}] })}>
                  <Plus className="size-3.5" />
                  {t("providers.addKey")}
                </Button>
              </div>
            }
          >
            {keys.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border border-dashed border-border/60 px-4 py-5 text-center text-xs">{t("providers.emptyKeys")}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/60 bg-secondary/15">
                <Table>
                  <TableHeader className="bg-secondary/40">
                    <TableRow className="border-b border-border/50 hover:bg-transparent">
                      <TableHead className="w-10 text-center text-[10px] uppercase font-semibold">#</TableHead>
                      <TableHead className="w-16 text-center text-[10px] uppercase font-semibold">{t("providers.statusColumn")}</TableHead>
                      <TableHead className="min-w-44 text-[10px] uppercase font-semibold">{t("providers.keyColumn")}</TableHead>
                      <TableHead className="w-20 text-center text-[10px] uppercase font-semibold">{t("providers.weight")}</TableHead>
                      <TableHead className="w-24 text-center text-[10px] uppercase font-semibold">{t("providers.maxConcurrencyColumn")}</TableHead>
                      <TableHead className="w-44 text-[10px] uppercase font-semibold">{t("providers.proxy")}</TableHead>
                      <TableHead className="w-20 text-right text-[10px] uppercase font-semibold">{t("providers.actionsColumn")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((entry, index) => {
                      const key = entry["api-key"] ?? "";
                      const result = key ? probeResults[key] : undefined;
                      return (
                        <TableRow key={index} className="border-b border-border/40 hover:bg-secondary/30">
                          <TableCell className="text-muted-foreground text-center font-mono text-xs py-2 px-1">
                            {index + 1}
                          </TableCell>
                          <TableCell className="text-center py-2 px-1">
                            <div className="flex items-center justify-center">
                              <ProbeStatusBadge result={result} busy={probeBusy === key} compact />
                            </div>
                          </TableCell>
                          <TableCell className="py-2 px-2">
                            <KeyInput value={key} onChange={(value) => setKey(index, { "api-key": value })} />
                          </TableCell>
                          <TableCell className="text-center py-2 px-1">
                            <NumberValue className="h-8 text-center" value={entry.weight} onChange={(value) => setKey(index, { weight: value })} placeholder="1" />
                          </TableCell>
                          <TableCell className="text-center py-2 px-1">
                            <NumberValue className="h-8 text-center" value={entry["max-concurrency"]} onChange={(value) => setKey(index, { "max-concurrency": value })} placeholder="∞" />
                          </TableCell>
                          <TableCell className="py-2 px-2">
                            <Input
                              className="h-8 font-mono text-xs"
                              value={entry["proxy-url"] ?? ""}
                              onChange={(event) => setKey(index, { "proxy-url": event.target.value })}
                              placeholder={t("providers.proxyPlaceholder")}
                            />
                          </TableCell>
                          <TableCell className="text-right py-2 px-2">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                title={t("providers.test")}
                                disabled={probeBusy === key || batchBusy}
                                onClick={() => void probeKey(key, entry["proxy-url"])}
                              >
                                {probeBusy === key ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive size-7"
                                title={t("common.delete")}
                                onClick={() => patch({ "api-key-entries": keys.filter((_, i) => i !== index) })}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </EditorSection>

          <EditorSection
            title={t("providers.modelsList")}
            hint={t("providers.modelsListHint")}
            actions={
              <div className="flex items-center gap-2">
                <FetchModelsButton
                  target={{ baseURL: draft["base-url"] ?? "", auth: "bearer", modelsPath: "models" }}
                  keys={keys.map((entry) => entry["api-key"] ?? "")}
                  onAdd={(names) => patch({ models: mergeModelNames(models, names) })}
                />
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => patch({ models: [...models, { alias: "" }] })}>
                  <Plus className="size-3.5" />
                  {t("providers.addModel")}
                </Button>
              </div>
            }
          >
            <ModelRowsEditor models={models} kindId="openai-compatibility" onChange={(next) => patch({ models: next })} />
          </EditorSection>

          <EditorSection title={t("providers.connectivity")} hint={t("providers.connectivityHint")}>
            {keys.some((entry) => entry["api-key"]) && models.some((model) => model.name) ? (
              <div className="flex flex-wrap items-center gap-2">
                <ModelCombobox
                  value={chatModel}
                  onValueChange={setChatModel}
                  options={models.map((model) => String(model.name ?? "")).filter(Boolean)}
                />
                <Button size="sm" className="h-8 text-xs" onClick={chatTestAll} disabled={chatBusy || !chatModel}>
                  {chatBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
                  {t("providers.testAllKeysChat")}
                </Button>
                <div className="flex flex-wrap items-center gap-1.5">
                  {keys.filter((entry) => entry["api-key"]).map((entry) => {
                    const key = entry["api-key"]!;
                    const result = chatResults[key];
                    return <ProbeStatusBadge key={key} result={result} busy={false} label={maskKey(key)} code={result?.code} />;
                  })}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">{t("providers.connectivityPrereq")}</p>
            )}
          </EditorSection>

          <EditorSection title={t("providers.advanced")} hint={t("providers.advancedHint")}>
            <ScopedErrorsEditor
              value={draft["request-scoped-errors"]}
              onChange={(value) => patch({ "request-scoped-errors": value })}
            />
          </EditorSection>
        </div>

        <SheetFooter className="flex-row items-center justify-end gap-2 border-t pt-4">
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" className="h-8" onClick={save}>
            {t("common.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ----------------------------------------------------------------- sections

export function ProviderKindSelectorGrid({
  activeKindId,
  onSelect,
}: {
  activeKindId: string;
  onSelect: (kind: KindMeta) => void;
}) {
  const { t } = useTranslation();
  return (
    <EditorSection title={t("providers.switchKindTitle")} hint={t("providers.switchKindHint")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ALL_KINDS.map((kind) => {
          const Icon = KIND_ICONS[kind.id] ?? Boxes;
          const colors = KIND_COLORS[kind.id] ?? KIND_COLORS["openai-compatibility"]!;
          const active = kind.id === activeKindId;
          return (
            <button
              key={kind.id}
              type="button"
              onClick={() => {
                if (!active) onSelect(kind);
              }}
              className={`group relative flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all ${
                active
                  ? "border-primary bg-primary/8 text-foreground ring-1 ring-primary/30 shadow-2xs"
                  : "border-border/70 bg-card hover:border-primary/40 hover:bg-accent/50"
              }`}
            >
              <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${colors.bg} ${colors.text} ${colors.border}`}>
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-xs leading-tight ${active ? "font-bold text-primary" : "font-semibold text-foreground"}`}>
                  {t(`providers.kind.${kind.labelKey}`)}
                </p>
              </div>
              {active ? (
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-2.5 stroke-[3]" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </EditorSection>
  );
}

export function EditorSection({ title, hint, actions, children }: { title: string; hint?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-[11px] leading-snug">{hint}</p> : null}
    </div>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  control,
}: {
  label: string;
  hint?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  control?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
      </div>
      {control ?? <Switch checked={checked} onCheckedChange={onCheckedChange} />}
    </div>
  );
}

/** Masked credential input with a reveal toggle. */
function KeyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <Input
        className="h-8 pr-8 font-mono text-xs"
        type={revealed ? "text" : "password"}
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        placeholder="sk-..."
      />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
        title={revealed ? t("providers.hide") : t("providers.reveal")}
        onClick={() => setRevealed(!revealed)}
      >
        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ headers

export function HeadersEditor({ headers, onChange }: { headers?: Record<string, string>; onChange: (headers: Record<string, string>) => void }) {
  const { t } = useTranslation();
  const nextIdRef = useRef(1);
  const [rows, setRows] = useState<{ id: number; key: string; value: string }[]>(() =>
    Object.entries(headers ?? {}).map(([key, value]) => ({
      id: nextIdRef.current++,
      key,
      value,
    })),
  );

  const emitChange = (nextRows: { id: number; key: string; value: string }[]) => {
    setRows(nextRows);
    const record: Record<string, string> = {};
    for (const row of nextRows) {
      const k = row.key.trim();
      if (k) record[k] = row.value;
    }
    onChange(record);
  };

  const addRow = () => {
    setRows((current) => [...current, { id: nextIdRef.current++, key: "", value: "" }]);
  };

  const updateRow = (id: number, key: string, value: string) => {
    emitChange(rows.map((row) => (row.id === id ? { ...row, key, value } : row)));
  };

  const removeRow = (id: number) => {
    emitChange(rows.filter((row) => row.id !== id));
  };

  return (
    <EditorSection
      title={t("providers.headers")}
      hint={t("providers.headersHint")}
      actions={
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addRow}>
          <Plus className="size-3.5" />
          {t("providers.addHeader")}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed border-border/60 px-4 py-5 text-center text-xs">{t("providers.emptyHeaders")}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/30 px-2 py-2">
              <Input
                className="h-8 w-56 font-mono text-xs"
                value={row.key}
                onChange={(event) => updateRow(row.id, event.target.value, row.value)}
                placeholder={t("providers.headerName")}
              />
              <span className="text-muted-foreground font-mono text-xs">:</span>
              <Input
                className="h-8 flex-1 font-mono text-xs"
                value={row.value}
                onChange={(event) => updateRow(row.id, row.key, event.target.value)}
                placeholder={t("providers.headerValue")}
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive size-7"
                title={t("common.delete")}
                onClick={() => removeRow(row.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </EditorSection>
  );
}
