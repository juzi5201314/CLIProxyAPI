import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Download, Loader2, Power, RefreshCw, X } from "lucide-react";
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
import { DetailList, JsonView, SectionCard } from "@/components/shared/misc";
import { EditorSection, HeadersEditor, ServiceTierSelect, SwitchRow } from "@/components/providers/compat-editor";
import { ExcludedModelsEditor, NumberValue, ScopedErrorsEditor } from "@/components/providers/model-editor";
import { credentials } from "@/api/management";
import { errMessage, type AuthFileEntry } from "@/api/types";
import { getCachedModels, saveCachedModels } from "@/lib/models-cache";

const NON_SERVICE_TIER_PROVIDERS = new Set(["antigravity", "devin", "gemini-cli"]);
const FINGERPRINT_PROFILE_PROVIDERS = new Set(["claude", "kimi", "kimi-ai", "kimi.ai", "kimi.com"]);

interface CredentialDraft {
  priority: number | undefined;
  weight: number | undefined;
  max_concurrency: number | undefined;
  request_retry: number | undefined;
  prefix: string;
  proxy_url: string;
  note: string;
  service_tier: string | undefined;
  disable_cooling: boolean | undefined;
  websockets: boolean;
  disable_codex_cloaking: boolean | undefined;
  use_siwc: boolean;
  fingerprint_profile: string | undefined;
  headers: Record<string, string>;
  excluded_models: string[];
  request_scoped_errors: unknown[] | undefined;
}

function normalizeServiceTier(raw?: string): string | undefined {
  const tier = (raw ?? "").trim().toLowerCase();
  if (!tier || tier === "auto") return undefined;
  return tier;
}

function normalizeHeadersRecord(raw?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    const k = key.trim();
    const v = String(value ?? "").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function normalizeExcludedModels(raw?: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeFingerprintProfile(raw?: string): string | undefined {
  const profile = (raw ?? "").trim().toLowerCase();
  if (!profile || profile === "default") return undefined;
  return profile;
}

function createInitialDraft(entry: AuthFileEntry): CredentialDraft {
  return {
    priority: typeof entry.priority === "number" ? entry.priority : undefined,
    weight: typeof entry.weight === "number" ? entry.weight : undefined,
    max_concurrency: typeof entry.max_concurrency === "number" && entry.max_concurrency > 0 ? entry.max_concurrency : undefined,
    request_retry: typeof entry.request_retry === "number" ? entry.request_retry : undefined,
    prefix: entry.prefix ?? "",
    proxy_url: entry.proxy_url ?? "",
    note: entry.note ?? "",
    service_tier: normalizeServiceTier(entry.service_tier),
    disable_cooling: typeof entry.disable_cooling === "boolean" ? entry.disable_cooling : undefined,
    websockets: Boolean(entry.websockets),
    disable_codex_cloaking: typeof entry.disable_codex_cloaking === "boolean" ? entry.disable_codex_cloaking : undefined,
    use_siwc: Boolean(entry.use_siwc),
    fingerprint_profile: normalizeFingerprintProfile(entry.fingerprint_profile),
    headers: normalizeHeadersRecord(entry.headers),
    excluded_models: normalizeExcludedModels(entry.excluded_models),
    request_scoped_errors:
      Array.isArray(entry.request_scoped_errors) && entry.request_scoped_errors.length > 0
        ? structuredClone(entry.request_scoped_errors)
        : undefined,
  };
}

function buildPatchFields(
  initial: CredentialDraft,
  draft: CredentialDraft,
  capabilities: {
    supportsServiceTier: boolean;
    supportsWebsockets: boolean;
    supportsCodexCloaking: boolean;
    supportsSIWC: boolean;
    supportsFingerprintProfile: boolean;
  },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  if (draft.priority !== initial.priority) {
    fields.priority = draft.priority ?? null;
  }
  if (draft.weight !== initial.weight) {
    fields.weight = draft.weight ?? null;
  }
  if (draft.max_concurrency !== initial.max_concurrency) {
    fields.max_concurrency = draft.max_concurrency ?? null;
  }
  if (draft.request_retry !== initial.request_retry) {
    fields.request_retry = draft.request_retry ?? null;
  }

  const nextPrefix = draft.prefix.trim().replace(/^\/+|\/+$/g, "");
  const initPrefix = initial.prefix.trim().replace(/^\/+|\/+$/g, "");
  if (nextPrefix !== initPrefix) {
    fields.prefix = nextPrefix || null;
  }

  const nextProxy = draft.proxy_url.trim();
  const initProxy = initial.proxy_url.trim();
  if (nextProxy !== initProxy) {
    fields.proxy_url = nextProxy || null;
  }

  const nextNote = draft.note.trim();
  const initNote = initial.note.trim();
  if (nextNote !== initNote) {
    fields.note = nextNote || null;
  }

  if (capabilities.supportsServiceTier) {
    const nextTier = normalizeServiceTier(draft.service_tier);
    const initTier = normalizeServiceTier(initial.service_tier);
    if (nextTier !== initTier) {
      fields.service_tier = nextTier ?? null;
    }
  }

  if (draft.disable_cooling !== initial.disable_cooling) {
    fields.disable_cooling = draft.disable_cooling ?? null;
  }

  if (capabilities.supportsWebsockets && draft.websockets !== initial.websockets) {
    fields.websockets = draft.websockets;
  }

  if (capabilities.supportsCodexCloaking && draft.disable_codex_cloaking !== initial.disable_codex_cloaking) {
    fields.disable_codex_cloaking = draft.disable_codex_cloaking ?? null;
  }

  if (capabilities.supportsSIWC && draft.use_siwc !== initial.use_siwc) {
    fields.use_siwc = draft.use_siwc;
  }

  if (capabilities.supportsFingerprintProfile) {
    const nextFP = normalizeFingerprintProfile(draft.fingerprint_profile);
    const initFP = normalizeFingerprintProfile(initial.fingerprint_profile);
    if (nextFP !== initFP) {
      fields.fingerprint_profile = nextFP ?? null;
    }
  }

  // applyAuthFileHeadersPatch merges keys and deletes any key whose value is "".
  const nextHeaders = normalizeHeadersRecord(draft.headers);
  const headersPatch: Record<string, string> = {};
  for (const [k, v] of Object.entries(nextHeaders)) {
    if (initial.headers[k] !== v) {
      headersPatch[k] = v;
    }
  }
  for (const k of Object.keys(initial.headers)) {
    if (!(k in nextHeaders)) {
      headersPatch[k] = "";
    }
  }
  if (Object.keys(headersPatch).length > 0) {
    fields.headers = headersPatch;
  }

  const nextExcluded = normalizeExcludedModels(draft.excluded_models);
  if (JSON.stringify(nextExcluded) !== JSON.stringify(initial.excluded_models)) {
    fields.excluded_models = nextExcluded.length > 0 ? nextExcluded : null;
  }

  const nextScoped = draft.request_scoped_errors && draft.request_scoped_errors.length > 0 ? draft.request_scoped_errors : [];
  const initScoped = initial.request_scoped_errors && initial.request_scoped_errors.length > 0 ? initial.request_scoped_errors : [];
  if (JSON.stringify(nextScoped) !== JSON.stringify(initScoped)) {
    fields.request_scoped_errors = nextScoped.length > 0 ? nextScoped : null;
  }

  return fields;
}

export function CredentialSettingsSheet({
  entry,
  allEntries,
  onClose,
  onChanged,
}: {
  entry: AuthFileEntry;
  allEntries?: AuthFileEntry[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const initialDraft = useMemo(() => createInitialDraft(entry), [entry]);
  const [draft, setDraft] = useState<CredentialDraft>(() => structuredClone(initialDraft));
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[] | null>(() => getCachedModels(entry.auth_index || entry.id || entry.name));
  const [syncingModels, setSyncingModels] = useState(false);
  const confirmingRef = useRef(false);

  const provider = (entry.provider || entry.type || "").toLowerCase().trim();
  const isCodex = provider === "codex";
  const isXAI = provider === "xai";
  const capabilities = useMemo(
    () => ({
      supportsServiceTier: !NON_SERVICE_TIER_PROVIDERS.has(provider),
      supportsWebsockets: isCodex || isXAI,
      supportsCodexCloaking: isCodex || isXAI,
      supportsSIWC: isCodex && Boolean(entry.siwc_bound),
      supportsFingerprintProfile: FINGERPRINT_PROFILE_PROVIDERS.has(provider),
    }),
    [provider, isCodex, isXAI, entry.siwc_bound],
  );
  const isEditable = !entry.runtime_only;

  const patchDraft = <K extends keyof CredentialDraft>(key: K, value: CredentialDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const pendingFields = useMemo(
    () => (isEditable ? buildPatchFields(initialDraft, draft, capabilities) : {}),
    [isEditable, initialDraft, draft, capabilities],
  );
  const isDirty = Object.keys(pendingFields).length > 0;

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
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const detailRows: [string, string | number][] = [];
  const pushDetail = (label: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== "") detailRows.push([label, value]);
  };
  pushDetail(t("common.provider"), entry.provider);
  pushDetail("Type", entry.type);
  pushDetail("Plan Type", entry.plan_type);
  pushDetail("Auth index", entry.auth_index);
  pushDetail("Status", entry.status_message || entry.status);
  pushDetail("Email", entry.email);
  pushDetail("Project", entry.project_id);
  pushDetail("Account", entry.account_type);
  pushDetail("Source", entry.source);
  pushDetail("Path", entry.path);
  if (entry.cooldowns && Object.keys(entry.cooldowns).length > 0) {
    pushDetail("Cooldowns", JSON.stringify(entry.cooldowns));
  }

  const saveFields = async () => {
    if (!isEditable) {
      onClose();
      return;
    }
    if (Object.keys(pendingFields).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await credentials.setFields(entry.name, pendingFields);
      toast.success(t("common.saved"));
      onChanged();
      onClose();
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !isDirty) onClose();
      }}
    >
      <SheetContent
        showCloseButton={false}
        className="flex w-full flex-col gap-0 sm:max-w-2xl!"
        onPointerDownOutside={(event) => {
          event.preventDefault();
          confirmExit(onClose);
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
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
          <SheetTitle className="flex items-center gap-2 text-base">
            <Power className={`size-4 shrink-0 ${entry.disabled ? "text-zinc-400" : "text-emerald-500"}`} />
            <span className="truncate">{entry.name}</span>
          </SheetTitle>
          <SheetDescription className="truncate">
            {[entry.provider, entry.plan_type, entry.email].filter(Boolean).join(" · ") || entry.path || t("authFiles.editProps")}
          </SheetDescription>
        </SheetHeader>

        <div className="-mx-4 flex-1 space-y-7 overflow-y-auto px-4 py-5">
          <EditorSection title={t("authFiles.overview")}>
            <DetailList rows={detailRows} />
          </EditorSection>

          {!isEditable ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              {t("authFiles.runtimeOnlyEditHint")}
            </div>
          ) : (
            <>
              <EditorSection title={t("providers.basicInfo")}>
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("providers.fieldPriority")}</Label>
                    <NumberValue
                      className="h-9"
                      value={draft.priority}
                      onChange={(value) => patchDraft("priority", value)}
                    />
                    <p className="text-muted-foreground text-[11px] leading-snug">{t("providers.priorityHint")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("providers.fieldWeight")}</Label>
                    <NumberValue
                      className="h-9"
                      value={draft.weight}
                      onChange={(value) => patchDraft("weight", value)}
                    />
                    <p className="text-muted-foreground text-[11px] leading-snug">{t("providers.weightHint")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("providers.fieldPrefix")}</Label>
                    <Input
                      className="h-9 font-mono text-xs"
                      value={draft.prefix}
                      placeholder="team-a"
                      onChange={(event) => patchDraft("prefix", event.target.value)}
                    />
                    <p className="text-muted-foreground text-[11px] leading-snug">{t("providers.prefixHint")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("providers.fieldProxyURL")}</Label>
                    <Input
                      className="h-9 font-mono text-xs"
                      value={draft.proxy_url}
                      placeholder="socks5://..."
                      onChange={(event) => patchDraft("proxy_url", event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">{t("authFiles.fieldNote")}</Label>
                    <Input
                      className="h-9 text-xs"
                      value={draft.note}
                      placeholder={t("authFiles.notePlaceholder")}
                      onChange={(event) => patchDraft("note", event.target.value)}
                    />
                  </div>
                </div>
              </EditorSection>

              <EditorSection title={t("providers.behavior")}>
                <div className="space-y-1">
                  {capabilities.supportsServiceTier ? (
                    <SwitchRow
                      label={t("providers.serviceTier")}
                      hint={t("providers.serviceTierHint")}
                      control={
                        <ServiceTierSelect
                          value={draft.service_tier}
                          onChange={(value) => patchDraft("service_tier", value)}
                        />
                      }
                    />
                  ) : null}

                  <SwitchRow
                    label={t("providers.cooling")}
                    hint={t("providers.coolingHint")}
                    control={
                      <Select
                        value={draft.disable_cooling === undefined ? "unset" : draft.disable_cooling ? "on" : "off"}
                        onValueChange={(value) =>
                          patchDraft("disable_cooling", value === "unset" ? undefined : value === "on")
                        }
                      >
                        <SelectTrigger className="h-8 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unset">{t("providers.coolingFollow")}</SelectItem>
                          <SelectItem value="on">{t("providers.coolingDisable")}</SelectItem>
                          <SelectItem value="off">{t("providers.coolingEnable")}</SelectItem>
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
                        value={draft.request_retry}
                        onChange={(value) => patchDraft("request_retry", value)}
                        placeholder="∞"
                      />
                    }
                  />

                  <SwitchRow
                    label={t("providers.maxConcurrency")}
                    hint={t("providers.maxConcurrencyHint")}
                    control={
                      <NumberValue
                        className="w-40"
                        value={draft.max_concurrency}
                        onChange={(value) => patchDraft("max_concurrency", value)}
                        placeholder="∞"
                      />
                    }
                  />

                  {capabilities.supportsWebsockets ? (
                    <SwitchRow
                      label={t("providers.fieldWebsockets")}
                      hint={t("providers.websocketsHint")}
                      checked={draft.websockets}
                      onCheckedChange={(checked) => patchDraft("websockets", checked)}
                    />
                  ) : null}

                  {capabilities.supportsCodexCloaking ? (
                    <SwitchRow
                      label={t("providers.disableCodexCloaking")}
                      hint={t("providers.disableCodexCloakingHint")}
                      control={
                        <Select
                          value={
                            draft.disable_codex_cloaking === undefined
                              ? "unset"
                              : draft.disable_codex_cloaking
                              ? "on"
                              : "off"
                          }
                          onValueChange={(value) =>
                            patchDraft("disable_codex_cloaking", value === "unset" ? undefined : value === "on")
                          }
                        >
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unset">{t("providers.triFollow")}</SelectItem>
                            <SelectItem value="on">{t("providers.triOn")}</SelectItem>
                            <SelectItem value="off">{t("providers.triOff")}</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                    />
                  ) : null}

                  {capabilities.supportsSIWC ? (
                    <SwitchRow
                      label={t("authFiles.useSIWC")}
                      hint={t("authFiles.useSIWCHint")}
                      checked={draft.use_siwc}
                      onCheckedChange={(checked) => patchDraft("use_siwc", checked)}
                    />
                  ) : null}

                  {capabilities.supportsFingerprintProfile ? (
                    <SwitchRow
                      label={t("providers.claudeFingerprintProfile")}
                      hint={t("providers.claudeFingerprintProfileHint")}
                      control={
                        <Select
                          value={draft.fingerprint_profile === "claude-code-cli" ? "claude-code-cli" : "default"}
                          onValueChange={(value) =>
                            patchDraft("fingerprint_profile", value === "claude-code-cli" ? "claude-code-cli" : undefined)
                          }
                        >
                          <SelectTrigger className="h-8 w-52 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">{t("providers.claudeFingerprintDefault")}</SelectItem>
                            <SelectItem value="claude-code-cli">{t("providers.claudeFingerprintCli")}</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                    />
                  ) : null}
                </div>
              </EditorSection>

              <HeadersEditor
                headers={draft.headers}
                onChange={(headers) => patchDraft("headers", headers)}
              />

              <EditorSection title={t("providers.excludedModels")} hint={t("providers.excludedEntryHint")}>
                <ExcludedModelsEditor
                  values={draft.excluded_models}
                  onChange={(next) => patchDraft("excluded_models", next ?? [])}
                />
              </EditorSection>

              <EditorSection title={t("providers.scopedErrors")} hint={t("providers.scopedErrorsHint")}>
                <ScopedErrorsEditor
                  value={draft.request_scoped_errors}
                  onChange={(value) => patchDraft("request_scoped_errors", value)}
                />
              </EditorSection>
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 justify-between text-xs"
                onClick={async () => {
                  if (models !== null && models.length > 0) {
                    setModels(null);
                    return;
                  }
                  const cached = getCachedModels(entry.auth_index || entry.id || entry.name);
                  if (cached) {
                    setModels(cached);
                  }
                  try {
                    const list = await credentials.models(entry.name);
                    const ids = list.map((model) => model.id);
                    setModels(ids);
                    saveCachedModels([entry.auth_index, entry.id, entry.name], ids);
                  } catch (error) {
                    if (!cached) {
                      toast.error(errMessage(error));
                    }
                  }
                }}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <ChevronRight className={`size-3.5 shrink-0 transition-transform ${models !== null && models.length > 0 ? "rotate-90" : ""}`} />
                  <span>{t("authFiles.viewModels")}</span>
                </div>
                {models !== null && models.length > 0 ? (
                  <span className="text-[10px] text-muted-foreground font-mono font-normal">({models.length})</span>
                ) : null}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                title={t("authFiles.syncModelsHint")}
                disabled={syncingModels}
                onClick={async () => {
                  setSyncingModels(true);
                  try {
                    const res = await credentials.syncModels({ name: entry.name, auth_index: entry.auth_index });
                    const ids = res.models.map((m) => m.id);
                    setModels(ids);
                    saveCachedModels([entry.auth_index, entry.id, entry.name], ids);

                    if (res.synced_peers && res.synced_peers > 0 && allEntries) {
                      for (const peer of allEntries) {
                        if (peer.name === entry.name || peer.id === entry.id) continue;
                        const sameProvider =
                          (peer.provider || peer.type || "").toLowerCase() ===
                          (entry.provider || entry.type || "").toLowerCase();
                        const samePlan = (peer.plan_type || "").toLowerCase() === (entry.plan_type || "").toLowerCase();
                        if (sameProvider && samePlan) {
                          saveCachedModels([peer.auth_index, peer.id, peer.name], ids);
                        }
                      }
                    }

                    if (res.synced_peers && res.synced_peers > 0) {
                      toast.success(t("authFiles.modelsSyncedWithPeers", { count: ids.length, peers: res.synced_peers }));
                    } else {
                      toast.success(t("authFiles.modelsSynced", { count: ids.length }));
                    }
                  } catch (error) {
                    toast.error(`${t("authFiles.modelsSyncFailed")}: ${errMessage(error)}`);
                  } finally {
                    setSyncingModels(false);
                  }
                }}
              >
                <RefreshCw className={`size-3.5 ${syncingModels ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{t("authFiles.syncModels")}</span>
              </Button>
            </div>
            {models !== null && models.length > 0 ? (
              <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-2.5">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{t("authFiles.availableModelsCount", { count: models.length })}</span>
                </div>
                <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto pr-1">
                  {models.map((model) => (
                    <Badge key={model} variant="outline" className="bg-background/80 font-mono text-[10px]">
                      {model}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : models !== null && models.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">{t("common.empty")}</p>
            ) : null}
          </div>

          <SectionCard title={t("common.details")}>
            <JsonView value={entry} className="max-h-72" />
          </SectionCard>
        </div>

        <SheetFooter className="flex-row items-center justify-between gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={async () => {
              try {
                await credentials.download(entry.name);
              } catch (error) {
                toast.error(errMessage(error));
              }
            }}
          >
            <Download className="size-3.5" />
            {t("common.download")}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => confirmExit(onClose)}>
              {t("common.cancel")}
            </Button>
            {isEditable ? (
              <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={() => void saveFields()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t("common.save")}
              </Button>
            ) : null}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
