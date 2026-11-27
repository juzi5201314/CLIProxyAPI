import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { yaml as yamlLanguage } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { useTheme } from "next-themes";
import {
  Activity,
  AlertTriangle,
  Blocks,
  Check,
  ChevronRight,
  Cpu,
  Feather,
  FileCode2,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  PanelsTopLeft,
  Plus,
  RotateCcw,
  Route,
  Server,
  Settings2,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { CodexClientIdentity } from "@/components/config/codex-client-identity";
import {
  ClaudeHeaderDefaultsEditor,
  MultimediaForm,
  OAuthForm,
  StringListChipsInput,
  hasRemovedObjectKey,
} from "@/components/config/config-section-forms";
import { config } from "@/api/management";
import { putConfigPath } from "@/api/v8-config";
import { errMessage } from "@/api/types";
import { cn } from "@/lib/utils";

type Doc = Record<string, unknown>;

const SECTION_ICONS: Record<string, typeof Settings2> = {
  routing: Route,
  requests: Globe,
  upstream: Zap,
  client: Cpu,
  server: Server,
  management: Settings2,
  access: KeyRound,
  models: Layers,
  oauth: KeyRound,
  multimedia: Layers,
  observability: Activity,
  plugins: Blocks,
};

const SECTION_LABELS: Record<string, string> = {
  routing: "路由与亲和性 (Routing)",
  requests: "网络与代理 (Requests)",
  upstream: "上游引擎策略 (Upstream)",
  client: "客户端兼容性 (Client)",
  server: "服务器与安全 (Server)",
  management: "管理端配置 (Management)",
  access: "客户端访问密钥 (Access Keys)",
  models: "模型目录源 (Catalogs)",
  oauth: "OAuth 授权 (OAuth)",
  multimedia: "多媒体处理 (Multimedia)",
  observability: "可观测性 (Observability)",
  plugins: "插件系统 (Plugins)",
};

/** Top-level fields already rendered by the dedicated section forms. */
const HANDLED_PATHS: Record<string, string[]> = {
  routing: [
    "strategy",
    "session-affinity",
    "session-affinity-ttl",
    "session-affinity-subagents",
    "session-affinity-rebind-on",
    "force-model-prefix",
    "retry.request-retry",
    "retry.max-retry-credentials",
    "retry.max-retry-interval",
    "cooldown.transient-error-cooldown-seconds",
    "cooldown.disable-cooling",
    "cooldown.save-cooldown-status",
  ],
  requests: [
    "proxy-url",
    "tls-handshake-timeout-seconds",
    "nonstream-keepalive-interval",
    "passthrough-headers",
    "streaming.keepalive-seconds",
    "streaming.bootstrap-retries",
    "streaming.send-keepalive-before-ft",
  ],
  upstream: [
    "codex.websocket-relay.idle-ttl",
    "codex.websocket-relay.max-memory",
    "codex.response-steering",
    "codex.stream-bootstrap-buffering",
    "codex.stream-bootstrap-timeout",
    "codex.orphan-delegation-compatibility",
    "codex.model-level-cooling",
    "codex.disable-codex-cloaking",
    "codex.client-identity",
    "codex.websocket-compression",
    "codex.upstream-request-compression",
    "codex.upstream-request-compression-min-bytes",
    "claude.tool-search",
    "claude.model-level-cooling",
    "claude.server-side-fallback",
    "claude.session-date-pin-days",
    "claude.disable-claude-cloak-mode",
    "claude.disable-cloaking-model-list",
    "claude.header-defaults",
    "xai.inject-x-search",
  ],
  client: [
    "codex.enable-apply-patch",
    "codex.optimize-multi-agent-v2",
    "codex.web-search-result-cache.enabled",
    "codex.web-search-result-cache.ttl",
    "codex.web-search-result-cache.limit",
    "claude.show-codex-commentary",
  ],
  server: [
    "host",
    "port",
    "max-request-body-bytes",
    "shutdown-timeout",
    "commercial-mode",
    "github-token",
    "trusted-proxies",
    "tls",
    "kv-store",
    "response-compression",
    "discovery.enabled",
  ],
  management: ["allow-remote", "secret-key", "disable-control-panel"],
  access: ["api-keys"],
  models: ["catalog", "codex-catalog", "devin-catalog"],
  multimedia: ["disable-image-generation", "gpt-image-2-base-model", "video-result-auth-cache-ttl"],
  oauth: [
    "auth-dir",
    "auth-auto-refresh-workers",
    "providers.antigravity.connection-pool",
    "providers.antigravity.antigravity-credits",
    "providers.antigravity.signature-cache-enabled",
    "providers.antigravity.signature-bypass-strict",
    "providers.antigravity.tos-pause-window",
    "providers.antigravity.sensitive-words",
    "providers.antigravity.sensitive-words-replace",
    "providers.antigravity.sensitive-patterns-replace",
    "providers.claude.oauth-include-create-api-key",
    "providers.codex.signin-with-chatgpt-identifier",
    "providers.codex.header-defaults",
    "providers.devin.sensitive-words",
    "providers.devin.sensitive-words-replace",
    "providers.devin.sensitive-patterns-replace",
  ],
};

const ALWAYS_VISIBLE_SECTIONS = new Set([
  "routing",
  "requests",
  "upstream",
  "client",
  "server",
  "management",
  "access",
  "models",
  "oauth",
  "multimedia",
]);

type FieldMeta = {
  label: string;
  hint?: string;
};

/** Human-readable labels for fields rendered by the automatic fallback editor. */
const FIELD_META: Record<string, FieldMeta> = {
  "routing.retry.max-retry-credentials": {
    label: "最大重试凭据数",
    hint: "单轮故障切换最多尝试的凭据数量，0 表示不限制。",
  },
  "upstream.codex.stream-bootstrap-timeout": {
    label: "首包缓冲超时",
    hint: "等待上游首个流式数据包的最长时间。",
  },
  "upstream.codex.orphan-delegation-compatibility": {
    label: "孤立委托兼容",
    hint: "兼容缺少父级上下文的委托请求。",
  },
  "upstream.claude.session-date-pin-days": {
    label: "会话日期固定天数",
    hint: "在提示词中固定会话日期的天数。",
  },
  "upstream.claude.disable-cloaking-model-list": {
    label: "禁用 Claude 伪装模型列表",
    hint: "指定不应用 Claude Code 伪装头的模型。",
  },
  "client.codex.web-search-result-cache.ttl": {
    label: "搜索结果缓存 TTL",
    hint: "会话内联网搜索结果的保留时长。",
  },
  "client.codex.web-search-result-cache.limit": {
    label: "搜索结果缓存上限",
    hint: "单个会话最多缓存的搜索结果条数。",
  },
  "server.trusted-proxies": {
    label: "可信代理列表",
    hint: "允许提供 X-Forwarded-* 请求头的 IP 或 CIDR。",
  },
  "server.tls": {
    label: "TLS 配置",
    hint: "启用 HTTPS 监听时使用的证书与私钥。",
  },
  "server.tls.enable": { label: "启用 TLS", hint: "使用下方证书和私钥启用 HTTPS。" },
  "server.tls.cert": { label: "证书路径", hint: "PEM 格式的证书文件。" },
  "server.tls.key": { label: "私钥路径", hint: "PEM 格式的私钥文件。" },
  "server.discovery": {
    label: "局域网服务发现",
    hint: "mDNS / DNS-SD 广播配置。",
  },
  "server.discovery.service-name": {
    label: "服务名前缀",
    hint: "广播为 CPA-<ShortID> 或指定名称。",
  },
  "server.discovery.service-type": {
    label: "服务类型",
    hint: "默认使用 _ai-gateway._tcp。",
  },
  "server.discovery.subtypes": {
    label: "协议子类型",
    hint: "对外广播的 API 协议子类型。",
  },
  "server.discovery.interfaces": {
    label: "网络接口",
    hint: "指定参与广播的网卡。",
  },
  "server.discovery.interfaces.include": {
    label: "包含接口",
    hint: "留空自动选择物理网卡。",
  },
  "server.discovery.interfaces.exclude": {
    label: "排除接口",
    hint: "额外排除的网卡模式。",
  },
  "server.discovery.auth-required": {
    label: "需要凭据",
    hint: "广播时声明客户端需要认证。",
  },
  "server.discovery.advertise-management": {
    label: "广播管理端",
    hint: "同时广播管理面板可用性。",
  },
  "management.base-url": {
    label: "管理端基础 URL",
    hint: "TUI 客户端连接远程管理 API 时使用。",
  },
  "oauth.auth-dir": {
    label: "凭据目录",
    hint: "OAuth 与 API Key 凭据的存放目录。",
  },
  "oauth.providers": {
    label: "OAuth 供应商",
    hint: "各上游供应商的 OAuth 行为配置。",
  },
  "oauth.providers.aistudio": {
    label: "AI Studio",
    hint: "Google AI Studio OAuth 选项。",
  },
  "oauth.providers.aistudio.ws-auth": {
    label: "WebSocket 认证",
    hint: "使用 WebSocket 认证方式。",
  },
  "oauth.providers.codex": {
    label: "Codex",
    hint: "Codex OAuth 选项。",
  },
  "oauth.providers.codex.live-media-relay": {
    label: "实时媒体中继",
    hint: "Codex 实时媒体 WebRTC 中继配置。",
  },
  "oauth.providers.codex.live-media-relay.enabled": {
    label: "启用中继",
    hint: "开启 Codex 实时媒体中继。",
  },
  "oauth.providers.codex.live-media-relay.max-sessions": {
    label: "最大会话数",
    hint: "同时保持的实时媒体会话上限。",
  },
  "oauth.providers.codex.live-media-relay.disable-private-remote-ips": {
    label: "禁用私有远端 IP",
    hint: "拒绝连接到内网地址。",
  },
  "oauth.providers.codex.live-media-relay.public-ip": {
    label: "公网 IP",
    hint: "对外公布的中继公网地址。",
  },
  "oauth.providers.codex.live-media-relay.udp-port-min": {
    label: "UDP 端口下限",
    hint: "中继使用的 UDP 端口范围起点。",
  },
  "oauth.providers.codex.live-media-relay.udp-port-max": {
    label: "UDP 端口上限",
    hint: "中继使用的 UDP 端口范围终点。",
  },
  "oauth.providers.codex.signin-with-chatgpt-identifier": {
    label: "登录标识",
    hint: "登录时使用的 ChatGPT 客户端标识。",
  },
  "oauth.providers.antigravity": {
    label: "Antigravity",
    hint: "Antigravity OAuth 选项。",
  },
  "oauth.providers.antigravity.antigravity-credits": {
    label: "Antigravity 积分",
    hint: "使用 Antigravity 积分额度。",
  },
  multimedia: {
    label: "多媒体处理",
    hint: "图片、视频等多模态能力配置。",
  },
  "multimedia.disable-image-generation": {
    label: "禁用图片生成",
    hint: "关闭图片生成能力。",
  },
  "multimedia.video-result-auth-cache-ttl": {
    label: "视频结果鉴权缓存 TTL",
    hint: "视频结果下载鉴权的缓存时长。",
  },
  observability: {
    label: "可观测性",
    hint: "日志、请求数据库、用量统计与 pprof 配置。",
  },
  "observability.logs": {
    label: "日志",
    hint: "服务端日志与请求日志配置。",
  },
  "observability.logs.debug": {
    label: "调试日志",
    hint: "输出更详细的调试日志。",
  },
  "observability.logs.logging-to-file": {
    label: "文件日志",
    hint: "将日志写入文件。",
  },
  "observability.logs.logs-max-total-size-mb": {
    label: "日志总大小上限",
    hint: "日志文件总大小上限（MB），0 表示不限制。",
  },
  "observability.logs.error-logs-max-files": {
    label: "错误日志保留数",
    hint: "保留的 error-*.log 文件数量。",
  },
  "observability.logs.request-log": {
    label: "请求日志",
    hint: "记录代理请求与响应日志。",
  },
  "observability.request-db": {
    label: "请求数据库",
    hint: "SQLite 请求元数据存储。",
  },
  "observability.request-db.enabled": {
    label: "启用请求数据库",
    hint: "记录每次请求的模型、Token、延迟等元数据。",
  },
  "observability.request-db.path": {
    label: "数据库路径",
    hint: "留空使用 auth-dir/requestlog.db。",
  },
  "observability.request-db.retention-days": {
    label: "保留天数",
    hint: "超过天数的记录会被清理，0 表示永久保留。",
  },
  "observability.request-db.preview-bytes": {
    label: "消息预览字节数",
    hint: "额外保存的请求/响应体字节数，0 表示不保存。",
  },
  "observability.request-db.error-body-max-bytes": {
    label: "错误体上限",
    hint: "失败请求上游错误体的最大保存长度。",
  },
  "observability.usage": {
    label: "用量统计",
    hint: "内存用量聚合与队列配置。",
  },
  "observability.usage.usage-statistics-enabled": {
    label: "启用用量统计",
    hint: "启用内存用量统计聚合。",
  },
  "observability.usage.redis-usage-queue-retention-seconds": {
    label: "队列保留秒数",
    hint: "用量队列在内存中的保留时间。",
  },
  "observability.pprof": {
    label: "pprof",
    hint: "Go 性能分析调试服务。",
  },
  "observability.pprof.enable": {
    label: "启用 pprof",
    hint: "开启 pprof HTTP 调试服务。",
  },
  "observability.pprof.addr": {
    label: "监听地址",
    hint: "建议仅绑定 localhost。",
  },
  plugins: {
    label: "插件系统",
    hint: "动态库插件配置。",
  },
  "plugins.enabled": {
    label: "启用插件",
    hint: "加载 plugins 目录下的动态库插件。",
  },
  "plugins.dir": {
    label: "插件目录",
    hint: "动态库插件所在目录。",
  },
  "plugins.configs": {
    label: "插件实例配置",
    hint: "以插件 ID 为键的实例级配置。",
  },
};

export function ConfigPage() {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const doc = useQuery({ queryKey: ["config-doc"], queryFn: () => config.get<Doc>() });

  const [tab, setTab] = useState(() => (searchParams.get("tab") === "yaml" ? "yaml" : "visual"));
  const [activeSection, setActiveSection] = useState("routing");
  const [drafts, setDrafts] = useState<Record<string, Doc>>({});
  const [yamlDraft, setYamlDraft] = useState<string | null>(null);

  useEffect(() => {
    const paramTab = searchParams.get("tab");
    if (paramTab === "yaml" || paramTab === "visual") {
      setTab(paramTab);
    }
  }, [searchParams]);

  const handleTabChange = (nextTab: string) => {
    setTab(nextTab);
    if (nextTab === "yaml") {
      setSearchParams({ tab: "yaml" }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const sections = useMemo(() => {
    const rawKeys = Object.keys(doc.data?.config ?? {});
    const priority = ["routing", "requests", "upstream", "client", "server", "management", "access", "models", "oauth", "multimedia", "observability", "plugins"];
    const ordered = [
      ...priority.filter((k) => ALWAYS_VISIBLE_SECTIONS.has(k) || rawKeys.includes(k)),
      ...rawKeys.filter((k) => !priority.includes(k) && k !== "config-version"),
    ];
    return ordered;
  }, [doc.data]);

  useEffect(() => {
    if ((!activeSection || !sections.includes(activeSection)) && sections.length > 0) {
      setActiveSection(sections[0] ?? "routing");
    }
  }, [sections, activeSection]);

  const dirtySections = Object.keys(drafts);

  const saveSection = useMutation({
    mutationFn: async (name: string) => {
      const etag = doc.data?.etag ?? "";
      const originalSection = (doc.data?.config ?? {})[name] ?? {};
      const nextSection = drafts[name];
      try {
        if (hasRemovedObjectKey(originalSection, nextSection)) {
          await putConfigPath(name, nextSection, etag);
        } else {
          await config.patchPath(name, nextSection, etag);
        }
        return true;
      } catch (error) {
        if (errMessage(error).includes("precondition_failed")) {
          toast.error(t("config.conflict"));
          await queryClient.invalidateQueries({ queryKey: ["config-doc"] });
          return false;
        }
        throw error;
      }
    },
    onSuccess: (ok, name) => {
      if (ok) {
        toast.success(t("common.saved"));
        setDrafts((current) => {
          const next = { ...current };
          delete next[name];
          return next;
        });
        void queryClient.invalidateQueries({ queryKey: ["config-doc"] });
      }
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  const saveAll = async () => {
    for (const name of dirtySections) {
      const ok = await saveSection.mutateAsync(name);
      if (!ok) return;
    }
  };

  const yaml = useQuery({
    queryKey: ["config-yaml"],
    queryFn: () => config.getYAML(),
    enabled: tab === "yaml",
  });
  useEffect(() => {
    if (yaml.data && yamlDraft === null) setYamlDraft(yaml.data.yaml);
  }, [yaml.data]);

  const saveYaml = useMutation({
    mutationFn: async () => {
      await config.putYAML(yamlDraft ?? "", yaml.data?.etag ?? "");
    },
    onSuccess: () => {
      toast.success(t("common.saved"));
      setYamlDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["config-doc"] });
      void queryClient.invalidateQueries({ queryKey: ["config-yaml"] });
    },
    onError: (error) => {
      if (errMessage(error).includes("precondition_failed")) {
        toast.error(t("config.conflict"));
      } else {
        toast.error(errMessage(error));
      }
      void queryClient.invalidateQueries({ queryKey: ["config-yaml"] });
    },
  });

  const setSectionDraft = (name: string, value: Doc) => {
    setDrafts((current) => {
      const next = { ...current };
      const originalValue = (doc.data?.config ?? {})[name] ?? {};
      if (JSON.stringify(value) === JSON.stringify(originalValue)) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  return (
    <>
      <PageHeader title={t("nav.config")} subtitle={t("config.subtitle")}>
        {tab === "visual" ? (
          <>
            {dirtySections.length > 0 ? (
              <>
                <span className="text-xs text-amber-500 font-medium">
                  <AlertTriangle className="mr-1 inline size-3.5" />
                  {t("config.dirtyCount", { count: dirtySections.length })}
                </span>
                <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs" onClick={() => setDrafts({})}>
                  <RotateCcw className="size-3.5" />
                  <span>{t("config.discard")}</span>
                </Button>
                <Button size="sm" className="h-8 gap-1.5 rounded-xl bg-blue-600 text-white shadow-xs text-xs hover:bg-blue-700" onClick={() => void saveAll()} disabled={saveSection.isPending}>
                  {saveSection.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  <span>{t("config.saveAll")}</span>
                </Button>
              </>
            ) : null}
          </>
        ) : (
          <>
            {yamlDraft !== null && yamlDraft !== yaml.data?.yaml ? <span className="text-xs text-amber-500">{t("config.dirty")}</span> : null}
            <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs" onClick={() => setYamlDraft(yaml.data?.yaml ?? "")} disabled={yamlDraft === yaml.data?.yaml}>
              <RotateCcw className="size-3.5" />
              <span>{t("config.discard")}</span>
            </Button>
            <Button size="sm" className="h-8 gap-1.5 rounded-xl bg-blue-600 text-white shadow-xs text-xs hover:bg-blue-700" onClick={() => saveYaml.mutate()} disabled={yamlDraft === null || yamlDraft === yaml.data?.yaml || saveYaml.isPending}>
              {saveYaml.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              <span>{t("common.save")}</span>
            </Button>
          </>
        )}
      </PageHeader>

      {doc.isLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-blue-500" />
          <p className="mt-2 text-xs text-slate-500">{t("common.loading")}</p>
        </div>
      ) : doc.error ? (
        <p className="text-destructive py-12 text-center text-sm">{errMessage(doc.error)}</p>
      ) : (
        <Tabs value={tab} onValueChange={handleTabChange}>
          <div className="flex items-center justify-between mb-3">
            <TabsList className="rounded-xl p-1 bg-card border border-border/80 shadow-2xs">
              <TabsTrigger value="visual" className="rounded-lg text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <PanelsTopLeft className="size-3.5" />
                <span>{t("config.visual", "可视化配置")}</span>
              </TabsTrigger>
              <TabsTrigger value="yaml" className="rounded-lg text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <FileCode2 className="size-3.5" />
                <span>YAML</span>
              </TabsTrigger>
            </TabsList>

            {tab === "visual" && dirtySections.includes(activeSection) && (
              <Button
                size="sm"
                className="h-8 gap-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
                onClick={() => saveSection.mutate(activeSection)}
                disabled={saveSection.isPending}
              >
                {saveSection.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                <span>{t("common.save")}</span>
              </Button>
            )}
          </div>

          {/* Visual Mode */}
          <TabsContent value="visual" className="mt-0">
            <div className="grid grid-cols-1 gap-4 lg:gap-5 lg:grid-cols-[17rem_1fr]">
              {/* Left Navigation Pills (Horizontal scroll on < lg, vertical list on lg+) */}
              <div className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {sections.map((name) => {
                  const Icon = SECTION_ICONS[name] ?? Settings2;
                  const label = SECTION_LABELS[name] ?? name;
                  const isDirty = dirtySections.includes(name);
                  const isSelected = activeSection === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setActiveSection(name)}
                      className={cn(
                        "flex shrink-0 lg:w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-all duration-150 shadow-2xs cursor-pointer",
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                          : "bg-card/85 text-foreground/80 hover:bg-card hover:text-foreground border border-border/60",
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={cn("size-4 shrink-0", isSelected ? "text-primary-foreground" : "text-primary")} />
                        <span className="truncate">{label}</span>
                      </div>
                      {isDirty && (
                        <span className="size-2 rounded-full bg-amber-400 shrink-0" title={t("config.dirty")} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right Configuration Form */}
              <div className="card-surface p-5 min-h-[480px]">
                {activeSection && doc.data ? (
                  <ConfigSectionEditor
                    name={activeSection}
                    original={(doc.data.config[activeSection] ?? {}) as Doc}
                    draft={drafts[activeSection]}
                    onChange={(next) => setSectionDraft(activeSection, next)}
                  />
                ) : null}
              </div>
            </div>
          </TabsContent>

          {/* Raw YAML Mode */}
          <TabsContent value="yaml" className="mt-0">
            {yaml.isLoading || !yaml.data ? (
              <p className="text-muted-foreground py-12 text-center text-sm">{t("common.loading")}</p>
            ) : (
              <div className="card-surface overflow-hidden p-3">
                <CodeMirror
                  value={yamlDraft ?? yaml.data.yaml}
                  height="75vh"
                  theme={resolvedTheme === "dark" ? oneDark : githubLight}
                  extensions={[yamlLanguage()]}
                  basicSetup={{ foldGutter: true, highlightActiveLine: true, lineNumbers: true }}
                  onChange={(value) => setYamlDraft(value)}
                  className="overflow-hidden rounded-xl border border-border text-xs font-mono"
                />
                <p className="text-muted-foreground mt-2 px-1 text-xs">{t("config.yamlHint")}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Section Editor

function ConfigSectionEditor({
  name,
  original,
  draft,
  onChange,
}: {
  name: string;
  original: Doc;
  draft: Doc | undefined;
  onChange: (value: Doc) => void;
}) {
  const current = draft ?? original;
  const handled = HANDLED_PATHS[name];
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [rawText, setRawText] = useState("");

  const update = (changes: Partial<Doc>) => {
    onChange({ ...current, ...changes });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
            {SECTION_LABELS[name] ?? name}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            配置修改保存后将在网关下次热重载时即时生效。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs rounded-lg"
          onClick={() => {
            if (mode === "form") setRawText(JSON.stringify(current, null, 2));
            setMode(mode === "form" ? "raw" : "form");
          }}
        >
          {mode === "form" ? <FileCode2 className="size-3.5 mr-1" /> : <PanelsTopLeft className="size-3.5 mr-1" />}
          <span>{mode === "form" ? "JSON 专家模式" : "返回图形表单"}</span>
        </Button>
      </div>

      {mode === "raw" ? (
        <div className="space-y-2">
          <textarea
            className="h-96 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
          />
          <Button
            size="sm"
            className="h-8 rounded-xl bg-blue-600 text-white text-xs"
            onClick={() => {
              try {
                const parsed = JSON.parse(rawText) as Doc;
                onChange(parsed);
                toast.success("已应用 JSON 修改");
              } catch (e) {
                toast.error("JSON 格式错误: " + String(e));
              }
            }}
          >
            应用此 JSON 内容
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {name === "routing" ? (
            <RoutingForm current={current} update={update} />
          ) : name === "requests" ? (
            <RequestsForm current={current} update={update} />
          ) : name === "upstream" ? (
            <UpstreamForm current={current} update={update} />
          ) : name === "client" ? (
            <ClientForm current={current} update={update} />
          ) : name === "server" ? (
            <ServerForm current={current} update={update} />
          ) : name === "management" ? (
            <ManagementForm current={current} update={update} />
          ) : name === "access" ? (
            <AccessForm current={current} update={update} />
          ) : name === "models" ? (
            <ModelsForm current={current} update={update} />
          ) : name === "multimedia" ? (
            <MultimediaForm current={current} update={update} />
          ) : name === "oauth" ? (
            <OAuthForm current={current} update={update} />
          ) : (
            <GenericFields value={current} onChange={update} prefix={name} />
          )}
          {handled ? <GenericFallback current={current} update={update} hidden={handled} prefix={name} /> : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Dedicated Forms

function RoutingForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const strategy = String(current.strategy || "round-robin");
  const sessionAffinity = Boolean(current["session-affinity"]);
  const sessionAffinityTTL = String(current["session-affinity-ttl"] || "1h");
  const sessionAffinitySubagents = current["session-affinity-subagents"] !== false;
  const sessionAffinityRebindOn = String(current["session-affinity-rebind-on"] || "any");
  const forceModelPrefix = Boolean(current["force-model-prefix"]);

  const retry = (current.retry as Doc | undefined) ?? {};
  const cooldown = (current.cooldown as Doc | undefined) ?? {};

  return (
    <div className="space-y-6">
      {/* Strategy and Affinity */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">调度算法与亲和策略</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">负载均衡算法 (Strategy)</Label>
            <Select value={strategy} onValueChange={(val) => update({ strategy: val })}>
              <SelectTrigger className="h-9 rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="round-robin">Round Robin (轮询负载均衡)</SelectItem>
                <SelectItem value="weighted-round-robin">Weighted Round Robin (按权重加权轮询)</SelectItem>
                <SelectItem value="fill-first">Fill First (单凭据优先填满)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-400">选择调度凭据时的分发策略。</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">会话保持时长 (Affinity TTL)</Label>
            <Input
              className="h-9 rounded-xl text-xs font-mono"
              value={sessionAffinityTTL}
              onChange={(e) => update({ "session-affinity-ttl": e.target.value })}
              placeholder="1h"
            />
            <p className="text-[11px] text-slate-400">同一个客户端会话与特定上游凭据绑定的保留时间（如 1h, 30m）。</p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">故障重绑时机 (Affinity Rebind On)</Label>
            <Select value={sessionAffinityRebindOn} onValueChange={(val) => update({ "session-affinity-rebind-on": val })}>
              <SelectTrigger className="h-9 rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="any">Any (任何凭据错误均解除绑定并重试新凭据)</SelectItem>
                <SelectItem value="quota">Quota (仅在限额或鉴权错误时重绑，瞬态网络错误保留绑定)</SelectItem>
                <SelectItem value="never">Never (始终保持已建立会话的凭据绑定，失败时不切换凭据)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="通用会话保持 (Session Affinity)"
            hint="根据 Claude Code / Codex / Responses 会话 ID 或提示词缓存键绑定单一凭据，大幅提升缓存命中率。"
            checked={sessionAffinity}
            onCheckedChange={(checked) => update({ "session-affinity": checked })}
          />
          <SwitchRow
            label="子智能体继承父会话 (Affinity Subagents)"
            hint="Subagent 任务自动继承父会话绑定的凭据，实现全局跨轮次 Prompt Cache 复用。"
            checked={sessionAffinitySubagents}
            onCheckedChange={(checked) => update({ "session-affinity-subagents": checked })}
          />
          <SwitchRow
            label="强制模型前缀匹配 (Force Model Prefix)"
            hint="未指定前缀的模型请求仅路由给无前缀的凭据。"
            checked={forceModelPrefix}
            onCheckedChange={(checked) => update({ "force-model-prefix": checked })}
          />
        </div>
      </div>

      {/* Retries and Cooldowns */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">故障重试与冷却黑名单</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">额外重试轮次 (request-retry)</Label>
            <Input
              type="number"
              className="h-9 rounded-xl text-xs font-mono"
              value={retry["request-retry"] !== undefined ? String(retry["request-retry"]) : "3"}
              onChange={(e) => update({ retry: { ...retry, "request-retry": Number(e.target.value) } })}
            />
            <p className="text-[11px] text-slate-400">遇到 429/5xx 错误时尝试换凭据的轮次。</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">单轮最大重试凭据数 (max-retry-credentials)</Label>
            <Input
              type="number"
              min={0}
              className="h-9 rounded-xl text-xs font-mono"
              value={retry["max-retry-credentials"] !== undefined ? String(retry["max-retry-credentials"]) : "0"}
              onChange={(e) => update({ retry: { ...retry, "max-retry-credentials": Number(e.target.value) } })}
              placeholder="0 (不限制)"
            />
            <p className="text-[11px] text-slate-400">单轮故障切换最多尝试的不同凭据数量，0 表示尝试全部可用凭据。</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">最大冷却等待秒数 (max-retry-interval)</Label>
            <Input
              type="number"
              className="h-9 rounded-xl text-xs font-mono"
              value={retry["max-retry-interval"] !== undefined ? String(retry["max-retry-interval"]) : "30"}
              onChange={(e) => update({ retry: { ...retry, "max-retry-interval": Number(e.target.value) } })}
            />
            <p className="text-[11px] text-slate-400">重试轮次间允许等待的最长冷却时间（秒）。</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">瞬态错误冷却秒数 (transient-cooldown)</Label>
            <Input
              type="number"
              className="h-9 rounded-xl text-xs font-mono"
              value={cooldown["transient-error-cooldown-seconds"] !== undefined ? String(cooldown["transient-error-cooldown-seconds"]) : "0"}
              onChange={(e) => update({ cooldown: { ...cooldown, "transient-error-cooldown-seconds": Number(e.target.value) } })}
            />
            <p className="text-[11px] text-slate-400">0 为默认 60s 冷却，-1 为禁用瞬态错误冷却。</p>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="全局禁用冷却黑名单 (Disable Cooling)"
            hint="若开启，凭据遇到限流或错误后不会被暂时隔离冷却。"
            checked={Boolean(cooldown["disable-cooling"])}
            onCheckedChange={(checked) => update({ cooldown: { ...cooldown, "disable-cooling": checked } })}
          />
          <SwitchRow
            label="持久化保存冷却状态 (Save Cooldown Status)"
            hint="将冷却状态作为 .cds 文件存储，网关重启后保持凭据的冷却黑名单状态。"
            checked={Boolean(cooldown["save-cooldown-status"])}
            onCheckedChange={(checked) => update({ cooldown: { ...cooldown, "save-cooldown-status": checked } })}
          />
        </div>
      </div>
    </div>
  );
}

function RequestsForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const proxyURL = String(current["proxy-url"] || "");
  const tlsHandshakeTimeout = Number(current["tls-handshake-timeout-seconds"] || 0);
  const passthroughHeaders = Boolean(current["passthrough-headers"]);
  const nonstreamKeepalive = Number(current["nonstream-keepalive-interval"] || 0);
  const streaming = (current.streaming as Doc | undefined) ?? {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">全局上游网络代理 (Proxy URL)</Label>
          <Input
            className="h-9 rounded-xl text-xs font-mono"
            value={proxyURL}
            onChange={(e) => update({ "proxy-url": e.target.value })}
            placeholder="socks5://127.0.0.1:1080 或 http://proxy.corp:8080"
          />
          <p className="text-[11px] text-slate-400">支持 socks5://, http://, https://，留空使用系统网络直连。</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">TLS 握手超时秒数 (TLS Handshake Timeout)</Label>
          <Input
            type="number"
            className="h-9 rounded-xl text-xs font-mono"
            value={tlsHandshakeTimeout ? String(tlsHandshakeTimeout) : ""}
            onChange={(e) => update({ "tls-handshake-timeout-seconds": Number(e.target.value) })}
            placeholder="0 (禁用超时限制)"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">非流式保活空行间隔秒数</Label>
          <Input
            type="number"
            className="h-9 rounded-xl text-xs font-mono"
            value={nonstreamKeepalive ? String(nonstreamKeepalive) : ""}
            onChange={(e) => update({ "nonstream-keepalive-interval": Number(e.target.value) })}
            placeholder="0 (禁用)"
          />
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
        <SwitchRow
          label="透传上游响应头 (Passthrough Headers)"
          hint="将上游过滤后的响应头如 ratelimit 信息完整透传给下游客户端。"
          checked={passthroughHeaders}
          onCheckedChange={(checked) => update({ "passthrough-headers": checked })}
        />
      </div>

      {/* Streaming */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">流式传输与保活策略 (Streaming)</h4>
        <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">流式保活心跳间隔秒数 (keepalive-seconds)</Label>
              <Input
                type="number"
                min={0}
                className="h-9 rounded-xl font-mono text-xs"
                value={Number(streaming["keepalive-seconds"] || 0) > 0 ? String(streaming["keepalive-seconds"]) : ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const parsed = Number(raw);
                  update({
                    streaming: {
                      ...streaming,
                      "keepalive-seconds": raw === "" || Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
                    },
                  });
                }}
                placeholder="0 (禁用，推荐 15)"
              />
              <p className="text-[11px] text-slate-400">定期发送 SSE 心跳或 WebSocket Ping 的间隔秒数，0 表示禁用。</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">首字节前安全重试次数 (bootstrap-retries)</Label>
              <Input
                type="number"
                min={0}
                className="h-9 rounded-xl font-mono text-xs"
                value={Number(streaming["bootstrap-retries"] || 0) > 0 ? String(streaming["bootstrap-retries"]) : ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const parsed = Number(raw);
                  update({
                    streaming: {
                      ...streaming,
                      "bootstrap-retries": raw === "" || Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
                    },
                  });
                }}
                placeholder="0 (禁用)"
              />
              <p className="text-[11px] text-slate-400">向客户端输出任何字节前允许自动换号重试的次数，用于瞬态故障恢复。</p>
            </div>
          </div>

          <div className="border-t border-slate-200/60 pt-2 dark:border-slate-800">
            <SwitchRow
              label="首字到达前即发送心跳 (send-keepalive-before-ft)"
              hint="在 keepalive-seconds > 0 时，等待模型首个有效 Token 期间也周期性发送心跳，防止反代或客户端读超时。"
              checked={Boolean(streaming["send-keepalive-before-ft"])}
              onCheckedChange={(checked) => update({ streaming: { ...streaming, "send-keepalive-before-ft": checked } })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function UpstreamForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const codex = (current.codex as Doc | undefined) ?? {};
  const relay = (codex["websocket-relay"] as Doc | undefined) ?? {};
  const claude = (current.claude as Doc | undefined) ?? {};
  const xai = (current.xai as Doc | undefined) ?? {};

  return (
    <div className="space-y-6">
      {/* Codex Upstream */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Terminal className="size-3.5 text-blue-500" />
          <span>Codex / ChatGPT 上游调优</span>
        </h4>
        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="Codex 响应转向 (Response Steering)"
            hint="全双工 WebSocket Steering，同账号同模型维护持久连接。"
            checked={Boolean(codex["response-steering"])}
            onCheckedChange={(checked) => update({ codex: { ...codex, "response-steering": checked } })}
          />
          <SwitchRow
            label="Codex 首包缓冲换号 (Stream Bootstrap Buffering)"
            hint="在向客户端提交 HTTP 头部前缓冲 early handshake，遇限流时无缝换凭据重试。"
            checked={Boolean(codex["stream-bootstrap-buffering"])}
            onCheckedChange={(checked) => update({ codex: { ...codex, "stream-bootstrap-buffering": checked } })}
          />
          <SwitchRow
            label="模型级隔离冷却 (Model-level Cooling)"
            hint="单个模型达到额度上限时仅冷却该模型，不影响该凭据上的其他模型。"
            checked={Boolean(codex["model-level-cooling"])}
            onCheckedChange={(checked) => update({ codex: { ...codex, "model-level-cooling": checked } })}
          />
          <SwitchRow
            label="孤立委托输出兼容 (Orphan Delegation Compatibility)"
            hint="兼容缺少父级上下文的 Codex 委托输出。"
            checked={Boolean(codex["orphan-delegation-compatibility"])}
            onCheckedChange={(checked) => update({ codex: { ...codex, "orphan-delegation-compatibility": checked } })}
          />
          <SwitchRow
            label="WebSocket 帧压缩 (WebSocket Compression)"
            hint="对上下游 Codex WebSocket 启用 permessage-deflate 压缩；默认开启。"
            checked={codex["websocket-compression"] !== false}
            onCheckedChange={(checked) => update({ codex: { ...codex, "websocket-compression": checked } })}
          />
          <SwitchRow
            label="上游请求体 zstd 压缩 (Upstream Request Compression)"
            hint="对发往 ChatGPT Codex 后端的 HTTP 请求体启用 zstd 压缩，减少大上下文上传延迟与带宽。"
            checked={Boolean(codex["upstream-request-compression"])}
            onCheckedChange={(checked) => update({ codex: { ...codex, "upstream-request-compression": checked } })}
          />
          <div className="grid grid-cols-1 gap-4 border-t border-slate-200/60 pt-3 sm:grid-cols-2 dark:border-slate-800">
            <div className="space-y-1.5">
              <Label className="text-xs">首包缓冲超时上限 (stream-bootstrap-timeout)</Label>
              <Input
                className="h-8 rounded-xl font-mono text-xs"
                value={String(codex["stream-bootstrap-timeout"] ?? "")}
                placeholder="0 (不限时，如 20s)"
                onChange={(e) => {
                  const next = { ...codex };
                  if (e.target.value === "") delete next["stream-bootstrap-timeout"];
                  else next["stream-bootstrap-timeout"] = e.target.value;
                  update({ codex: next });
                }}
              />
              <p className="text-[11px] text-slate-400">首包缓冲的最长等待时间（如 20s），超时后立即释放响应头避免反代超时。</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">请求体压缩最小字节数 (compression-min-bytes)</Label>
              <Input
                type="number"
                min={0}
                className="h-8 rounded-xl font-mono text-xs"
                value={
                  typeof codex["upstream-request-compression-min-bytes"] === "number" &&
                  codex["upstream-request-compression-min-bytes"] > 0
                    ? String(codex["upstream-request-compression-min-bytes"])
                    : ""
                }
                placeholder="1024"
                onChange={(e) => {
                  const next = { ...codex };
                  const raw = e.target.value.trim();
                  const parsed = Number(raw);
                  if (raw === "" || Number.isNaN(parsed) || parsed <= 0) {
                    delete next["upstream-request-compression-min-bytes"];
                  } else {
                    next["upstream-request-compression-min-bytes"] = parsed;
                  }
                  update({ codex: next });
                }}
              />
              <p className="text-[11px] text-slate-400">达到该大小才启用上游请求体 zstd 压缩；留空或 ≤0 默认 1024。</p>
            </div>
          </div>
          <CodexClientIdentity codex={codex} onChange={(next) => update({ codex: next })} />
          <FieldGroup className="pt-3">
            <Field>
              <FieldLabel htmlFor="codex-relay-ttl">WebSocket 转发空闲保留时间</FieldLabel>
              <Input
                id="codex-relay-ttl"
                value={String(relay["idle-ttl"] ?? "")}
                placeholder="5m"
                onChange={(event) => update({ codex: { ...codex, "websocket-relay": { ...relay, "idle-ttl": event.target.value } } })}
              />
              <FieldDescription>默认 5m，从请求结束起计算；支持 30s、5m、1h。0 关闭跨请求复用，仍使用 WS 转发。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="codex-relay-memory">WebSocket 转发缓存内存预算</FieldLabel>
              <Input
                id="codex-relay-memory"
                value={String(relay["max-memory"] ?? "")}
                placeholder="128MiB"
                onChange={(event) => update({ codex: { ...codex, "websocket-relay": { ...relay, "max-memory": event.target.value } } })}
              />
              <FieldDescription>所有第三方 Codex 共用，默认 128MiB（也可写 128m）。按连接开销预留和状态容量计费，超额回收最久未使用的空闲连接。0 关闭缓存；不限制活动请求或整个进程内存。</FieldDescription>
            </Field>
          </FieldGroup>
        </div>
      </div>

      {/* Claude Upstream */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Feather className="size-3.5 text-amber-500" />
          <span>Claude / Anthropic 上游调优</span>
        </h4>
        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="原生工具搜索 (Native Tool Search)"
            hint="在 Claude Responses 路径启用原生工具延迟加载 (defer_loading)，保持缓存前缀稳定。"
            checked={Boolean(claude["tool-search"])}
            onCheckedChange={(checked) => update({ claude: { ...claude, "tool-search": checked } })}
          />
          <SwitchRow
            label="模型级隔离冷却 (Model-level Cooling)"
            hint="特定 Claude 模型遭遇冷却时不影响同一账户下其他模型。"
            checked={Boolean(claude["model-level-cooling"])}
            onCheckedChange={(checked) => update({ claude: { ...claude, "model-level-cooling": checked } })}
          />
          <SwitchRow
            label="停用 Claude 客户端伪装 (Disable Claude Cloak Mode)"
            hint="原始提示词透传，不替换 Claude Code 预置 system prompt。"
            checked={Boolean(claude["disable-claude-cloak-mode"])}
            onCheckedChange={(checked) => update({ claude: { ...claude, "disable-claude-cloak-mode": checked } })}
          />
          <SwitchRow
            label="停用模型列表 ID 伪装 (Disable Cloaking Model List)"
            hint="在 Anthropic 模型列表响应中关闭模型 ID 伪装。"
            checked={Boolean(claude["disable-cloaking-model-list"])}
            onCheckedChange={(checked) => update({ claude: { ...claude, "disable-cloaking-model-list": checked } })}
          />
          <SwitchRow
            label="服务端拒答模型回退 (Server-side Fallback)"
            hint="为伪装的 Claude 请求自动注入 Anthropic 服务端拒答跨模型回退列表。"
            checked={Boolean(claude["server-side-fallback"])}
            onCheckedChange={(checked) => update({ claude: { ...claude, "server-side-fallback": checked } })}
          />
          <div className="space-y-1.5 border-t border-slate-200/60 pt-3 dark:border-slate-800">
            <Label className="text-xs">会话日期固定保留天数 (session-date-pin-days)</Label>
            <Input
              type="number"
              min={0}
              className="h-8 rounded-xl font-mono text-xs sm:w-56"
              value={typeof claude["session-date-pin-days"] === "number" ? String(claude["session-date-pin-days"]) : ""}
              placeholder="7 (留空默认 7 天，0 为 1 小时)"
              onChange={(e) => {
                const next = { ...claude };
                const raw = e.target.value.trim();
                if (raw === "") {
                  delete next["session-date-pin-days"];
                } else {
                  const parsed = Number(raw);
                  if (!Number.isNaN(parsed) && parsed >= 0) {
                    next["session-date-pin-days"] = parsed;
                  }
                }
                update({ claude: next });
              }}
            />
            <p className="text-[11px] text-slate-400">
              纯内存模式下固定伪装 currentDate 的天数；留空默认 7 天，显式填 0 仅保留 1 小时；启用本地 KV 或 Home KV 时永久持久化。
            </p>
          </div>
          <div className="pt-2">
            <ClaudeHeaderDefaultsEditor claude={claude} onChange={(nextClaude) => update({ claude: nextClaude })} />
          </div>
        </div>
      </div>

      {/* xAI Upstream */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Zap className="size-3.5 text-purple-500" />
          <span>xAI / Grok 调优</span>
        </h4>
        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="自动注入 x_search 原生联网工具 (Inject x_search)"
            hint="当请求未声明联网搜索时，自动附加 xAI 原生联网搜索工具。"
            checked={Boolean(xai["inject-x-search"])}
            onCheckedChange={(checked) => update({ xai: { ...xai, "inject-x-search": checked } })}
          />
        </div>
      </div>
    </div>
  );
}

function ClientForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const codex = (current.codex as Doc | undefined) ?? {};
  const webSearchCache = (codex["web-search-result-cache"] as Doc | undefined) ?? {};
  const claude = (current.claude as Doc | undefined) ?? {};

  const updateWebSearchCache = (changes: Partial<Doc>) => {
    update({
      codex: {
        ...codex,
        "web-search-result-cache": { ...webSearchCache, ...changes },
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Terminal className="size-3.5 text-blue-500" />
          <span>Codex 客户端兼容</span>
        </h4>
        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="启用 apply_patch 补丁兼容声明"
            hint="让所有路由执行器所桥接的模型在客户端模型能力声明中广播 freeform 补丁能力。"
            checked={Boolean(codex["enable-apply-patch"])}
            onCheckedChange={(checked) => update({ codex: { ...codex, "enable-apply-patch": checked } })}
          />
          <SwitchRow
            label="多智能体 v2 优化 (Optimize Multi-Agent v2)"
            hint="为 Codex Desktop 和 codex-tui 优化 spawn_agent 交互，自动规范消息参数与格式转换。"
            checked={Boolean(codex["optimize-multi-agent-v2"])}
            onCheckedChange={(checked) => update({ codex: { ...codex, "optimize-multi-agent-v2": checked } })}
          />
          <SwitchRow
            label="联网搜索结果会话缓存 (Web Search Result Cache)"
            hint="在同一会话中缓存搜索结果，在重放对话历史时复用结果节省 Token。"
            checked={Boolean(webSearchCache.enabled)}
            onCheckedChange={(checked) => updateWebSearchCache({ enabled: checked })}
          />
          <div className="grid grid-cols-1 gap-4 border-t border-slate-200/60 pt-3 sm:grid-cols-2 dark:border-slate-800">
            <div className="space-y-1.5">
              <Label className="text-xs">搜索结果缓存 TTL (ttl)</Label>
              <Input
                className="h-8 rounded-xl font-mono text-xs"
                value={String(webSearchCache.ttl ?? "")}
                placeholder="24h"
                onChange={(e) => updateWebSearchCache({ ttl: e.target.value })}
              />
              <p className="text-[11px] text-slate-400">支持时长字符串（如 30m、24h）或纯秒数，留空默认 24h。</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">搜索结果缓存上限 (limit)</Label>
              <Input
                type="number"
                min={0}
                className="h-8 rounded-xl font-mono text-xs"
                value={Number(webSearchCache.limit || 0) > 0 ? String(webSearchCache.limit) : ""}
                placeholder="1024"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const parsed = Number(raw);
                  updateWebSearchCache({ limit: raw === "" || Number.isNaN(parsed) ? 0 : Math.max(0, parsed) });
                }}
              />
              <p className="text-[11px] text-slate-400">缓存保留的最大条目数，留空或 0 默认 1024。</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Feather className="size-3.5 text-amber-500" />
          <span>Claude 客户端兼容</span>
        </h4>
        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="显示 Codex 进度旁白 (show-codex-commentary)"
            hint="将 Codex 上游的公开进度/旁白镜像为 Claude 客户端可见的文本内容；默认关闭。"
            checked={Boolean(claude["show-codex-commentary"])}
            onCheckedChange={(checked) => update({ claude: { ...claude, "show-codex-commentary": checked } })}
          />
        </div>
      </div>
    </div>
  );
}

function ServerForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const host = String(current.host || "");
  const port = Number(current.port || 8317);
  const maxRequestBodyBytes = Number(current["max-request-body-bytes"] || 0);
  const shutdownTimeout = Number(current["shutdown-timeout"] || 0);
  const commercialMode = Boolean(current["commercial-mode"]);
  const githubToken = String(current["github-token"] || "");
  const discovery = (current.discovery as Doc | undefined) ?? {};
  const rc = (current["response-compression"] as Doc | undefined) ?? {};
  const kvStore = (current["kv-store"] as Doc | undefined) ?? {};
  const tls = (current.tls as Doc | undefined) ?? {};
  const trustedProxies = Array.isArray(current["trusted-proxies"]) ? (current["trusted-proxies"] as string[]) : [];

  const updateKVStore = (changes: Partial<Doc>) => {
    const merged: Doc = { ...kvStore, ...changes };
    if (merged.path === "") delete merged.path;
    update({ "kv-store": merged });
  };

  const updateTLS = (changes: Partial<Doc>) => {
    update({ tls: { ...tls, ...changes } });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">监听地址 (Host)</Label>
          <Input
            className="h-9 rounded-xl text-xs font-mono"
            value={host}
            onChange={(e) => update({ host: e.target.value })}
            placeholder="留空监听全部网卡 (0.0.0.0)"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">监听端口 (Port)</Label>
          <Input
            type="number"
            className="h-9 rounded-xl text-xs font-mono"
            value={port ? String(port) : ""}
            onChange={(e) => update({ port: Number(e.target.value) })}
            placeholder="8317"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">最大请求体字节 (Max Request Body Bytes)</Label>
          <Input
            type="number"
            className="h-9 rounded-xl text-xs font-mono"
            value={maxRequestBodyBytes ? String(maxRequestBodyBytes) : ""}
            onChange={(e) => update({ "max-request-body-bytes": Number(e.target.value) })}
            placeholder="0 (不限制)"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">优雅停机等待秒数 (shutdown-timeout)</Label>
          <Input
            type="number"
            min={0}
            className="h-9 rounded-xl text-xs font-mono"
            value={shutdownTimeout > 0 ? String(shutdownTimeout) : ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const parsed = Number(raw);
              update({ "shutdown-timeout": raw === "" || Number.isNaN(parsed) ? 0 : Math.max(0, parsed) });
            }}
            placeholder="0 (立即关闭)"
          />
          <p className="text-[11px] text-slate-400">服务停止时等待在途请求完成的最长秒数，0 表示不等待立即关闭。</p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">GitHub Token (发布检查与下载)</Label>
          <Input
            type="password"
            className="h-9 rounded-xl text-xs font-mono"
            value={githubToken}
            onChange={(e) => update({ "github-token": e.target.value })}
            placeholder="ghp_..."
          />
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
        <SwitchRow
          label="商用轻量模式 (Commercial Mode)"
          hint="在高并发场景下停用内存消耗较大的中间件以提升极端吞吐表现。"
          checked={commercialMode}
          onCheckedChange={(checked) => update({ "commercial-mode": checked })}
        />
        <SwitchRow
          label="局域网 mDNS 服务发现 (mDNS Discovery)"
          hint="在局域网内广播 _ai-gateway._tcp 服务，方便客户端工具自动定位。"
          checked={Boolean(discovery.enabled)}
          onCheckedChange={(checked) => update({ discovery: { ...discovery, enabled: checked } })}
        />
      </div>

      {/* Response Compression & Local KV Store */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="下游响应压缩 (Response Compression)"
            hint="对非流式下游 HTTP 响应启用内容协商压缩；默认开启。"
            checked={rc.enabled !== false}
            onCheckedChange={(checked) => update({ "response-compression": { ...rc, enabled: checked } })}
          />
          <div className="space-y-1">
            <Label className="text-xs">压缩最小字节数 (min-bytes)</Label>
            <Input
              type="number"
              min={0}
              className="h-8 rounded-xl font-mono text-xs"
              value={Number(rc["min-bytes"] || 0) > 0 ? String(rc["min-bytes"]) : ""}
              placeholder="1024"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const parsed = Number(raw);
                update({
                  "response-compression": {
                    ...rc,
                    "min-bytes": raw === "" || Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
                  },
                });
              }}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <SwitchRow
            label="禁用本地 KV 持久化 (kv-store.disabled)"
            hint="关闭本地 bbolt 数据库并回退为纯内存模式（默认不禁用）。"
            checked={Boolean(kvStore.disabled)}
            onCheckedChange={(checked) => updateKVStore({ disabled: checked })}
          />
          <div className="space-y-1">
            <Label className="text-xs">KV 数据库路径 (kv-store.path)</Label>
            <Input
              className="h-8 rounded-xl font-mono text-xs"
              value={String(kvStore.path ?? "")}
              placeholder="<auth-dir>/kv.db"
              onChange={(e) => updateKVStore({ path: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Trusted Proxies */}
      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
        <StringListChipsInput
          label="可信代理列表 (trusted-proxies)"
          hint="允许提供 X-Forwarded-* 客户端 IP 请求头的代理 IP 或 CIDR（逗号或回车添加；修改后需重启服务）。"
          values={trustedProxies}
          placeholder="如 127.0.0.1, 10.0.0.0/8"
          onChange={(next) => update({ "trusted-proxies": next ?? [] })}
        />
      </div>

      {/* TLS */}
      <CollapsibleGroup
        label="HTTPS / TLS 证书配置 (tls)"
        hint={tls.enable ? "当前已启用 HTTPS 监听。" : "配置证书与私钥以启用服务端 HTTPS 监听。"}
        defaultOpen={Boolean(tls.enable)}
      >
        <div className="space-y-3">
          <SwitchRow
            label="启用 HTTPS / TLS (tls.enable)"
            hint="开启后服务端将使用下方 PEM 证书和私钥监听 HTTPS。"
            checked={Boolean(tls.enable)}
            onCheckedChange={(checked) => updateTLS({ enable: checked })}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">证书文件路径 (tls.cert)</Label>
              <Input
                className="h-8 rounded-xl font-mono text-xs"
                value={String(tls.cert ?? "")}
                placeholder="/path/to/cert.pem"
                onChange={(e) => updateTLS({ cert: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">私钥文件路径 (tls.key)</Label>
              <Input
                className="h-8 rounded-xl font-mono text-xs"
                value={String(tls.key ?? "")}
                placeholder="/path/to/key.pem"
                onChange={(e) => updateTLS({ key: e.target.value })}
              />
            </div>
          </div>
        </div>
      </CollapsibleGroup>
    </div>
  );
}

function ManagementForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const allowRemote = Boolean(current["allow-remote"]);
  const secretKey = String(current["secret-key"] || "");
  const disableControlPanel = Boolean(current["disable-control-panel"]);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label className="text-xs">管理端通信密钥 (Secret Key)</Label>
        <Input
          type="password"
          className="h-9 rounded-xl text-xs font-mono"
          value={secretKey}
          onChange={(e) => update({ "secret-key": e.target.value })}
          placeholder="留空即禁用管理 API；启动时自动哈希"
        />
        <p className="text-[11px] text-slate-400">所有访问 /v8/management 路由的请求均需要此密钥授权。</p>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
        <SwitchRow
          label="允许远程管理访问 (Allow Remote)"
          hint="开启后允许非 localhost 机器通过密码访问管理界面与接口。"
          checked={allowRemote}
          onCheckedChange={(checked) => update({ "allow-remote": checked })}
        />
        <SwitchRow
          label="关闭内置管理面板网页 (Disable Control Panel)"
          hint="开启后禁用内置静态面板，仅保留纯接口功能。"
          checked={disableControlPanel}
          onCheckedChange={(checked) => update({ "disable-control-panel": checked })}
        />
      </div>
    </div>
  );
}

function AccessForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const keys = Array.isArray(current["api-keys"]) ? (current["api-keys"] as string[]) : [];

  const setKeys = (next: string[]) => {
    update({ "api-keys": next });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">客户端访问 API Keys 列表</h4>
          <p className="text-[11px] text-slate-400">下游客户端调用 /v1/chat/completions 等代理接口时使用的身份凭据。</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs rounded-lg gap-1"
          onClick={() => setKeys([...keys, "sk-" + Math.random().toString(36).slice(2, 12)])}
        >
          <Plus className="size-3.5" />
          <span>添加 API Key</span>
        </Button>
      </div>

      {keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-800">
          未配置客户端访问密钥（允许任意客户端免密调用代理）
        </p>
      ) : (
        <div className="space-y-1.5">
          {keys.map((key, index) => (
            <div key={index} className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/70">
              <span className="text-slate-400 font-mono text-xs w-6 text-center">{index + 1}</span>
              <Input
                className="h-8 flex-1 font-mono text-xs rounded-lg bg-white dark:bg-slate-950"
                value={key}
                onChange={(e) => {
                  const next = [...keys];
                  next[index] = e.target.value;
                  setKeys(next);
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-rose-500 hover:text-rose-600 rounded-lg"
                onClick={() => setKeys(keys.filter((_, i) => i !== index))}
                title="删除"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelsForm({ current, update }: { current: Doc; update: (changes: Partial<Doc>) => void }) {
  const catalog = String(current.catalog || "");
  const codexCatalog = String(current["codex-catalog"] || "");
  const devinCatalog = String(current["devin-catalog"] || "");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">通用模型目录源 URL 或本地路径</Label>
        <Input
          className="h-9 rounded-xl text-xs font-mono"
          value={catalog}
          onChange={(e) => update({ catalog: e.target.value })}
          placeholder="https://... 或 /path/to/catalog.json"
        />
        <p className="text-[11px] text-slate-400">留空则自动使用官方远程源或内置目录，每 3 小时自动刷新。</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Codex 专属目录源</Label>
        <Input
          className="h-9 rounded-xl text-xs font-mono"
          value={codexCatalog}
          onChange={(e) => update({ "codex-catalog": e.target.value })}
          placeholder="https://... 或 /path/to/codex-catalog.json"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Devin 目录源</Label>
        <Input
          className="h-9 rounded-xl text-xs font-mono"
          value={devinCatalog}
          onChange={(e) => update({ "devin-catalog": e.target.value })}
          placeholder="https://... 或 /path/to/devin-catalog.json"
        />
      </div>
    </div>
  );
}

type GenericFieldsProps = {
  value: Doc;
  onChange: (next: Doc) => void;
  hidden?: string[];
  prefix?: string;
  depth?: number;
};

type GenericFieldProps = {
  label: string;
  path: string;
  value: unknown;
  hidden: string[];
  onChange: (next: unknown) => void;
  depth: number;
};

function isDoc(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasVisibleEntries(value: Doc, hidden: string[], prefix = ""): boolean {
  return Object.entries(value).some(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (hidden.includes(path)) return false;
    return isDoc(child) ? hasVisibleEntries(child, hidden, path) : true;
  });
}

function GenericFallback({
  current,
  update,
  hidden,
  prefix,
}: {
  current: Doc;
  update: (changes: Partial<Doc>) => void;
  hidden: string[];
  prefix: string;
}) {
  const visibleHidden = hidden.map((path) => `${prefix}.${path}`);
  if (!hasVisibleEntries(current, visibleHidden, prefix)) return null;
  return (
    <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">其他配置项</h4>
        <p className="mt-1 text-[11px] text-slate-400">
          以上表单未覆盖的字段会在这里自动展示，支持嵌套对象与数组。
        </p>
      </div>
      <GenericFields value={current} onChange={update} hidden={visibleHidden} prefix={prefix} />
    </div>
  );
}

function GenericFields({ value, onChange, hidden = [], prefix = "", depth = 0 }: GenericFieldsProps) {
  return (
    <div className="space-y-2.5">
      {Object.entries(value).map(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (hidden.includes(path)) return null;
        if (isDoc(child) && !hasVisibleEntries(child, hidden, path)) return null;
        return (
          <GenericField
            key={path}
            label={key}
            path={path}
            value={child}
            hidden={hidden}
            depth={depth}
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        );
      })}
    </div>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50/60 sm:flex-row sm:items-start sm:justify-between dark:hover:bg-slate-900/40">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</p>
        {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{hint}</p> : null}
      </div>
      <div className="w-full shrink-0 sm:w-auto">{children}</div>
    </div>
  );
}

function CollapsibleGroup({
  label,
  hint,
  defaultOpen,
  children,
}: {
  label: string;
  hint?: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/30 dark:border-slate-800 dark:bg-slate-950/30">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</p>
          {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{hint}</p> : null}
        </div>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-slate-400 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">{children}</div>
        </div>
      </div>
    </div>
  );
}

function GenericField({ label, path, value, hidden, onChange, depth }: GenericFieldProps) {
  const meta = FIELD_META[path] ?? { label };

  if (typeof value === "boolean") {
    return (
      <FieldRow label={meta.label} hint={meta.hint}>
        <Switch checked={value} onCheckedChange={onChange} />
      </FieldRow>
    );
  }

  if (typeof value === "number") {
    return (
      <FieldRow label={meta.label} hint={meta.hint}>
        <NumberInput value={value} onChange={onChange} />
      </FieldRow>
    );
  }

  if (typeof value === "string" || value === null) {
    const secret = /(?:secret|token|password|api[-_]?key)/i.test(path);
    const long = typeof value === "string" && (value.length > 80 || value.includes("\n"));

    if (long) {
      return (
        <div className="px-3 py-2.5">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{meta.label}</p>
          {meta.hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{meta.hint}</p> : null}
          <textarea
            className="mt-2 h-24 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-xs dark:border-slate-800 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        </div>
      );
    }

    return (
      <FieldRow label={meta.label} hint={meta.hint}>
        <Input
          type={secret ? "password" : "text"}
          className="h-8 w-full rounded-lg font-mono text-xs sm:w-64"
          value={value ?? ""}
          placeholder={value === null ? "null" : undefined}
          onChange={(e) => onChange(value === null && e.target.value === "" ? null : e.target.value)}
        />
      </FieldRow>
    );
  }

  if (Array.isArray(value)) {
    return (
      <GenericArray
        label={meta.label}
        hint={meta.hint}
        path={path}
        value={value}
        hidden={hidden}
        depth={depth}
        onChange={onChange}
      />
    );
  }

  if (isDoc(value)) {
    return (
      <CollapsibleGroup label={meta.label} hint={meta.hint} defaultOpen={depth === 0}>
        <GenericFields value={value} onChange={onChange} hidden={hidden} prefix={path} depth={depth + 1} />
      </CollapsibleGroup>
    );
  }

  return null;
}

function GenericArray({
  label,
  hint,
  path,
  value,
  hidden,
  onChange,
  depth,
}: {
  label: string;
  hint?: string;
  path: string;
  value: unknown[];
  hidden: string[];
  onChange: (next: unknown[]) => void;
  depth: number;
}) {
  const addItem = () => onChange([...value, defaultValueFor(value[0])]);

  return (
    <div className="rounded-xl border border-slate-200/70 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</p>
          {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{hint}</p> : null}
          <p className="mt-0.5 text-[10px] text-slate-400">{value.length} 项</p>
        </div>
        <Button variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={addItem}>
          <Plus className="mr-1 size-3.5" />
          添加
        </Button>
      </div>

      <div className="divide-y divide-slate-100 border-t border-slate-200/70 dark:divide-slate-800/70 dark:border-slate-800">
        {value.map((item, index) => {
          const itemPath = `${path}.${index}`;
          if (hidden.includes(itemPath)) return null;
          const setItem = (next: unknown) => {
            const copy = [...value];
            copy[index] = next;
            onChange(copy);
          };
          const primitive = item === null || typeof item !== "object";

          return (
            <div key={itemPath} className="flex items-start gap-2 px-3 py-2">
              {primitive ? (
                <>
                  <span className="mt-2 w-5 shrink-0 text-center font-mono text-[10px] text-slate-400">{index}</span>
                  <div className="min-w-0 flex-1">
                    {typeof item === "boolean" ? (
                      <div className="flex justify-end">
                        <Switch checked={item} onCheckedChange={setItem} />
                      </div>
                    ) : typeof item === "number" ? (
                      <NumberInput value={item} onChange={setItem} />
                    ) : (
                      <Input
                        className="h-8 w-full rounded-lg font-mono text-xs"
                        value={item == null ? "" : String(item)}
                        placeholder={item === null ? "null" : undefined}
                        onChange={(e) => setItem(item === null && e.target.value === "" ? null : e.target.value)}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="min-w-0 flex-1">
                  <GenericField
                    label={`[${index}]`}
                    path={itemPath}
                    value={item}
                    hidden={hidden}
                    depth={depth + 1}
                    onChange={setItem}
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-lg text-rose-500 hover:text-rose-600"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                title="删除"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
        {value.length === 0 ? <p className="px-3 py-3 text-[11px] text-slate-400">空数组</p> : null}
      </div>
    </div>
  );
}

function defaultValueFor(value: unknown): unknown {
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return 0;
  if (typeof value === "string") return "";
  if (Array.isArray(value)) return [];
  if (isDoc(value)) return {};
  return "";
}

function NumberInput({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <Input
      type="number"
      className="h-8 w-40 rounded-lg font-mono text-xs"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = Number(text);
        if (text.trim() !== "" && Number.isFinite(next)) onChange(next);
        else setText(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function SwitchRow({
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
        {hint && <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
