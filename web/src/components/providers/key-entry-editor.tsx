import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical, Loader2, Plus, X } from "lucide-react";
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
import { EditorSection, HeadersEditor, SwitchRow } from "./compat-editor";
import {
  ExcludedModelsEditor,
  FetchModelsButton,
  ModelRowsEditor,
  NumberValue,
  ScopedErrorsEditor,
  mergeModelNames,
  normalizeModelsForSave,
  type ModelEntry,
} from "./model-editor";
import { probeUpstream, targetFor, type Entry, type KindMeta, type ProbeResult } from "./provider-tools";

interface ScalarField {
  key: string;
  labelKey: string;
  type: "password" | "string" | "number";
  placeholder?: string;
  hintKey?: string;
}

interface BehaviorRow {
  key: string;
  labelKey: string;
  hintKey?: string;
  type: "switch" | "tri" | "number" | "string";
  placeholder?: string;
  /** Option labels for tri rows: [follow, on, off]; defaults to generic tri.* keys. */
  optionKeys?: [string, string, string];
}

const KEY_BASE: ScalarField = { key: "api-key", labelKey: "apiKey", type: "password" };
const BASE_URL: ScalarField = { key: "base-url", labelKey: "fieldBaseURL", type: "string", placeholder: "https://..." };
const PRIORITY: ScalarField = { key: "priority", labelKey: "fieldPriority", type: "number" };
const WEIGHT: ScalarField = { key: "weight", labelKey: "fieldWeight", type: "number" };
const PREFIX: ScalarField = { key: "prefix", labelKey: "fieldPrefix", type: "string", hintKey: "prefixHint" };
const PROXY: ScalarField = { key: "proxy-url", labelKey: "fieldProxyURL", type: "string", placeholder: "socks5://..." };

/** Scalar grid per kind; every kind carries key/base/priority/weight/prefix/proxy. */
const KEY_EDITOR_FIELDS: Record<string, ScalarField[]> = {
  gemini: [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  interactions: [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  claude: [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  vertex: [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  codex: [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  xai: [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  meta: [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
};

const COOLING_ROW: BehaviorRow = { key: "disable-cooling", labelKey: "cooling", hintKey: "coolingHint", type: "tri", optionKeys: ["coolingFollow", "coolingDisable", "coolingEnable"] };
const RETRY_ROW: BehaviorRow = { key: "request-retry", labelKey: "requestRetry", hintKey: "requestRetryHint", type: "number", placeholder: "∞" };
const COOLING_RETRY: BehaviorRow[] = [COOLING_ROW, RETRY_ROW];
/** Field-availability follows the Go structs: alpha-search is codex-only
 *  (sanitize force-clears it on xai/meta), websockets has no meta executor,
 *  and codex cloaking is consumed by the codex/xai request paths. */
const WEBSOCKETS_ROW: BehaviorRow = { key: "websockets", labelKey: "fieldWebsockets", hintKey: "websocketsHint", type: "switch" };
const CODEX_BEHAVIOR: BehaviorRow[] = [
  ...COOLING_RETRY,
  WEBSOCKETS_ROW,
  { key: "alpha-search", labelKey: "alphaSearch", hintKey: "alphaSearchHint", type: "switch" },
  { key: "disable-codex-cloaking", labelKey: "disableCodexCloaking", hintKey: "disableCodexCloakingHint", type: "tri" },
];
const XAI_BEHAVIOR: BehaviorRow[] = [
  ...COOLING_RETRY,
  WEBSOCKETS_ROW,
  { key: "disable-codex-cloaking", labelKey: "disableCodexCloaking", hintKey: "disableCodexCloakingHint", type: "tri" },
];
const VERTEX_BEHAVIOR: BehaviorRow[] = [
  ...COOLING_RETRY,
  { key: "interactions", labelKey: "interactionsRouting", hintKey: "interactionsRoutingHint", type: "tri" },
  { key: "openapi", labelKey: "openapiRouting", hintKey: "openapiRoutingHint", type: "tri" },
  { key: "openapi-location", labelKey: "openapiLocation", type: "string" },
];
const CLAUDE_BEHAVIOR: BehaviorRow[] = [
  ...COOLING_RETRY,
  { key: "rebuild-mid-system-message", labelKey: "rebuildMidSystemMessage", hintKey: "rebuildMidSystemMessageHint", type: "switch" },
  { key: "native-tool-search", labelKey: "nativeToolSearch", hintKey: "nativeToolSearchHint", type: "switch" },
];

/** Kinds whose base-url is mandatory: sanitize drops codex/xai entries with an
 *  empty base-url, while other kinds fall back to the official endpoint. */
const KINDS_REQUIRING_BASE = new Set(["codex", "xai"]);

/** Kind-specific behavior rows after the shared cooling/retry pair. */
const KIND_BEHAVIOR: Record<string, BehaviorRow[]> = {
  gemini: COOLING_RETRY,
  interactions: COOLING_RETRY,
  claude: CLAUDE_BEHAVIOR,
  codex: CODEX_BEHAVIOR,
  xai: XAI_BEHAVIOR,
  meta: COOLING_RETRY,
  vertex: VERTEX_BEHAVIOR,
};

/** Kinds whose Go struct has request-scoped-errors (VertexCompatKey does not). */
const KIND_WITH_SCOPED_ERRORS = new Set(["gemini", "interactions", "claude", "codex", "xai", "meta"]);

/** Right-side editor for one typed key entry (gemini/claude/codex/xai/meta/vertex/interactions). */
export function KeyEntryEditorSheet({
  kind,
  entry,
  isNew,
  onClose,
  onSave,
}: {
  kind: KindMeta;
  entry: Entry;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: Entry) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Entry>(() => structuredClone(entry));
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const patch = (key: string, value: unknown) =>
    setDraft((current) => {
      if (value === undefined) {
        const { [key]: _drop, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: value };
    });

  const patchCloak = (changes: Record<string, unknown>) => {
    const currentCloak = (draft.cloak as Record<string, unknown> | undefined) ?? {};
    const merged = { ...currentCloak, ...changes };
    const mode = typeof merged.mode === "string" ? merged.mode.trim() : "";
    const strictMode = Boolean(merged["strict-mode"]);
    const cacheUserId = Boolean(merged["cache-user-id"]);
    const sensitiveWords = Array.isArray(merged["sensitive-words"])
      ? (merged["sensitive-words"] as string[]).map((w) => String(w).trim()).filter(Boolean)
      : [];

    if (!mode && !strictMode && !cacheUserId && sensitiveWords.length === 0) {
      patch("cloak", undefined);
      return;
    }

    const cleanCloak: Record<string, unknown> = {};
    if (mode) cleanCloak.mode = mode;
    if (strictMode) cleanCloak["strict-mode"] = true;
    if (cacheUserId) cleanCloak["cache-user-id"] = true;
    if (sensitiveWords.length > 0) cleanCloak["sensitive-words"] = sensitiveWords;

    patch("cloak", cleanCloak);
  };

  const fields = KEY_EDITOR_FIELDS[kind.id] ?? [KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY];
  const behavior = KIND_BEHAVIOR[kind.id] ?? [COOLING_ROW, RETRY_ROW];
  const apiKey = String(draft["api-key"] ?? "");
  const baseURL = String(draft["base-url"] ?? "") || kind.defaultBase;
  const models = (draft.models as ModelEntry[] | undefined) ?? [];

  const runProbe = async () => {
    if (!apiKey) {
      toast.warning(t("providers.probeNeedsBaseAndKey"));
      return;
    }
    setProbing(true);
    try {
      setProbe(await probeUpstream(targetFor(kind, String(draft["base-url"] ?? ""), apiKey, String(draft["proxy-url"] ?? "") || undefined)));
    } finally {
      setProbing(false);
    }
  };

  const save = () => {
    if (!apiKey.trim()) {
      toast.warning(t("providers.nameRequiredKey"));
      return;
    }
    const baseURL = String(draft["base-url"] ?? "").trim();
    if (KINDS_REQUIRING_BASE.has(kind.id) && !baseURL) {
      toast.warning(t("providers.baseURLRequired"));
      return;
    }
    const { "auth-index": _drop, ...clean } = draft;
    onSave({ ...clean, models: normalizeModelsForSave(models) });
  };

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(entry), [draft, entry]);
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
          <SheetTitle>{isNew ? t("providers.newKeyEntry", { kind: t(`providers.kind.${kind.labelKey}`) }) : t("providers.editKeyEntry", { kind: t(`providers.kind.${kind.labelKey}`) })}</SheetTitle>
          <SheetDescription>{baseURL || t("providers.editHint")}</SheetDescription>
        </SheetHeader>

        <div className="-mx-4 flex-1 space-y-7 overflow-y-auto px-4 py-5">
          <EditorSection title={t("providers.basicInfo")}>
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              {fields.map((field) => (
                <KeyFieldControl key={field.key} field={field} draft={draft} onPatch={patch} requiredBase={KINDS_REQUIRING_BASE.has(kind.id)} />
              ))}
            </div>
          </EditorSection>

          <EditorSection title={t("providers.behavior")}>
            <div className="space-y-1">
              {behavior.map((row) => (
                <BehaviorControl key={row.key} row={row} draft={draft} onPatch={patch} />
              ))}
            </div>
          </EditorSection>

          {kind.id === "claude" ? (
            <ClaudeCloakSection draft={draft} onPatch={patch} onPatchCloak={patchCloak} />
          ) : null}

          <HeadersEditor headers={draft.headers as Record<string, string> | undefined} onChange={(headers) => patch("headers", headers)} />

          <EditorSection
            title={t("providers.modelsList")}
            hint={t("providers.modelsListKeyHint")}
            actions={
              <div className="flex items-center gap-2">
                <FetchModelsButton
                  target={{ baseURL: String(draft["base-url"] ?? "") || kind.defaultBase, auth: kind.auth, modelsPath: kind.modelsPath }}
                  keys={[apiKey]}
                  proxyURL={String(draft["proxy-url"] ?? "") || undefined}
                  onAdd={(names) => patch("models", mergeModelNames(models, names))}
                />
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => patch("models", [...models, { alias: "" }])}>
                  <Plus className="size-3.5" />
                  {t("providers.addModel")}
                </Button>
              </div>
            }
          >
            <ModelRowsEditor models={models} kindId={kind.id} onChange={(next) => patch("models", next)} />
          </EditorSection>

          <EditorSection title={t("providers.excludedModels")} hint={t("providers.excludedEntryHint")}>
            <ExcludedModelsEditor values={draft["excluded-models"] as string[] | undefined} onChange={(next) => patch("excluded-models", next)} />
          </EditorSection>

          <EditorSection title={t("providers.connectivity")} hint={t("providers.probeHint")}>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={runProbe} disabled={probing || !apiKey}>
                {probing ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
                {t("providers.test")}
              </Button>
              {probe ? (
                <p className={`text-xs ${probe.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {probe.ok
                    ? t("providers.probeOk", { code: probe.code ?? "" })
                    : t("providers.probeFail", { code: probe.code ?? "?" })}
                  {!probe.ok && probe.message ? <span className="text-muted-foreground ml-2 break-all font-mono">{probe.message}</span> : null}
                </p>
              ) : null}
            </div>
          </EditorSection>

          {KIND_WITH_SCOPED_ERRORS.has(kind.id) ? (
            <EditorSection title={t("providers.scopedErrors")} hint={t("providers.scopedErrorsHint")}>
              <ScopedErrorsEditor
                value={draft["request-scoped-errors"] as unknown[] | undefined}
                onChange={(value) => patch("request-scoped-errors", value)}
              />
            </EditorSection>
          ) : null}

          <ExtraFieldsEditor kind={kind} draft={draft} onApply={(next) => setDraft(next)} />
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

function KeyFieldControl({ field, draft, onPatch, requiredBase }: { field: ScalarField; draft: Entry; onPatch: (key: string, value: unknown) => void; requiredBase: boolean }) {
  const { t } = useTranslation();
  const raw = draft[field.key];
  const hint =
    field.hintKey ? t(`providers.${field.hintKey}`)
      : field.key === "weight" ? t("providers.weightHint")
        : field.key === "base-url" && !requiredBase ? t("providers.baseURLOptionalHint")
          : undefined;
  const required = field.key === "api-key" || (field.key === "base-url" && requiredBase);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {t(`providers.${field.labelKey}`)}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {field.type === "number" ? (
        <NumberValue
          className="h-9"
          value={typeof raw === "number" ? raw : undefined}
          onChange={(value) => onPatch(field.key, value)}
        />
      ) : (
        <Input
          className="h-9 font-mono text-xs"
          type={field.type === "password" ? "password" : "text"}
          autoComplete="off"
          value={raw === undefined || raw === null ? "" : String(raw)}
          placeholder={field.placeholder}
          onChange={(event) => onPatch(field.key, event.target.value)}
        />
      )}
      {hint ? <p className="text-muted-foreground text-[11px] leading-snug">{hint}</p> : null}
    </div>
  );
}

function BehaviorControl({ row, draft, onPatch }: { row: BehaviorRow; draft: Entry; onPatch: (key: string, value: unknown) => void }) {
  const { t } = useTranslation();
  const raw = draft[row.key];
  const hint = row.hintKey ? t(`providers.${row.hintKey}`) : undefined;
  if (row.type === "switch") {
    return (
      <SwitchRow label={t(`providers.${row.labelKey}`)} hint={hint} checked={Boolean(raw)} onCheckedChange={(checked) => onPatch(row.key, checked)} />
    );
  }
  if (row.type === "tri") {
    const [followKey, onKey, offKey] = row.optionKeys ?? ["triFollow", "triOn", "triOff"];
    return (
      <SwitchRow
        label={t(`providers.${row.labelKey}`)}
        hint={hint}
        control={
          <Select
            value={raw === undefined ? "unset" : raw ? "on" : "off"}
            onValueChange={(value) => onPatch(row.key, value === "unset" ? undefined : value === "on")}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">{t(`providers.${followKey}`)}</SelectItem>
              <SelectItem value="on">{t(`providers.${onKey}`)}</SelectItem>
              <SelectItem value="off">{t(`providers.${offKey}`)}</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    );
  }
  if (row.type === "number") {
    return (
      <SwitchRow
        label={t(`providers.${row.labelKey}`)}
        hint={hint}
        control={
          <NumberValue
            className="w-40"
            value={typeof raw === "number" ? raw : undefined}
            onChange={(value) => onPatch(row.key, value)}
            placeholder={row.placeholder}
          />
        }
      />
    );
  }
  return (
    <SwitchRow
      label={t(`providers.${row.labelKey}`)}
      hint={hint}
      control={
        <Input
          className="h-8 w-56 font-mono text-xs"
          value={raw === undefined || raw === null ? "" : String(raw)}
          placeholder={row.placeholder}
          onChange={(event) => onPatch(row.key, event.target.value)}
        />
      }
    />
  );
}

function ClaudeCloakSection({
  draft,
  onPatch,
  onPatchCloak,
}: {
  draft: Entry;
  onPatch: (key: string, value: unknown) => void;
  onPatchCloak: (changes: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const currentCloak = (draft.cloak as Record<string, unknown> | undefined) ?? {};
  const currentMode = typeof currentCloak.mode === "string" && currentCloak.mode ? currentCloak.mode : "follow";

  return (
    <EditorSection title={t("providers.claudeCloakingTitle")} hint={t("providers.claudeCloakingHint")}>
      <div className="space-y-1">
        <SwitchRow
          label={t("providers.claudeFingerprintProfile")}
          hint={t("providers.claudeFingerprintProfileHint")}
          control={
            <Select
              value={draft["fingerprint-profile"] === "claude-code-cli" ? "claude-code-cli" : "default"}
              onValueChange={(val) => onPatch("fingerprint-profile", val === "claude-code-cli" ? "claude-code-cli" : undefined)}
            >
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("providers.claudeFingerprintDefault")}</SelectItem>
                <SelectItem value="claude-code-cli">{t("providers.claudeFingerprintCli")}</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        <SwitchRow
          label={t("providers.claudeCloakMode")}
          hint={t("providers.claudeCloakModeHint")}
          control={
            <Select
              value={currentMode}
              onValueChange={(val) => onPatchCloak({ mode: val === "follow" ? "" : val })}
            >
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="follow">{t("providers.claudeCloakModeFollow")}</SelectItem>
                <SelectItem value="auto">{t("providers.claudeCloakModeAuto")}</SelectItem>
                <SelectItem value="always">{t("providers.claudeCloakModeAlways")}</SelectItem>
                <SelectItem value="never">{t("providers.claudeCloakModeNever")}</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        <SwitchRow
          label={t("providers.claudeCloakStrict")}
          hint={t("providers.claudeCloakStrictHint")}
          checked={Boolean(currentCloak["strict-mode"])}
          onCheckedChange={(checked) => onPatchCloak({ "strict-mode": checked })}
        />

        <SwitchRow
          label={t("providers.claudeCloakCacheUser")}
          hint={t("providers.claudeCloakCacheUserHint")}
          checked={Boolean(currentCloak["cache-user-id"])}
          onCheckedChange={(checked) => onPatchCloak({ "cache-user-id": checked })}
        />

        <SwitchRow
          label={t("providers.claudeCloakSensitiveWords")}
          hint={t("providers.claudeCloakSensitiveWordsHint")}
          control={
            <Input
              className="h-8 w-56 font-mono text-xs"
              value={
                Array.isArray(currentCloak["sensitive-words"])
                  ? (currentCloak["sensitive-words"] as string[]).join(", ")
                  : ""
              }
              placeholder="API, proxy"
              onChange={(e) => {
                const words = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
                onPatchCloak({ "sensitive-words": words });
              }}
            />
          }
        />
      </div>
    </EditorSection>
  );
}

/** Edit fields outside the typed schema by re-serializing the entry without the known keys. */
function ExtraFieldsEditor({ kind, draft, onApply }: { kind: KindMeta; draft: Entry; onApply: (next: Entry) => void }) {
  const { t } = useTranslation();
  const known = new Set((KEY_EDITOR_FIELDS[kind.id] ?? []).map((field) => field.key));
  known.add("auth-index");
  known.add("models");
  known.add("excluded-models");
  known.add("headers");
  known.add("disable-cooling");
  known.add("request-retry");
  known.add("request-scoped-errors");
  known.add("cloak");
  known.add("fingerprint-profile");
  for (const row of KIND_BEHAVIOR[kind.id] ?? []) known.add(row.key);
  const [text, setText] = useState(() => {
    const rest: Entry = {};
    for (const [key, value] of Object.entries(draft)) {
      if (!known.has(key)) rest[key] = value;
    }
    return JSON.stringify(rest, null, 2);
  });
  return (
    <details className="group">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-xs">
        <span className="inline-flex items-center gap-1">{t("providers.advancedJson")}</span>
      </summary>
      <div className="mt-2 space-y-2">
        <textarea
          className="bg-secondary/50 h-40 w-full resize-y rounded-xl border border-border/60 p-3 font-mono text-xs"
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              try {
                const parsed = JSON.parse(text) as Entry;
                const next: Entry = {};
                for (const [key, value] of Object.entries(draft)) {
                  if (known.has(key)) next[key] = value;
                }
                for (const [key, value] of Object.entries(parsed)) next[key] = value;
                onApply(next);
                toast.success(t("common.saved"));
              } catch (error) {
                toast.error(String(error));
              }
            }}
          >
            {t("common.apply")}
          </Button>
        </div>
      </div>
    </details>
  );
}
