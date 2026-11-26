import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Doc = Record<string, unknown>;

const DEFAULT_VERSION = "0.172.0";
const UA_HINTS: Record<string, string> = {
  builtin: "忽略下游 UA，始终发送内置 Codex 身份。",
  passthrough: "原样转发下游 UA；下游未提供时，上游也不发送 UA。",
  fallback: "下游提供 UA 时原样转发，缺失时发送内置 Codex 身份。",
};
const VERSION_SOURCE_HINTS: Record<string, string> = {
  fixed: "始终使用下方固定版本；这是默认和原有行为。",
  latest: "每 6 小时通过 GitHub 公开 API 获取 openai/codex 最新版本并缓存；固定版本作为首次刷新前的回退。",
};
const VERSION_HINTS: Record<string, string> = {
  auto: "保留已有 Version，缺失时使用内置版本；兼容现有配置。",
  builtin: "始终使用内置 Codex 版本，保持与内置 UA 一致。",
  passthrough: "原样转发下游 Version；下游未提供时不发送。",
  override: "始终使用下方指定的 Version，覆盖下游和模型目录中的值。",
};

export function CodexClientIdentity({ codex, onChange }: { codex: Doc; onChange: (codex: Doc) => void }) {
  const identity = (codex["client-identity"] as Doc | undefined) ?? {};
  const legacyDisabled = Boolean(codex["disable-codex-cloaking"]);
  const uaMode = String(identity["user-agent-mode"] || (legacyDisabled ? "fallback" : "builtin"));
  const versionMode = String(identity["version-mode"] || "auto");
  const versionSource = String(identity["client-version-source"] || "fixed");
  const version = String(identity["client-version"] || DEFAULT_VERSION).trim() || DEFAULT_VERSION;
  const builtInVersion = versionSource === "latest" ? `GitHub 最新版本（未刷新时回退 ${version}）` : version;
  const update = (changes: Doc) => onChange({ ...codex, "client-identity": { "user-agent-mode": uaMode, ...identity, ...changes } });
  const versionSummary = versionMode === "builtin"
    ? `Version 使用 ${builtInVersion}`
    : versionMode === "passthrough"
      ? "Version 原样透传，缺失时不发送"
      : versionMode === "override"
        ? `Version 固定为 ${String(identity.version || "待填写")}`
        : legacyDisabled
          ? "Version 保留已有值"
          : `Version 保留已有值，缺失时使用 ${builtInVersion}`;

  return (
    <section aria-labelledby="codex-identity-title" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/50">
      <div className="mb-4 space-y-1">
        <h5 id="codex-identity-title" className="text-sm font-semibold">客户端身份</h5>
        <p className="text-xs leading-relaxed text-muted-foreground">统一管理 Codex 请求的 UA 和 Version，HTTP 与 WebSocket 同时生效。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="codex-ua-mode">UA 策略</FieldLabel>
          <Select value={uaMode} onValueChange={(value) => update({ "user-agent-mode": value })}>
            <SelectTrigger id="codex-ua-mode" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="builtin">使用内置 UA</SelectItem>
              <SelectItem value="passthrough">原样透传 UA</SelectItem>
              <SelectItem value="fallback">优先透传 UA</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>{UA_HINTS[uaMode]}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="codex-client-version-source">内置版本来源</FieldLabel>
          <Select value={versionSource} onValueChange={(value) => update({ "client-version-source": value })}>
            <SelectTrigger id="codex-client-version-source" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">固定版本</SelectItem>
              <SelectItem value="latest">自动获取最新版本</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>{VERSION_SOURCE_HINTS[versionSource]}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="codex-client-version">{versionSource === "latest" ? "回退 Codex 版本" : "内置 Codex 版本"}</FieldLabel>
          <Input id="codex-client-version" value={String(identity["client-version"] ?? "")} placeholder={DEFAULT_VERSION} onChange={(event) => update({ "client-version": event.target.value })} />
          <FieldDescription>{versionSource === "latest" ? `自动版本不可用或未刷新时使用。留空使用 ${DEFAULT_VERSION}。` : `用于生成内置 UA 和缺省 Version。留空使用 ${DEFAULT_VERSION}。`}</FieldDescription>
        </Field>
      </div>

      <details className="group mt-4 border-t border-border/60 pt-3">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />高级设置
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="codex-version-mode">Version 策略</FieldLabel>
              <Select value={versionMode} onValueChange={(value) => update({ "version-mode": value })}>
                <SelectTrigger id="codex-version-mode" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  <SelectItem value="builtin">使用内置版本</SelectItem>
                  <SelectItem value="passthrough">原样透传</SelectItem>
                  <SelectItem value="override">固定值</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>{VERSION_HINTS[versionMode]}</FieldDescription>
            </Field>
            {versionMode === "override" ? (
              <Field>
                <FieldLabel htmlFor="codex-version-override">固定 Version</FieldLabel>
                <Input id="codex-version-override" value={String(identity.version ?? "")} placeholder={DEFAULT_VERSION} aria-invalid={!String(identity.version ?? "").trim()} onChange={(event) => update({ version: event.target.value })} />
                <FieldDescription>只覆盖 Version，不修改 UA。</FieldDescription>
              </Field>
            ) : null}
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 p-3">
            <div className="space-y-1">
              <label htmlFor="codex-disable-cloaking" className="text-xs font-medium">停用其他 Codex 身份补齐</label>
              <p className="text-xs leading-relaxed text-muted-foreground">兼容原“禁用 Codex 伪装头”选项，保留原始 Originator 和会话头处理。显式选择的 UA 与 Version 策略仍会生效。</p>
            </div>
            <Switch id="codex-disable-cloaking" checked={legacyDisabled} onCheckedChange={(checked) => onChange({ ...codex, "disable-codex-cloaking": checked })} />
          </div>
        </div>
      </details>

      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-muted-foreground dark:bg-slate-900" aria-live="polite">
        {uaMode === "builtin" ? "UA 使用内置身份" : uaMode === "passthrough" ? "UA 原样透传，缺失时不发送" : "UA 优先透传，缺失时使用内置身份"}；{versionSummary}。
      </p>
    </section>
  );
}
