import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CircleCheck, CircleX, FlaskConical, Loader2, Plus, Radio, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { EditorSection, HeadersEditor, ProviderKindSelectorGrid, ServiceTierSelect, SwitchRow } from "./compat-editor";
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
import { probeCodexWebsocket, probeUpstream, targetFor, type CodexWebsocketProbeResult, type Entry, type KindMeta, type ProbeResult } from "./provider-tools";

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
  type: "switch" | "tri" | "number" | "string" | "service-tier";
  placeholder?: string;
  /** Option labels for tri rows: [follow, on, off]; defaults to generic tri.* keys. */
  optionKeys?: [string, string, string];
}

const NAME_FIELD: ScalarField = { key: "name", labelKey: "fieldName", type: "string", hintKey: "optionalNameHint" };
const KEY_BASE: ScalarField = { key: "api-key", labelKey: "apiKey", type: "password" };
const BASE_URL: ScalarField = { key: "base-url", labelKey: "fieldBaseURL", type: "string", placeholder: "https://..." };
const PRIORITY: ScalarField = { key: "priority", labelKey: "fieldPriority", type: "number" };
const WEIGHT: ScalarField = { key: "weight", labelKey: "fieldWeight", type: "number" };
const PREFIX: ScalarField = { key: "prefix", labelKey: "fieldPrefix", type: "string", hintKey: "prefixHint" };
const PROXY: ScalarField = { key: "proxy-url", labelKey: "fieldProxyURL", type: "string", placeholder: "socks5://..." };

/** Scalar grid per kind; every kind carries name/key/base/priority/weight/prefix/proxy. */
const KEY_EDITOR_FIELDS: Record<string, ScalarField[]> = {
  gemini: [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  interactions: [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  claude: [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  vertex: [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  codex: [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  xai: [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
  meta: [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY],
};

const COOLING_ROW: BehaviorRow = { key: "disable-cooling", labelKey: "cooling", hintKey: "coolingHint", type: "tri", optionKeys: ["coolingFollow", "coolingDisable", "coolingEnable"] };
const RETRY_ROW: BehaviorRow = { key: "request-retry", labelKey: "requestRetry", hintKey: "requestRetryHint", type: "number", placeholder: "∞" };
const MAX_CONCURRENCY_ROW: BehaviorRow = { key: "max-concurrency", labelKey: "maxConcurrency", hintKey: "maxConcurrencyHint", type: "number", placeholder: "∞" };
const SERVICE_TIER_ROW: BehaviorRow = { key: "service-tier", labelKey: "serviceTier", hintKey: "serviceTierHint", type: "service-tier" };
const COOLING_RETRY: BehaviorRow[] = [COOLING_ROW, RETRY_ROW, MAX_CONCURRENCY_ROW, SERVICE_TIER_ROW];
/** Field-availability follows the Go structs: alpha-search is codex-only
 *  (sanitize force-clears it on xai/meta), websockets has no meta executor,
 *  and codex cloaking is consumed by the codex/xai request paths. */
const WEBSOCKETS_ROW: BehaviorRow = { key: "websockets", labelKey: "fieldWebsockets", hintKey: "websocketsHint", type: "switch" };
const CODEX_BEHAVIOR: BehaviorRow[] = [
  ...COOLING_RETRY,
  WEBSOCKETS_ROW,
  { key: "websocket-relay", labelKey: "websocketRelay", hintKey: "websocketRelayHint", type: "switch" },
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
  onSelectKind,
}: {
  kind: KindMeta;
  entry: Entry;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: Entry) => void;
  onSelectKind?: (kind: KindMeta, seed?: { name?: string; baseURL?: string }) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Entry>(() => structuredClone(entry));
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [wsModel, setWsModel] = useState("");
  const [wsProbe, setWsProbe] = useState<CodexWebsocketProbeResult | null>(null);
  const [wsProbing, setWsProbing] = useState(false);
  const wsModelsListId = useId();
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

  const fields = KEY_EDITOR_FIELDS[kind.id] ?? [NAME_FIELD, KEY_BASE, BASE_URL, PRIORITY, WEIGHT, PREFIX, PROXY];
  const behavior = KIND_BEHAVIOR[kind.id] ?? [COOLING_ROW, RETRY_ROW];
  const apiKey = String(draft["api-key"] ?? "");
  const rawBaseURL = String(draft["base-url"] ?? "").trim();
  const baseURL = rawBaseURL || kind.defaultBase;
  const models = (draft.models as ModelEntry[] | undefined) ?? [];
  const configuredModels = useMemo(
    () => [...new Set(models.map((m) => String(m.name ?? "").trim()).filter(Boolean))],
    [models],
  );
  const effectiveWsModel = wsModel.trim() || configuredModels[0] || "";

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

  const runWsProbe = async () => {
    if (!apiKey.trim() || !rawBaseURL) {
      toast.warning(t("providers.probeNeedsBaseAndKey"));
      return;
    }
    const rawHeaders = draft.headers as Record<string, unknown> | undefined;
    const headers: Record<string, string> = {};
    if (rawHeaders && typeof rawHeaders === "object") {
      for (const [k, v] of Object.entries(rawHeaders)) {
        const hk = k.trim();
        const hv = String(v ?? "").trim();
        if (hk && hv) headers[hk] = hv;
      }
    }
    const disableCloaking = typeof draft["disable-codex-cloaking"] === "boolean" ? draft["disable-codex-cloaking"] : undefined;
    setWsProbing(true);
    try {
      const result = await probeCodexWebsocket({
        base_url: rawBaseURL,
        api_key: apiKey.trim(),
        proxy_url: String(draft["proxy-url"] ?? "").trim() || undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        model: effectiveWsModel || undefined,
        disable_codex_cloaking: disableCloaking,
      });
      setWsProbe(result);
    } finally {
      setWsProbing(false);
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
    const trimmedName = String(clean.name ?? "").trim();
    if (trimmedName) {
      clean.name = trimmedName;
    } else {
      delete clean.name;
    }
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
          {isNew && onSelectKind ? (
            <ProviderKindSelectorGrid
              activeKindId={kind.id}
              onSelect={(nextKind) =>
                onSelectKind(nextKind, {
                  name: typeof draft.name === "string" ? draft.name : undefined,
                  baseURL: typeof draft["base-url"] === "string" ? draft["base-url"] : undefined,
                })
              }
            />
          ) : null}

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
            {kind.id === "codex" ? (
              <CodexWebsocketProbePanel
                wsModel={wsModel}
                onWsModelChange={setWsModel}
                configuredModels={configuredModels}
                listId={wsModelsListId}
                probing={wsProbing}
                disabled={wsProbing || !apiKey.trim() || !rawBaseURL}
                result={wsProbe}
                websocketsEnabled={Boolean(draft.websockets)}
                websocketRelayEnabled={Boolean(draft["websocket-relay"])}
                onProbe={runWsProbe}
                onEnableWebsockets={() => patch("websockets", true)}
                onDisableWebsockets={() => {
                  patch("websockets", false);
                  patch("websocket-relay", false);
                }}
              />
            ) : null}
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
  if (row.type === "service-tier") {
    return (
      <SwitchRow
        label={t(`providers.${row.labelKey}`)}
        hint={hint}
        control={
          <ServiceTierSelect
            value={typeof raw === "string" ? raw : undefined}
            onChange={(value) => onPatch(row.key, value)}
          />
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
  known.add("experimental-cch-signing");
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

const WS_PROBE_STATUS_META: Record<
  CodexWebsocketProbeResult["status"],
  { tone: "emerald" | "amber" | "rose"; labelKey: string; detailKey: string }
> = {
  supported: { tone: "emerald", labelKey: "providers.wsProbeStatusSupported", detailKey: "providers.wsProbeDetailSupported" },
  unsupported: { tone: "rose", labelKey: "providers.wsProbeStatusUnsupported", detailKey: "providers.wsProbeDetailUnsupported" },
  auth_error: { tone: "rose", labelKey: "providers.wsProbeStatusAuthError", detailKey: "providers.wsProbeDetailAuthError" },
  model_error: { tone: "amber", labelKey: "providers.wsProbeStatusModelError", detailKey: "providers.wsProbeDetailModelError" },
  rate_limited: { tone: "amber", labelKey: "providers.wsProbeStatusRateLimited", detailKey: "providers.wsProbeDetailRateLimited" },
  upstream_error: { tone: "rose", labelKey: "providers.wsProbeStatusUpstreamError", detailKey: "providers.wsProbeDetailUpstreamError" },
  timeout: { tone: "amber", labelKey: "providers.wsProbeStatusTimeout", detailKey: "providers.wsProbeDetailTimeout" },
  network_error: { tone: "rose", labelKey: "providers.wsProbeStatusNetworkError", detailKey: "providers.wsProbeDetailNetworkError" },
};

function CodexWebsocketProbePanel({
  wsModel,
  onWsModelChange,
  configuredModels,
  listId,
  probing,
  disabled,
  result,
  websocketsEnabled,
  websocketRelayEnabled,
  onProbe,
  onEnableWebsockets,
  onDisableWebsockets,
}: {
  wsModel: string;
  onWsModelChange: (value: string) => void;
  configuredModels: string[];
  listId: string;
  probing: boolean;
  disabled: boolean;
  result: CodexWebsocketProbeResult | null;
  websocketsEnabled: boolean;
  websocketRelayEnabled: boolean;
  onProbe: () => void;
  onEnableWebsockets: () => void;
  onDisableWebsockets: () => void;
}) {
  const { t } = useTranslation();
  const meta = result ? WS_PROBE_STATUS_META[result.status] ?? WS_PROBE_STATUS_META.upstream_error : null;

  const badgeClass =
    meta?.tone === "emerald"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : meta?.tone === "amber"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400";

  const boxClass =
    meta?.tone === "emerald"
      ? "border-emerald-500/25 bg-emerald-500/5"
      : meta?.tone === "amber"
        ? "border-amber-500/25 bg-amber-500/5"
        : "border-rose-500/25 bg-rose-500/5";

  return (
    <div className="mt-3 space-y-2.5 border-t border-border/50 pt-3">
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{t("providers.wsProbeTitle")}</p>
        <p className="text-muted-foreground text-[11px] leading-snug">{t("providers.wsProbeHint")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-52 font-mono text-xs"
          list={configuredModels.length > 0 ? listId : undefined}
          value={wsModel}
          placeholder={configuredModels[0] || t("providers.wsProbeModelPlaceholder")}
          onChange={(event) => onWsModelChange(event.target.value)}
        />
        {configuredModels.length > 0 ? (
          <datalist id={listId}>
            {configuredModels.map((modelName) => (
              <option key={modelName} value={modelName} />
            ))}
          </datalist>
        ) : null}
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onProbe} disabled={disabled}>
          {probing ? <Loader2 className="size-3.5 animate-spin" /> : <Radio className="size-3.5" />}
          {probing ? t("providers.wsProbeProbing") : t("providers.wsProbeButton")}
        </Button>
      </div>

      {result && meta ? (
        <div className={`space-y-2 rounded-xl border px-3 py-2.5 text-xs ${boxClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`gap-1 text-[11px] ${badgeClass}`}>
                {meta.tone === "emerald" ? (
                  <CircleCheck className="size-3 shrink-0" />
                ) : meta.tone === "amber" ? (
                  <AlertTriangle className="size-3 shrink-0" />
                ) : (
                  <CircleX className="size-3 shrink-0" />
                )}
                {t(meta.labelKey)}
              </Badge>
              {result.close_code ? (
                <span className="text-muted-foreground font-mono text-[11px]">WS Close {result.close_code}</span>
              ) : result.http_status ? (
                <span className="text-muted-foreground font-mono text-[11px]">HTTP {result.http_status}</span>
              ) : null}
              {result.probe_mode ? (
                <span className="text-muted-foreground text-[11px]">
                  {result.probe_mode === "fallback_chat" ? t("providers.wsProbeModeFallbackChat") : t("providers.wsProbeModePrewarm")}
                </span>
              ) : null}
              {result.event_type ? (
                <span className="text-muted-foreground font-mono text-[11px]">{result.event_type}</span>
              ) : null}
              {result.model ? (
                <span className="text-muted-foreground font-mono text-[11px]">{result.model}</span>
              ) : null}
              <span className="text-muted-foreground font-mono text-[11px]">{result.latency_ms}ms</span>
            </div>

            {result.supported && !websocketsEnabled ? (
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onEnableWebsockets}>
                {t("providers.wsProbeEnableAction")}
              </Button>
            ) : null}
            {result.status === "unsupported" && (websocketsEnabled || websocketRelayEnabled) ? (
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onDisableWebsockets}>
                {t("providers.wsProbeDisableAction")}
              </Button>
            ) : null}
          </div>

          <p className="text-muted-foreground text-[11px] leading-snug">{t(meta.detailKey)}</p>

          {!result.supported && (result.raw_error || result.message) ? (
            <p className="bg-background/70 text-foreground/90 rounded-lg border border-border/50 px-2.5 py-1.5 font-mono text-[11px] break-all">
              {result.raw_error || result.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
