import { useState, type ReactNode } from "react";
import { ChevronRight, Feather, Image, KeyRound, Shield, Terminal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ConnectionPoolEditor, type ConnectionPoolConfig } from "@/components/providers/connection-pool-editor";
import { SensitiveRulesEditor, type SensitiveRulesValue } from "@/components/config/sensitive-rules-editor";
import { cn } from "@/lib/utils";

export type ConfigDoc = Record<string, unknown>;

function isPlainObject(value: unknown): value is ConfigDoc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return true if any nested mapping key present in `original` was removed in `draft`. */
export function hasRemovedObjectKey(original: unknown, draft: unknown): boolean {
  if (!isPlainObject(original) || !isPlainObject(draft)) return false;
  for (const [key, origVal] of Object.entries(original)) {
    if (!(key in draft)) return true;
    if (isPlainObject(origVal) && hasRemovedObjectKey(origVal, draft[key])) return true;
  }
  return false;
}

/** Delete keys whose value is undefined/empty-object so we never emit empty v8 sub-containers. */
export function patchNestedDoc(parent: ConfigDoc, key: string, child: ConfigDoc): ConfigDoc {
  const cleaned: ConfigDoc = {};
  for (const [k, v] of Object.entries(child)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const next = { ...parent };
  if (Object.keys(cleaned).length === 0) {
    delete next[key];
  } else {
    next[key] = cleaned;
  }
  return next;
}

export function ConfigSwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 last:border-0">
      <div className="min-w-0 pr-2">
        <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{label}</p>
        {hint ? <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function StringListChipsInput({
  label,
  hint,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  placeholder?: string;
  onChange: (next: string[] | undefined) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    setDraft("");
    if (parts.length === 0) return;
    const merged = [...new Set([...values, ...parts])];
    onChange(merged.length > 0 ? merged : undefined);
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((item) => (
            <Badge key={item} variant="outline" className="gap-1 font-mono text-[11px]">
              {item}
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive cursor-pointer"
                onClick={() => {
                  const next = values.filter((v) => v !== item);
                  onChange(next.length > 0 ? next : undefined);
                }}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Input
        className="h-8 rounded-xl font-mono text-xs"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      {hint ? <p className="text-[11px] text-slate-400 leading-relaxed">{hint}</p> : null}
    </div>
  );
}

function CollapsibleSection({
  title,
  hint,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/60 dark:border-slate-800 dark:bg-slate-950/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{title}</p>
            {badge ? (
              <Badge variant="outline" className="h-4.5 px-1.5 font-mono text-[10px] font-normal">
                {badge}
              </Badge>
            ) : null}
          </div>
          {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{hint}</p> : null}
        </div>
        <ChevronRight className={cn("size-3.5 shrink-0 text-slate-400 transition-transform duration-200", open && "rotate-90")} />
      </button>
      {open ? <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">{children}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Claude Header Defaults

export function ClaudeHeaderDefaultsEditor({
  claude,
  onChange,
}: {
  claude: ConfigDoc;
  onChange: (nextClaude: ConfigDoc) => void;
}) {
  const hd = (claude["header-defaults"] as ConfigDoc | undefined) ?? {};
  const configuredCount = Object.values(hd).filter((v) => {
    if (v === undefined || v === null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;

  const patchHD = (changes: ConfigDoc) => {
    const merged: ConfigDoc = { ...hd };
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    onChange(patchNestedDoc(claude, "header-defaults", merged));
  };

  const triValue = (val: unknown) => (typeof val === "boolean" ? (val ? "on" : "off") : "unset");
  const parseTri = (val: string) => (val === "unset" ? undefined : val === "on");

  return (
    <CollapsibleSection
      title="Claude 请求头与设备基线 (Header Defaults)"
      hint="配置伪装/回退使用的 Claude Code 软件版本、平台指纹、Anthropic-Beta 增删与诊断头。"
      badge={configuredCount > 0 ? `${configuredCount} 项已配` : undefined}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">User-Agent (user-agent)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(hd["user-agent"] ?? "")}
              placeholder="留空使用内置基线"
              onChange={(e) => patchHD({ "user-agent": e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Package Version (package-version)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(hd["package-version"] ?? "")}
              placeholder="如 0.74.0"
              onChange={(e) => patchHD({ "package-version": e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Runtime Version (runtime-version)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(hd["runtime-version"] ?? "")}
              placeholder="如 v22.14.0"
              onChange={(e) => patchHD({ "runtime-version": e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">客户端请求超时头 (timeout)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(hd.timeout ?? "")}
              placeholder="如 600"
              onChange={(e) => patchHD({ timeout: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">操作系统 (os)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(hd.os ?? "")}
              placeholder="如 darwin / linux / win32"
              onChange={(e) => patchHD({ os: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CPU 架构 (arch)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(hd.arch ?? "")}
              placeholder="如 arm64 / x64"
              onChange={(e) => patchHD({ arch: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">时区 (timezone)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(hd.timezone ?? "")}
              placeholder="如 Asia/Shanghai"
              onChange={(e) => patchHD({ timezone: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Client Request ID (client-request-id)</Label>
            <Select
              value={String(hd["client-request-id"] || "default")}
              onValueChange={(val) => patchHD({ "client-request-id": val === "default" ? undefined : val })}
            >
              <SelectTrigger className="h-8 rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="default">默认 (on)</SelectItem>
                <SelectItem value="on">on (自动生成)</SelectItem>
                <SelectItem value="off">off (禁用)</SelectItem>
                <SelectItem value="passthrough">passthrough (透传调用方)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">锁定设备画像 (stabilize-device-profile)</Label>
            <Select
              value={triValue(hd["stabilize-device-profile"])}
              onValueChange={(val) => patchHD({ "stabilize-device-profile": parseTri(val) })}
            >
              <SelectTrigger className="h-8 rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="unset">跟随默认</SelectItem>
                <SelectItem value="on">开启 (固定 OS/Arch，不自动学习新版本)</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">注入诊断头 (inject-diagnostics)</Label>
            <Select
              value={triValue(hd["inject-diagnostics"])}
              onValueChange={(val) => patchHD({ "inject-diagnostics": parseTri(val) })}
            >
              <SelectTrigger className="h-8 rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="unset">跟随默认</SelectItem>
                <SelectItem value="on">开启</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3 border-t border-border/50 pt-3">
          <StringListChipsInput
            label="额外原生入口白名单 (native-entrypoints)"
            hint="扩展内置的原生 Claude Code 入口白名单（逗号或回车添加）。"
            values={Array.isArray(hd["native-entrypoints"]) ? (hd["native-entrypoints"] as string[]) : []}
            placeholder="输入 entrypoint 后回车"
            onChange={(next) => patchHD({ "native-entrypoints": next })}
          />
          <StringListChipsInput
            label="剥离 Anthropic-Beta 标记 (anthropic-beta-strip)"
            hint="从最终发送的 Anthropic-Beta 请求头中移除指定精确标记。"
            values={Array.isArray(hd["anthropic-beta-strip"]) ? (hd["anthropic-beta-strip"] as string[]) : []}
            placeholder="如 context-1m-2025-08-07"
            onChange={(next) => patchHD({ "anthropic-beta-strip": next })}
          />
          <StringListChipsInput
            label="追加 Anthropic-Beta 标记 (anthropic-beta-append)"
            hint="向最终发送的 Anthropic-Beta 请求头中追加指定精确标记。"
            values={Array.isArray(hd["anthropic-beta-append"]) ? (hd["anthropic-beta-append"] as string[]) : []}
            placeholder="如 interleaved-thinking-2025-05-14"
            onChange={(next) => patchHD({ "anthropic-beta-append": next })}
          />
        </div>
      </div>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------- Multimedia Form

export function MultimediaForm({ current, update }: { current: ConfigDoc; update: (changes: Partial<ConfigDoc>) => void }) {
  const rawMode = current["disable-image-generation"];
  const modeValue =
    rawMode === true || rawMode === "true"
      ? "true"
      : rawMode === "chat"
        ? "chat"
        : rawMode === "passthrough"
          ? "passthrough"
          : "false";

  const handleModeChange = (val: string) => {
    if (val === "true") update({ "disable-image-generation": true });
    else if (val === "chat") update({ "disable-image-generation": "chat" });
    else if (val === "passthrough") update({ "disable-image-generation": "passthrough" });
    else update({ "disable-image-generation": false });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Image className="size-3.5 text-pink-500" />
          <span>图片与视频多模态策略</span>
        </h4>

        <div className="space-y-1.5">
          <Label className="text-xs">图片生成工具控制 (disable-image-generation)</Label>
          <Select value={modeValue} onValueChange={handleModeChange}>
            <SelectTrigger className="h-9 rounded-xl text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="false">默认启用 (false: 所有端点允许并注入 image_generation)</SelectItem>
              <SelectItem value="chat">仅禁用对话端点 (chat: 停用 chat/responses 注入，保留 /v1/images/*)</SelectItem>
              <SelectItem value="passthrough">透传模式 (passthrough: 不注入也不移除客户端声明，保留 /v1/images/*)</SelectItem>
              <SelectItem value="true">完全禁用 (true: 所有端点禁用，/v1/images/* 返回 404)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-slate-400">
            控制内置 image_generation 工具在对话接口与图片专用接口上的注入与可用行为。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">GPT Image 2 基础模型 (gpt-image-2-base-model)</Label>
            <Input
              className="h-9 rounded-xl font-mono text-xs"
              value={String(current["gpt-image-2-base-model"] ?? "")}
              placeholder="gpt-5.4-mini"
              onChange={(e) => update({ "gpt-image-2-base-model": e.target.value })}
            />
            <p className="text-[11px] text-slate-400">
              旧版托管 image_generation 工具路径使用的主线模型，须以 gpt- 开头；留空默认 gpt-5.4-mini。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">视频结果鉴权缓存时长 (video-result-auth-cache-ttl)</Label>
            <Input
              className="h-9 rounded-xl font-mono text-xs"
              value={String(current["video-result-auth-cache-ttl"] ?? "")}
              placeholder="3h"
              onChange={(e) => update({ "video-result-auth-cache-ttl": e.target.value })}
            />
            <p className="text-[11px] text-slate-400">
              视频结果 ID 与创建凭据的绑定缓存时长（如 30m、3h）；留空默认 3h。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- OAuth Form

export function OAuthForm({
  current,
  update,
}: {
  current: ConfigDoc;
  update: (changes: Partial<ConfigDoc>) => void;
}) {
  const providers = (current.providers as ConfigDoc | undefined) ?? {};
  const antigravity = (providers.antigravity as ConfigDoc | undefined) ?? {};
  const claudeProvider = (providers.claude as ConfigDoc | undefined) ?? {};
  const codexProvider = (providers.codex as ConfigDoc | undefined) ?? {};
  const codexHeaders = (codexProvider["header-defaults"] as ConfigDoc | undefined) ?? {};
  const devinProvider = (providers.devin as ConfigDoc | undefined) ?? {};

  const updateProvider = (providerKey: string, nextProvider: ConfigDoc) => {
    const nextProviders = patchNestedDoc(providers, providerKey, nextProvider);
    update({ providers: nextProviders });
  };

  const patchAntigravity = (changes: ConfigDoc) => {
    const next: ConfigDoc = { ...antigravity };
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    updateProvider("antigravity", next);
  };

  const patchDevin = (changes: ConfigDoc) => {
    const next: ConfigDoc = { ...devinProvider };
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    updateProvider("devin", next);
  };

  const patchCodexHeaders = (changes: ConfigDoc) => {
    const merged: ConfigDoc = { ...codexHeaders };
    for (const [k, v] of Object.entries(changes)) {
      if (!v) delete merged[k];
      else merged[k] = v;
    }
    updateProvider("codex", patchNestedDoc(codexProvider, "header-defaults", merged));
  };

  const workers = Number(current["auth-auto-refresh-workers"] || 0);

  return (
    <div className="space-y-6">
      {/* Global OAuth */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <KeyRound className="size-3.5 text-blue-500" />
          <span>OAuth 全局凭据设置</span>
        </h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">凭据存放目录 (auth-dir)</Label>
            <Input
              className="h-9 rounded-xl font-mono text-xs"
              value={String(current["auth-dir"] ?? "")}
              placeholder="auths"
              onChange={(e) => update({ "auth-dir": e.target.value })}
            />
            <p className="text-[11px] text-slate-400">OAuth 凭据 JSON 文件存放路径。</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">自动刷新并发协程数 (auth-auto-refresh-workers)</Label>
            <Input
              type="number"
              min={0}
              className="h-9 rounded-xl font-mono text-xs"
              value={workers > 0 ? String(workers) : ""}
              placeholder="0 (使用默认值)"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const parsed = Number(raw);
                update({ "auth-auto-refresh-workers": raw === "" || Number.isNaN(parsed) ? 0 : Math.max(0, parsed) });
              }}
            />
            <p className="text-[11px] text-slate-400">后台自动刷新与手动全量刷新的并发工作数，≤0 使用默认值。</p>
          </div>
        </div>
      </div>

      {/* Antigravity */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Shield className="size-3.5 text-emerald-500" />
          <span>Antigravity OAuth 选项</span>
        </h4>
        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <ConnectionPoolEditor
            value={antigravity["connection-pool"] as ConnectionPoolConfig | undefined}
            onChange={(next) => patchAntigravity({ "connection-pool": next })}
            variant="antigravity"
          />

          <div className="border-t border-slate-200/60 pt-2 dark:border-slate-800">
            <ConfigSwitchRow
              label="启用 Google One AI 积分回退 (antigravity-credits)"
              hint="免费额度凭据全部耗尽（429/503）时，自动回退至带有可用 Google One AI 积分的凭据。"
              checked={Boolean(antigravity["antigravity-credits"])}
              onCheckedChange={(checked) => patchAntigravity({ "antigravity-credits": checked })}
            />
            <ConfigSwitchRow
              label="Thinking 签名缓存校验 (signature-cache-enabled)"
              hint="默认开启，优先使用并校验缓存的 thinking 块签名；关闭后直接使用归一化后的客户端签名。"
              checked={antigravity["signature-cache-enabled"] !== false}
              onCheckedChange={(checked) => patchAntigravity({ "signature-cache-enabled": checked })}
            />
            <ConfigSwitchRow
              label="签名绕过严格模式 (signature-bypass-strict)"
              hint="仅在关闭签名缓存时影响签名绕过校验的严格程度。"
              checked={Boolean(antigravity["signature-bypass-strict"])}
              onCheckedChange={(checked) => patchAntigravity({ "signature-bypass-strict": checked })}
            />
          </div>

          <div className="space-y-1.5 border-t border-slate-200/60 pt-3 dark:border-slate-800">
            <Label className="text-xs">TOS 违规池级保护暂停窗口 (tos-pause-window)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(antigravity["tos-pause-window"] ?? "")}
              placeholder="0 (禁用，可填如 6h)"
              onChange={(e) => {
                const val = e.target.value;
                patchAntigravity({ "tos-pause-window": val === "" ? undefined : val });
              }}
            />
            <p className="text-[11px] text-slate-400">
              首个 403 TOS_VIOLATION 后暂停整个凭据池的保护时长（如 6h）；留空或 0 表示仅停用当前违规凭据。
            </p>
          </div>

          <SensitiveRulesEditor
            collapsible
            title="Antigravity 系统提示词敏感词与正则替换"
            hint="配置在 Antigravity system instructions 中生效的敏感词混淆、字面替换与正则替换规则。"
            value={{
              "sensitive-words": antigravity["sensitive-words"] as string[] | undefined,
              "sensitive-words-replace": antigravity["sensitive-words-replace"] as Record<string, string> | undefined,
              "sensitive-patterns-replace": antigravity["sensitive-patterns-replace"] as SensitiveRulesValue["sensitive-patterns-replace"],
            }}
            onChange={(changes) => patchAntigravity(changes as ConfigDoc)}
          />
        </div>
      </div>

      {/* Claude OAuth */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Feather className="size-3.5 text-amber-500" />
          <span>Claude OAuth 选项</span>
        </h4>
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <ConfigSwitchRow
            label="OAuth 授权申请 org:create_api_key 权限 (oauth-include-create-api-key)"
            hint="默认开启以匹配原生 Claude Code 授权范围；若组织策略拒绝该 scope 可关闭。"
            checked={claudeProvider["oauth-include-create-api-key"] !== false}
            onCheckedChange={(checked) => updateProvider("claude", { ...claudeProvider, "oauth-include-create-api-key": checked })}
          />
        </div>
      </div>

      {/* Codex OAuth */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Terminal className="size-3.5 text-blue-500" />
          <span>Codex OAuth 选项</span>
        </h4>
        <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="space-y-1.5">
            <Label className="text-xs">Sign in with ChatGPT 标识 (signin-with-chatgpt-identifier)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(codexProvider["signin-with-chatgpt-identifier"] ?? "")}
              placeholder="CLIProxyAPI"
              onChange={(e) => {
                const next: ConfigDoc = { ...codexProvider };
                if (e.target.value === "") delete next["signin-with-chatgpt-identifier"];
                else next["signin-with-chatgpt-identifier"] = e.target.value;
                updateProvider("codex", next);
              }}
            />
            <p className="text-[11px] text-slate-400">
              SIWC OAuth 授权与请求使用的 agent_name_hint / User-Agent 前缀，留空默认 CLIProxyAPI。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-slate-200/60 pt-3 sm:grid-cols-2 dark:border-slate-800">
            <div className="space-y-1">
              <Label className="text-xs">回退 User-Agent (header-defaults.user-agent)</Label>
              <Input
                className="h-8 rounded-xl font-mono text-xs"
                value={String(codexHeaders["user-agent"] ?? "")}
                placeholder="留空使用内置默认"
                onChange={(e) => patchCodexHeaders({ "user-agent": e.target.value })}
              />
              <p className="text-[11px] text-slate-400">客户端省略 UA 时为 Codex OAuth 注入的回退值（HTTP 与 WS）。</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">回退 Beta Features (header-defaults.beta-features)</Label>
              <Input
                className="h-8 rounded-xl font-mono text-xs"
                value={String(codexHeaders["beta-features"] ?? "")}
                placeholder="留空不额外注入"
                onChange={(e) => patchCodexHeaders({ "beta-features": e.target.value })}
              />
              <p className="text-[11px] text-slate-400">仅适用于 Codex WebSocket 请求未提供时的回退值。</p>
            </div>
          </div>
        </div>
      </div>

      {/* Devin OAuth */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Devin OAuth 选项</h4>
        <SensitiveRulesEditor
          collapsible
          title="Devin 提示词敏感词与正则替换"
          hint="配置在 Devin system prompts / messages 中生效的敏感词混淆、字面替换与正则替换规则。"
          value={{
            "sensitive-words": devinProvider["sensitive-words"] as string[] | undefined,
            "sensitive-words-replace": devinProvider["sensitive-words-replace"] as Record<string, string> | undefined,
            "sensitive-patterns-replace": devinProvider["sensitive-patterns-replace"] as SensitiveRulesValue["sensitive-patterns-replace"],
          }}
          onChange={(changes) => patchDevin(changes as ConfigDoc)}
        />
      </div>
    </div>
  );
}
