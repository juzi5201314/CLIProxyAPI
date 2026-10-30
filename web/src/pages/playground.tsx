import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Cpu,
  Eraser,
  Gauge,
  ImagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Sliders,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ALL_KINDS, type Entry } from "@/components/providers/provider-tools";
import { MarkdownViewer } from "@/components/shared/markdown-viewer";
import { credentials, providerLists } from "@/api/management";
import type { AuthFileEntry } from "@/api/types";
import { currentKey } from "@/stores/auth";
import { dayjs, formatDuration, formatTPS } from "@/lib/format";
import {
  CustomParamsSection,
  type CustomHeader,
  type VisualFieldNode,
  customFieldsToBody,
  customHeadersToRecord,
} from "@/components/playground/custom-params-editor";
import { ContextProberModal } from "@/components/playground/context-prober-modal";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------- Types

export interface MessageMetrics {
  latencyMs?: number;
  ttftMs?: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  tps?: number;
  statusCode?: number;
}

export interface PlaygroundMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  reasoningContent?: string;
  timestamp: number;
  model?: string;
  metrics?: MessageMetrics;
  error?: string;
  rawRequest?: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  rawResponse?: unknown;
}

interface PlaygroundSession {
  id: string;
  title: string;
  model: string;
  protocol?: ApiProtocol;
  createdAt: number;
  messages: PlaygroundMessage[];
}

interface ModelItem {
  id: string;
  provider: string;
}

// ----------------------------------------------------------- Protocols & Inference

export type ApiProtocol = "openai" | "claude" | "codex" | "gemini";

interface ProtocolMeta {
  id: ApiProtocol;
  label: string;
  badge: string;
  endpointTemplate: string;
  desc: string;
}

const PROTOCOL_OPTIONS: ProtocolMeta[] = [
  {
    id: "openai",
    label: "OpenAI 兼容",
    badge: "OpenAI",
    endpointTemplate: "/v1/chat/completions",
    desc: "OpenAI Chat Completions 协议 (/v1/chat/completions)",
  },
  {
    id: "claude",
    label: "Claude 原生",
    badge: "Claude",
    endpointTemplate: "/v1/messages",
    desc: "Anthropic Claude Messages 协议 (/v1/messages)",
  },
  {
    id: "codex",
    label: "Codex 原生",
    badge: "Codex",
    endpointTemplate: "/v1/responses",
    desc: "OpenAI Responses / Codex 协议 (/v1/responses)",
  },
  {
    id: "gemini",
    label: "Gemini 原生",
    badge: "Gemini",
    endpointTemplate: "/v1beta/models/{model}",
    desc: "Google Gemini 协议 (/v1beta/models/...)",
  },
];

export type ReasoningEffortLevel = "off" | "low" | "medium" | "high" | "xhigh" | "max";

interface ReasoningOption {
  id: ReasoningEffortLevel;
  label: string;
  desc: string;
}

const REASONING_EFFORT_OPTIONS: ReasoningOption[] = [
  { id: "off", label: "off (不发送)", desc: "不传递思考参数，使用模型默认行为" },
  { id: "low", label: "low", desc: "轻量思考，更快速响应" },
  { id: "medium", label: "medium", desc: "标准思考，平衡推理质量与延时" },
  { id: "high", label: "high", desc: "高强度思考，完整深度推理链路" },
  { id: "xhigh", label: "xhigh", desc: "极高深度思考 (OpenAI o-series 等)" },
  { id: "max", label: "max", desc: "最大推理深度 (Claude 4.6 / Adaptive 等)" },
];

function getReasoningInjectionPreview(protocol: ApiProtocol, effort: ReasoningEffortLevel): string {
  if (effort === "off") {
    return "未启用，不传递思考等级参数";
  }
  switch (protocol) {
    case "openai":
      return `"reasoning_effort": "${effort}"`;
    case "codex":
      return `"reasoning": { "effort": "${effort}" }`;
    case "claude":
      return `"thinking": { "type": "adaptive" }, "output_config": { "effort": "${effort}" }`;
    case "gemini":
      return `"generationConfig": { "thinkingConfig": { "thinkingLevel": "${effort}" } }`;
    default:
      return `"reasoning_effort": "${effort}"`;
  }
}

interface InferredResult {
  protocol: ApiProtocol;
  reason: string;
}

/**
 * Maps a CPA provider kind (from config.yaml / API lists) to its native upstream API protocol.
 */
function providerKindToProtocol(kind: string): { protocol: ApiProtocol; label: string } {
  const k = (kind || "").toLowerCase();
  if (k.includes("claude") || k.includes("anthropic")) {
    return { protocol: "claude", label: "Claude 原生" };
  }
  if (k.includes("codex")) {
    return { protocol: "codex", label: "Codex 原生" };
  }
  if (k.includes("gemini") || k.includes("vertex") || k.includes("interaction") || k.includes("aistudio") || k.includes("antigravity")) {
    return { protocol: "gemini", label: "Gemini 原生" };
  }
  return { protocol: "openai", label: "OpenAI 兼容" };
}

/**
 * Maps a CPA auth/credential type (e.g. OAuth / token files) to its native upstream API protocol.
 * In CPA, providers like Kimi, xAI/Grok, and Meta OAuth natively use OpenAI-compatible completions.
 */
function authTypeToProtocol(type: string, provider?: string): { protocol: ApiProtocol; label: string } {
  const t = (type || "").toLowerCase();
  const p = (provider || "").toLowerCase();
  const combined = `${t} ${p}`;

  if (combined.includes("kimi") || combined.includes("xai") || combined.includes("grok") || combined.includes("meta") || combined.includes("devin")) {
    return { protocol: "openai", label: "OpenAI 兼容" };
  }
  if (combined.includes("claude") || combined.includes("anthropic")) {
    return { protocol: "claude", label: "Claude 原生" };
  }
  if (combined.includes("codex") || combined.includes("chatgpt")) {
    return { protocol: "codex", label: "Codex 原生" };
  }
  if (combined.includes("gemini") || combined.includes("google") || combined.includes("vertex") || combined.includes("antigravity") || combined.includes("aistudio")) {
    return { protocol: "gemini", label: "Gemini 原生" };
  }
  return { protocol: "openai", label: "OpenAI 兼容" };
}

function inferProtocol(
  model: string,
  providerData?: Record<string, Entry[]>,
  credentialsList?: AuthFileEntry[],
  modelOptions?: ModelItem[],
): InferredResult {
  const targetId = (model || "").trim().toLowerCase();
  if (!targetId) {
    return { protocol: "openai", reason: "默认 OpenAI 兼容协议 (/v1/chat/completions)" };
  }

  // 1. Direct match on configured providers (config.yaml)
  // Treat the entire model string as a whole ID, matching against any published ID of the provider.
  if (providerData) {
    for (const [kind, entries] of Object.entries(providerData)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const entryPrefix = typeof entry.prefix === "string" ? entry.prefix.trim() : "";
        const entryName = String(entry.name || entryPrefix || kind);
        const rawModels = Array.isArray(entry.models) ? entry.models : [];

        for (const m of rawModels) {
          const names: string[] = [];
          if (typeof m === "string" && m.trim()) {
            names.push(m.trim());
            if (entryPrefix) names.push(`${entryPrefix}/${m.trim()}`);
          } else if (m && typeof m === "object") {
            const rec = m as Record<string, unknown>;
            for (const key of ["alias", "name", "id", "model"]) {
              const val = typeof rec[key] === "string" ? (rec[key] as string).trim() : "";
              if (val) {
                names.push(val);
                if (entryPrefix) names.push(`${entryPrefix}/${val}`);
              }
            }
          }

          if (names.some((n) => n.toLowerCase() === targetId)) {
            const meta = providerKindToProtocol(kind);
            return { protocol: meta.protocol, reason: `匹配供应商 "${entryName}" (${meta.label})` };
          }
        }
      }
    }
  }

  // 2. Direct match on credentials / OAuth subscription files
  if (credentialsList && credentialsList.length > 0) {
    for (const file of credentialsList) {
      const filePrefix = typeof file.prefix === "string" ? file.prefix.trim() : "";
      const rawModels = Array.isArray(file.models) ? file.models : [];
      const names: string[] = [];

      for (const m of rawModels) {
        if (typeof m === "string" && m.trim()) {
          names.push(m.trim());
          if (filePrefix) names.push(`${filePrefix}/${m.trim()}`);
        } else if (m && typeof m === "object") {
          const rec = m as Record<string, unknown>;
          const val = String(rec.id || rec.name || "").trim();
          if (val) {
            names.push(val);
            if (filePrefix) names.push(`${filePrefix}/${val}`);
          }
        }
      }

      if (names.some((n) => n.toLowerCase() === targetId)) {
        const meta = authTypeToProtocol(file.type || "", file.provider || "");
        return { protocol: meta.protocol, reason: `匹配授权凭据 "${file.name}" (${meta.label})` };
      }
    }
  }

  // 3. Match from known model registry entries (modelOptions)
  if (modelOptions) {
    const found = modelOptions.find((m) => m.id.toLowerCase() === targetId);
    if (found) {
      const p = found.provider.toLowerCase();
      if (p.includes("anthropic") || p.includes("claude")) {
        return { protocol: "claude", reason: `模型登记归属 ${found.provider} (Claude 原生)` };
      }
      if (p.includes("codex")) {
        return { protocol: "codex", reason: `模型登记归属 ${found.provider} (Codex 原生)` };
      }
      if (p.includes("google") || p.includes("gemini")) {
        return { protocol: "gemini", reason: `模型登记归属 ${found.provider} (Gemini 原生)` };
      }
      return { protocol: "openai", reason: `模型登记归属 ${found.provider} (OpenAI 兼容)` };
    }
  }

  // 4. Fallback name heuristics on the model ID
  if (targetId.includes("claude")) {
    return { protocol: "claude", reason: "依据模型名称推断为 Claude 原生 (/v1/messages)" };
  }
  if (targetId.includes("gemini")) {
    return { protocol: "gemini", reason: "依据模型名称推断为 Gemini 原生 (/v1beta/models/...)" };
  }
  if (targetId.includes("codex")) {
    return { protocol: "codex", reason: "依据模型名称推断为 Codex 原生 (/v1/responses)" };
  }

  // 5. Default to OpenAI compatibility
  return { protocol: "openai", reason: "默认 OpenAI 兼容协议 (/v1/chat/completions)" };
}

function getProtocolEndpoint(protocol: ApiProtocol, model: string, isStream: boolean): string {
  switch (protocol) {
    case "claude":
      return "/v1/messages";
    case "codex":
      return "/v1/responses";
    case "gemini":
      return `/v1beta/models/${model}:${isStream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    case "openai":
    default:
      return "/v1/chat/completions";
  }
}

export interface StreamDeltaResult {
  contentChunk: string;
  reasoningChunk: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function extractDeltaFromChunk(parsed: unknown): StreamDeltaResult {
  let contentChunk = "";
  let reasoningChunk = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined = undefined;

  if (!parsed || typeof parsed !== "object") {
    return { contentChunk, reasoningChunk, usage };
  }
  const obj = parsed as Record<string, unknown>;

  // 1. OpenAI format
  if (Array.isArray(obj.choices) && obj.choices[0] && typeof obj.choices[0] === "object") {
    const firstChoice = obj.choices[0] as Record<string, unknown>;
    const delta = firstChoice.delta as Record<string, unknown> | undefined;
    if (delta) {
      if (typeof delta.content === "string") contentChunk = delta.content;
      const reasoning = delta.reasoning_content || delta.reasoning || delta.thought;
      if (typeof reasoning === "string") reasoningChunk = reasoning;
    }
  }

  // 2. Claude format
  if (obj.type === "content_block_delta" && obj.delta && typeof obj.delta === "object") {
    const delta = obj.delta as Record<string, unknown>;
    if (delta.type === "text_delta" || typeof delta.text === "string") {
      contentChunk = String(delta.text || "");
    } else if (delta.type === "thinking_delta" || typeof delta.thinking === "string") {
      reasoningChunk = String(delta.thinking || "");
    }
  }

  // 3. Codex / Responses format
  if (obj.type === "response.output_text.delta" && typeof obj.delta === "string") {
    contentChunk = obj.delta;
  } else if (obj.type === "response.reasoning_text.delta" && typeof obj.delta === "string") {
    reasoningChunk = obj.delta;
  }

  // 4. Gemini format
  if (Array.isArray(obj.candidates) && obj.candidates[0] && typeof obj.candidates[0] === "object") {
    const cand = obj.candidates[0] as Record<string, unknown>;
    const content = cand.content as Record<string, unknown> | undefined;
    if (content && Array.isArray(content.parts)) {
      for (const p of content.parts) {
        if (p && typeof p === "object") {
          const part = p as Record<string, unknown>;
          if (part.thought || part.thought === true) {
            reasoningChunk += String(part.text || part.thought || "");
          } else if (typeof part.text === "string") {
            contentChunk += part.text;
          }
        }
      }
    }
  }

  // Usage extraction
  if (obj.usage && typeof obj.usage === "object") {
    const u = obj.usage as Record<string, unknown>;
    const pt = typeof u.prompt_tokens === "number" ? u.prompt_tokens : (typeof u.input_tokens === "number" ? u.input_tokens : undefined);
    const ct = typeof u.completion_tokens === "number" ? u.completion_tokens : (typeof u.output_tokens === "number" ? u.output_tokens : undefined);
    const tt = typeof u.total_tokens === "number" ? u.total_tokens : ((pt ?? 0) + (ct ?? 0));
    usage = { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt };
  } else if (obj.message && typeof obj.message === "object") {
    const m = obj.message as Record<string, unknown>;
    if (m.usage && typeof m.usage === "object") {
      const u = m.usage as Record<string, unknown>;
      const it = typeof u.input_tokens === "number" ? u.input_tokens : undefined;
      const ot = typeof u.output_tokens === "number" ? u.output_tokens : undefined;
      usage = { prompt_tokens: it, completion_tokens: ot, total_tokens: (it ?? 0) + (ot ?? 0) };
    }
  } else if (obj.response && typeof obj.response === "object") {
    const r = obj.response as Record<string, unknown>;
    if (r.usage && typeof r.usage === "object") {
      const u = r.usage as Record<string, unknown>;
      const it = typeof u.input_tokens === "number" ? u.input_tokens : undefined;
      const ot = typeof u.output_tokens === "number" ? u.output_tokens : undefined;
      const tt = typeof u.total_tokens === "number" ? u.total_tokens : ((it ?? 0) + (ot ?? 0));
      usage = { prompt_tokens: it, completion_tokens: ot, total_tokens: tt };
    }
  } else if (obj.usageMetadata && typeof obj.usageMetadata === "object") {
    const u = obj.usageMetadata as Record<string, unknown>;
    const pt = typeof u.promptTokenCount === "number" ? u.promptTokenCount : undefined;
    const ct = typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : undefined;
    const tt = typeof u.totalTokenCount === "number" ? u.totalTokenCount : ((pt ?? 0) + (ct ?? 0));
    usage = { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt };
  }

  return { contentChunk, reasoningChunk, usage };
}

interface NonStreamResult {
  content: string;
  reasoning?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function extractResponseFromData(data: unknown): NonStreamResult {
  let content = "";
  let reasoning: string | undefined = undefined;
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined = undefined;

  if (!data || typeof data !== "object") {
    return { content: String(data || "(无回复内容)"), reasoning, usage };
  }
  const obj = data as Record<string, unknown>;

  // 1. OpenAI format
  if (Array.isArray(obj.choices) && obj.choices[0] && typeof obj.choices[0] === "object") {
    const choice = obj.choices[0] as Record<string, unknown>;
    const msg = choice.message as Record<string, unknown> | undefined;
    if (msg) {
      if (typeof msg.content === "string") content = msg.content;
      const r = msg.reasoning_content || msg.reasoning || msg.thought;
      if (typeof r === "string") reasoning = r;
    }
  }
  // 2. Claude format
  else if (Array.isArray(obj.content)) {
    for (const b of obj.content) {
      if (b && typeof b === "object") {
        const block = b as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") {
          content += block.text;
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          reasoning = (reasoning || "") + block.thinking;
        }
      }
    }
  }
  // 3. Codex / Responses format
  else if (Array.isArray(obj.output)) {
    for (const it of obj.output) {
      if (it && typeof it === "object") {
        const item = it as Record<string, unknown>;
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const p of item.content) {
            if (p && typeof p === "object") {
              const part = p as Record<string, unknown>;
              if (part.type === "output_text" && typeof part.text === "string") {
                content += part.text;
              }
            }
          }
        } else if (typeof item.text === "string") {
          content += item.text;
        }
      }
    }
  }
  // 4. Gemini format
  else if (Array.isArray(obj.candidates) && obj.candidates[0] && typeof obj.candidates[0] === "object") {
    const cand = obj.candidates[0] as Record<string, unknown>;
    const c = cand.content as Record<string, unknown> | undefined;
    if (c && Array.isArray(c.parts)) {
      for (const p of c.parts) {
        if (p && typeof p === "object") {
          const part = p as Record<string, unknown>;
          if (part.thought || part.thought === true) {
            reasoning = (reasoning || "") + String(part.text || part.thought || "");
          } else if (typeof part.text === "string") {
            content += part.text;
          }
        }
      }
    }
  }

  // Fallback to text if still empty
  if (!content && typeof obj.text === "string") {
    content = obj.text;
  }

  // Usage extraction
  if (obj.usage && typeof obj.usage === "object") {
    const u = obj.usage as Record<string, unknown>;
    const pt = typeof u.prompt_tokens === "number" ? u.prompt_tokens : (typeof u.input_tokens === "number" ? u.input_tokens : undefined);
    const ct = typeof u.completion_tokens === "number" ? u.completion_tokens : (typeof u.output_tokens === "number" ? u.output_tokens : undefined);
    const tt = typeof u.total_tokens === "number" ? u.total_tokens : ((pt ?? 0) + (ct ?? 0));
    usage = { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt };
  } else if (obj.usageMetadata && typeof obj.usageMetadata === "object") {
    const u = obj.usageMetadata as Record<string, unknown>;
    const pt = typeof u.promptTokenCount === "number" ? u.promptTokenCount : undefined;
    const ct = typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : undefined;
    const tt = typeof u.totalTokenCount === "number" ? u.totalTokenCount : ((pt ?? 0) + (ct ?? 0));
    usage = { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt };
  }

  return { content: content || "(无回复内容)", reasoning, usage };
}

// ---------------------------------------------------------------- Default Data

const STORAGE_KEY = "cpa-playground-sessions-v2";
const HEADERS_STORAGE_KEY = "cpa-playground-custom-headers";
const BODY_STORAGE_KEY = "cpa-playground-custom-body";

const POPULAR_MODELS: ModelItem[] = [
  { id: "gpt-4o", provider: "OpenAI" },
  { id: "gpt-4o-mini", provider: "OpenAI" },
  { id: "o1", provider: "OpenAI" },
  { id: "o3-mini", provider: "OpenAI" },
  { id: "claude-3-7-sonnet", provider: "Anthropic" },
  { id: "claude-3-5-sonnet", provider: "Anthropic" },
  { id: "claude-3-5-haiku", provider: "Anthropic" },
  { id: "gemini-2.5-pro", provider: "Google" },
  { id: "gemini-2.5-flash", provider: "Google" },
  { id: "deepseek-chat", provider: "DeepSeek" },
  { id: "deepseek-reasoner", provider: "DeepSeek" },
  { id: "grok-2", provider: "xAI" },
  { id: "qwen-max", provider: "Qwen" },
];

const PRESET_PROMPTS = [
  {
    tag: "连通性",
    label: "⚡ API 连通性探测",
    prompt: "你好！请简要确认当前 API 网关连通性，并说明你当前所运行的模型名称与厂商。",
  },
  {
    tag: "代码生成",
    label: "💻 并发任务处理 (TS)",
    prompt: "请用 TypeScript 实现一个支持最大并发数限制的 Promise 批处理函数 pMap(items, mapper, concurrency)，并附带使用示例与边界处理说明。",
  },
  {
    tag: "结构化 JSON",
    label: "📊 标准 JSON 数组输出",
    prompt: "请以严格的 JSON 数组格式返回 3 个著名开源 AI 框架的名称、GitHub Stars 估算值与核心特点。只需返回合法 JSON，不要包含任何额外的自然语言解释或 markdown 代码块标签。",
  },
  {
    tag: "逻辑推理",
    label: "🧠 复杂逻辑推理题",
    prompt: "一个农夫带着一只狼、一只羊和一棵白菜过河，船只能载农夫和一样东西。狼和羊在一起狼会吃羊，羊和白菜在一起羊会吃白菜。农夫不在场时它们就会发生攻击。农夫该如何安全运送三样东西过河？请详细列出每一步。",
  },
  {
    tag: "吞吐基准",
    label: "🚀 流式吞吐测速短文",
    prompt: "请撰写一篇 350 字关于现代分布式 API 网关设计架构的技术短文，重点说明为什么会话亲和性与令牌桶算法对降低大模型推理抖动至关重要。",
  },
];

function loadPersistedSessions(): PlaygroundSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // ignore parse error
  }
  return [
    {
      id: "session-default",
      title: "接口调试会话 #1",
      model: "gpt-4o",
      createdAt: Date.now(),
      messages: [],
    },
  ];
}

interface ApiError extends Error {
  statusCode?: number;
  payload?: unknown;
}

export function extractErrorMessage(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (obj.error && typeof obj.error === "object") {
      const inner = obj.error as Record<string, unknown>;
      if (typeof inner.message === "string" && inner.message) {
        return inner.message;
      }
    }
    if (typeof obj.message === "string" && obj.message) {
      return obj.message;
    }
  }
  return fallback;
}

// ------------------------------------------------------------- JSON Parsing & Highlighting Helpers

function normalizePayloadForDisplay(val: unknown): unknown {
  if (val === null || val === undefined) return val;

  if (typeof val === "string") {
    const trimmed = val.trim();
    // Check for "[HTTP 500] {...}" format
    const httpMatch = trimmed.match(/^\[HTTP\s+(\d+)\]\s*([\s\S]*)$/);
    if (httpMatch && httpMatch[1]) {
      const status = parseInt(httpMatch[1], 10);
      const rest = (httpMatch[2] ?? "").trim();
      if (rest) {
        try {
          const parsed = JSON.parse(rest);
          return {
            status,
            ...(typeof parsed === "object" && parsed !== null
              ? (parsed as Record<string, unknown>)
              : { message: parsed }),
          };
        } catch {
          return { status, error: rest };
        }
      }
      return { status };
    }

    // Check if it's a JSON string
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizePayloadForDisplay(parsed);
      } catch {
        return val;
      }
    }
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => normalizePayloadForDisplay(item));
  }

  if (typeof val === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = normalizePayloadForDisplay(v);
    }
    return res;
  }

  return val;
}

function formatJsonForDisplay(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  const normalized = normalizePayloadForDisplay(payload);
  if (typeof normalized === "string") {
    return normalized;
  }
  try {
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(normalized);
  }
}

function renderJsonHighlighted(jsonString: string): React.ReactNode {
  if (!jsonString) return null;
  const regex =
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(jsonString)) !== null) {
    if (match.index > lastIndex) {
      parts.push(jsonString.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (/^"/.test(token)) {
      if (/:$/.test(token)) {
        // Object Key
        parts.push(
          <span key={match.index} className="text-cyan-400 font-semibold">
            {token.slice(0, -1)}
          </span>,
          ":",
        );
      } else {
        // String value
        parts.push(
          <span key={match.index} className="text-emerald-300">
            {token}
          </span>,
        );
      }
    } else if (/true|false/.test(token)) {
      parts.push(
        <span key={match.index} className="text-purple-400 font-semibold">
          {token}
        </span>,
      );
    } else if (/null/.test(token)) {
      parts.push(
        <span key={match.index} className="text-rose-400 italic">
          {token}
        </span>,
      );
    } else {
      // Number
      parts.push(
        <span key={match.index} className="text-amber-400">
          {token}
        </span>,
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < jsonString.length) {
    parts.push(jsonString.slice(lastIndex));
  }
  return parts;
}

export interface BuildRequestOptions {
  protocol: ApiProtocol;
  model: string;
  systemPrompt: string;
  inputText: string;
  inputImages?: string[];
  history: PlaygroundMessage[];
  stream: boolean;
  enableTemperature: boolean;
  temperature: number;
  enableMaxTokens: boolean;
  maxTokens: number;
  enableTopP: boolean;
  topP: number;
  reasoningEffort: ReasoningEffortLevel;
  customHeaders: CustomHeader[];
  customBodyFields: VisualFieldNode[];
  clientApiKey?: string;
  managementKey?: string;
}

export interface BuiltPlaygroundRequest {
  endpointPath: string;
  headers: Record<string, string>;
  displayHeaders: Record<string, string>;
  body: Record<string, unknown>;
}

export function buildPlaygroundRequest(opts: BuildRequestOptions): BuiltPlaygroundRequest {
  const targetModel = opts.model.trim() || "gpt-4o";
  const authKey = opts.clientApiKey?.trim() || opts.managementKey?.trim() || "";
  const customHeadersMap = customHeadersToRecord(opts.customHeaders);
  const customBody = customFieldsToBody(opts.customBodyFields);

  let endpointPath = "/v1/chat/completions";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authKey ? { Authorization: `Bearer ${authKey}` } : {}),
    ...customHeadersMap,
  };
  const displayHeaders: Record<string, string> = { ...headers };
  if (authKey && !customHeadersMap["Authorization"] && !customHeadersMap["authorization"]) {
    displayHeaders["Authorization"] = `Bearer ${authKey.slice(0, 8)}...`;
  }

  let body: Record<string, unknown> = {};

  const userText = opts.inputText.trim();
  const userImages = opts.inputImages || [];
  const hasUserTurn = userText.length > 0 || userImages.length > 0;

  if (opts.protocol === "claude") {
    endpointPath = "/v1/messages";
    headers["anthropic-version"] = "2023-06-01";
    displayHeaders["anthropic-version"] = "2023-06-01";
    if (authKey && !headers["x-api-key"]) {
      headers["x-api-key"] = authKey;
      displayHeaders["x-api-key"] = `${authKey.slice(0, 8)}...`;
    }

    const buildClaudeContent = (text: string, images?: string[]) => {
      if (!images || images.length === 0) return text || " ";
      const blocks: unknown[] = [];
      if (text.trim()) blocks.push({ type: "text", text });
      for (const img of images) {
        const match = img.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
        if (match && match[1] && match[2]) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: match[1], data: match[2] },
          });
        }
      }
      return blocks.length > 0 ? blocks : text || " ";
    };

    const claudeHistory = opts.history
      .filter((m) => !m.error && (m.content.trim().length > 0 || (m.images && m.images.length > 0)) && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: buildClaudeContent(m.content, m.images) }));

    const claudeMessages = [
      ...claudeHistory,
      ...(hasUserTurn
        ? [{ role: "user", content: buildClaudeContent(userText, userImages) }]
        : claudeHistory.length === 0
          ? [{ role: "user", content: " " }]
          : []),
    ];

    body = {
      model: targetModel,
      ...(opts.systemPrompt.trim() ? { system: opts.systemPrompt.trim() } : {}),
      messages: claudeMessages,
      ...(opts.enableMaxTokens ? { max_tokens: opts.maxTokens || 2048 } : {}),
      ...(opts.enableTemperature ? { temperature: opts.temperature } : {}),
      ...(opts.enableTopP ? { top_p: opts.topP } : {}),
      stream: opts.stream,
      ...(opts.reasoningEffort !== "off"
        ? {
            thinking: { type: "adaptive" },
            output_config: { effort: opts.reasoningEffort },
          }
        : {}),
      ...customBody,
    };
  } else if (opts.protocol === "codex") {
    endpointPath = "/v1/responses";
    const buildCodexContent = (m: PlaygroundMessage) => {
      if (m.images && m.images.length > 0) {
        return [
          ...(m.content.trim() ? [{ type: "text", text: m.content }] : [{ type: "text", text: " " }]),
          ...m.images.map((img) => ({ type: "image_url", image_url: { url: img } })),
        ];
      }
      return m.content || " ";
    };

    const codexHistory = opts.history
      .filter((m) => !m.error && (m.content.trim().length > 0 || (m.images && m.images.length > 0)) && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: buildCodexContent(m) }));

    const codexUserContent =
      userImages.length > 0
        ? [
            ...(userText.length > 0 ? [{ type: "text", text: userText }] : [{ type: "text", text: " " }]),
            ...userImages.map((img) => ({ type: "image_url", image_url: { url: img } })),
          ]
        : userText || " ";

    const codexInput = [
      ...codexHistory,
      ...(hasUserTurn
        ? [{ role: "user", content: codexUserContent }]
        : codexHistory.length === 0
          ? [{ role: "user", content: " " }]
          : []),
    ];

    body = {
      model: targetModel,
      ...(opts.systemPrompt.trim() ? { instructions: opts.systemPrompt.trim() } : {}),
      input: codexInput,
      ...(opts.enableTemperature ? { temperature: opts.temperature } : {}),
      ...(opts.enableMaxTokens ? { max_output_tokens: opts.maxTokens } : {}),
      stream: opts.stream,
      ...(opts.reasoningEffort !== "off"
        ? {
            reasoning: { effort: opts.reasoningEffort },
          }
        : {}),
      ...customBody,
    };
  } else if (opts.protocol === "gemini") {
    endpointPath = `/v1beta/models/${targetModel}:${opts.stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    if (authKey && !headers["x-goog-api-key"]) {
      headers["x-goog-api-key"] = authKey;
      displayHeaders["x-goog-api-key"] = `${authKey.slice(0, 8)}...`;
    }

    const buildGeminiParts = (text: string, images?: string[]) => {
      const parts: unknown[] = [];
      if (text.trim()) parts.push({ text });
      if (images && images.length > 0) {
        for (const img of images) {
          const match = img.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
          if (match && match[1] && match[2]) {
            parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
          }
        }
      }
      if (parts.length === 0) parts.push({ text: " " });
      return parts;
    };

    const geminiHistory = opts.history
      .filter((m) => !m.error && (m.content.trim().length > 0 || (m.images && m.images.length > 0)) && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: buildGeminiParts(m.content, m.images),
      }));

    const geminiContents = [
      ...geminiHistory,
      ...(hasUserTurn
        ? [{ role: "user", parts: buildGeminiParts(userText, userImages) }]
        : geminiHistory.length === 0
          ? [{ role: "user", parts: [{ text: " " }] }]
          : []),
    ];

    const generationConfig: Record<string, unknown> = {};
    if (opts.enableTemperature) generationConfig.temperature = opts.temperature;
    if (opts.enableMaxTokens) generationConfig.maxOutputTokens = opts.maxTokens;
    if (opts.enableTopP) generationConfig.topP = opts.topP;
    if (opts.reasoningEffort !== "off") {
      generationConfig.thinkingConfig = {
        thinkingLevel: opts.reasoningEffort,
      };
    }

    body = {
      contents: geminiContents,
      ...(opts.systemPrompt.trim() ? { systemInstruction: { parts: [{ text: opts.systemPrompt.trim() }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
      ...customBody,
    };
  } else {
    // "openai"
    endpointPath = "/v1/chat/completions";
    const buildContent = (m: PlaygroundMessage) => {
      if (m.images && m.images.length > 0) {
        return [
          ...(m.content.trim() ? [{ type: "text", text: m.content }] : [{ type: "text", text: " " }]),
          ...m.images.map((img) => ({
            type: "image_url",
            image_url: { url: img },
          })),
        ];
      }
      return m.content || " ";
    };

    const validHistory = opts.history
      .filter((m) => !m.error && (m.content.trim().length > 0 || (m.images && m.images.length > 0)) && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: buildContent(m) }));

    const userPayloadContent =
      userImages.length > 0
        ? [
            ...(userText.length > 0 ? [{ type: "text", text: userText }] : [{ type: "text", text: " " }]),
            ...userImages.map((img) => ({ type: "image_url", image_url: { url: img } })),
          ]
        : userText || " ";

    const messagesPayload = [
      ...(opts.systemPrompt.trim() ? [{ role: "system", content: opts.systemPrompt.trim() }] : []),
      ...validHistory,
      ...(hasUserTurn
        ? [{ role: "user", content: userPayloadContent }]
        : validHistory.length === 0
          ? [{ role: "user", content: " " }]
          : []),
    ];

    body = {
      model: targetModel,
      messages: messagesPayload,
      ...(opts.enableTemperature ? { temperature: opts.temperature } : {}),
      ...(opts.enableMaxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.enableTopP ? { top_p: opts.topP } : {}),
      stream: opts.stream,
      ...(opts.reasoningEffort !== "off" ? { reasoning_effort: opts.reasoningEffort } : {}),
      ...customBody,
    };
  }

  return {
    endpointPath,
    headers,
    displayHeaders,
    body,
  };
}

function generateCurlSnippet(req: {
  endpointPath: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}): string {
  const url = `${typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8317"}${req.endpointPath}`;
  const headerLines = Object.entries(req.headers)
    .map(([k, v]) => `  -H "${k}: ${v.replace(/"/g, '\\"')}"`)
    .join(" \\\n");
  const bodyJson = JSON.stringify(req.body, null, 2);

  return `curl -X POST "${url}" \\\n${headerLines} \\\n  -d '${bodyJson.replace(/'/g, "'\\''")}'`;
}

// ------------------------------------------------------------- Main Component

export function PlaygroundPage() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PlaygroundSession[]>(loadPersistedSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id || "session-default");
  const [sessionSearch, setSessionSearch] = useState("");

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || {
    id: "session-default",
    title: "接口调试会话 #1",
    model: "gpt-4o",
    createdAt: Date.now(),
    messages: [],
  };

  // Execution & Input State
  const [input, setInput] = useState("");
  const [inputImages, setInputImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState(true);
  const [enableTemperature, setEnableTemperature] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [enableMaxTokens, setEnableMaxTokens] = useState(false);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [enableTopP, setEnableTopP] = useState(false);
  const [topP, setTopP] = useState(1.0);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortLevel>("off");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful and concise AI assistant.");
  const [selectedModel, setSelectedModel] = useState<string>(activeSession.model || "gpt-4o");
  const [manualProtocol, setManualProtocol] = useState<ApiProtocol | null>(() => activeSession.protocol ?? null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [clientApiKey, setClientApiKey] = useState<string>("");
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>(() => {
    try {
      const raw = localStorage.getItem(HEADERS_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // quota or localstorage disabled
    }
    return [];
  });
  const [customBodyFields, setCustomBodyFields] = useState<VisualFieldNode[]>(() => {
    try {
      const raw = localStorage.getItem(BODY_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // quota or localstorage disabled
    }
    return [];
  });

  // Sync custom headers and body fields to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(HEADERS_STORAGE_KEY, JSON.stringify(customHeaders));
    } catch {
      // quota or localstorage disabled
    }
  }, [customHeaders]);

  useEffect(() => {
    try {
      localStorage.setItem(BODY_STORAGE_KEY, JSON.stringify(customBodyFields));
    } catch {
      // quota or localstorage disabled
    }
  }, [customBodyFields]);

  // Panels & Tabs
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"params" | "inspector" | null>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "params" : null,
  );
  const [lastPanelTab, setLastPanelTab] = useState<"params" | "inspector">("params");
  const panelTab = rightPanelTab ?? lastPanelTab;
  const [inspectorMsgId, setInspectorMsgId] = useState<string | null>(null);
  const [inspectorViewMode, setInspectorViewMode] = useState<"live" | "snapshot">("live");
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);
  const [contextProberOpen, setContextProberOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Resizable Right Panel
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("cpa-playground-panel-width");
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 320 && val <= 1000) return val;
      }
    } catch {
      // quota or localstorage disabled
    }
    return 384;
  });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("cpa-playground-panel-width", String(panelWidth));
    } catch {
      // quota or localstorage disabled
    }
  }, [panelWidth]);

  const handlePanelResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPanel(true);
    const startX = e.clientX;
    const startWidth = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      const minW = 320;
      const maxW = Math.min(1000, window.innerWidth - 320);
      const newWidth = Math.max(minW, Math.min(maxW, Math.round(startWidth + delta)));
      setPanelWidth(newWidth);
    };

    const handlePointerUp = () => {
      setIsDraggingPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (rightPanelTab) setLastPanelTab(rightPanelTab);
  }, [rightPanelTab]);

  // Reset message editing and restore model & protocol when session switches
  useEffect(() => {
    setEditingMsgId(null);
    setSelectedModel(activeSession.model || "gpt-4o");
    setManualProtocol(activeSession.protocol ?? null);
  }, [activeSessionId, activeSession.model, activeSession.protocol]);

  // Read model from URL params if passed from provider card
  useEffect(() => {
    const modelParam = searchParams.get("model");
    if (modelParam && modelParam.trim()) {
      setSelectedModel(modelParam.trim());
      toast.info(t("playground.modelLoaded", { model: modelParam.trim() }));
    }
  }, [searchParams]);

  // Sync sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // quota or localstorage disabled
    }
  }, [sessions]);

  // Query native /v1/models from CPA gateway
  const modelsApiQuery = useQuery({
    queryKey: ["v1-models-list"],
    queryFn: async (): Promise<ModelItem[]> => {
      try {
        const authKey = clientApiKey.trim() || currentKey() || "";
        const res = await fetch(`${window.location.origin}/v1/models`, {
          headers: authKey ? { Authorization: `Bearer ${authKey}` } : {},
        });
        if (!res.ok) return [];
        const json = await res.json();
        const list = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.models) ? json.models : []);
        return list
          .map((m: { id?: string; owned_by?: string }) => ({
            id: String(m.id || ""),
            provider: String(m.owned_by || "CPA"),
          }))
          .filter((m: ModelItem) => Boolean(m.id));
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });

  // Load configured providers to discover existing models
  const providersQuery = useQuery({
    queryKey: ["providers-overview"],
    queryFn: async (): Promise<Record<string, Entry[]>> => {
      const lists = await Promise.all(
        ALL_KINDS.map((kind) => providerLists.getList<Entry>(kind.path, kind.responseKey).catch(() => [])),
      );
      return Object.fromEntries(ALL_KINDS.map((kind, i) => [kind.id, lists[i] ?? []])) as Record<string, Entry[]>;
    },
    staleTime: 60_000,
  });

  // Load credentials / auth files (including OAuth subscriptions)
  const credentialsQuery = useQuery({
    queryKey: ["auth-files"],
    queryFn: async (): Promise<AuthFileEntry[]> => {
      try {
        const res = await credentials.list();
        return res.files ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  // Consolidate discovered models
  const [modelOptions, setModelOptions] = useState<ModelItem[]>(POPULAR_MODELS);
  useEffect(() => {
    const list: ModelItem[] = [];
    const seen = new Set<string>();

    const addModel = (id: string, provider: string) => {
      const clean = id.trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      list.push({ id: clean, provider });
    };

    // 1. From provider lists (highest fidelity with specific upstream provider names)
    const data = providersQuery.data ?? {};
    for (const [kindId, entries] of Object.entries(data)) {
      for (const entry of entries) {
        const providerName = String(entry.name || entry.prefix || kindId);
        const prefix = typeof entry.prefix === "string" ? entry.prefix.trim() : "";
        const rawModels = Array.isArray(entry.models) ? entry.models : [];
        for (const m of rawModels) {
          if (typeof m === "string" && m.trim()) {
            if (prefix) addModel(`${prefix}/${m.trim()}`, providerName);
            addModel(m.trim(), providerName);
          } else if (m && typeof m === "object") {
            const rec = m as Record<string, unknown>;
            const alias = typeof rec.alias === "string" ? rec.alias.trim() : "";
            const name = typeof rec.name === "string" ? rec.name.trim() : "";
            const id = typeof rec.id === "string" ? rec.id.trim() : "";
            if (alias) {
              if (prefix) addModel(`${prefix}/${alias}`, providerName);
              addModel(alias, providerName);
            }
            if (name) {
              if (prefix) addModel(`${prefix}/${name}`, providerName);
              addModel(name, providerName);
            }
            if (id) {
              if (prefix) addModel(`${prefix}/${id}`, providerName);
              addModel(id, providerName);
            }
          }
        }
      }
    }

    // 2. From /v1/models gateway discovery
    for (const item of modelsApiQuery.data ?? []) {
      addModel(item.id, item.provider);
    }

    // 3. Append standard popular models if not yet in list
    for (const item of POPULAR_MODELS) {
      addModel(item.id, item.provider);
    }

    setModelOptions(list);
  }, [modelsApiQuery.data, providersQuery.data]);

  // Filter models based on search query
  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return modelOptions;
    return modelOptions.filter((item) => {
      return (
        item.id.toLowerCase().includes(q) ||
        item.provider.toLowerCase().includes(q)
      );
    });
  }, [modelOptions, modelSearch]);

  // Inferred protocol derived from current model, providers and credentials
  const inferred = useMemo(
    () => inferProtocol(selectedModel, providersQuery.data, credentialsQuery.data, modelOptions),
    [selectedModel, providersQuery.data, credentialsQuery.data, modelOptions],
  );

  const activeProtocol: ApiProtocol = manualProtocol ?? inferred.protocol;

  // Live real-time assembled request payload based on current parameters and state
  const liveRequest = useMemo(() => {
    return buildPlaygroundRequest({
      protocol: activeProtocol,
      model: selectedModel,
      systemPrompt,
      inputText: input,
      inputImages,
      history: activeSession.messages,
      stream,
      enableTemperature,
      temperature,
      enableMaxTokens,
      maxTokens,
      enableTopP,
      topP,
      reasoningEffort,
      customHeaders,
      customBodyFields,
      clientApiKey,
      managementKey: currentKey(),
    });
  }, [
    activeProtocol,
    selectedModel,
    systemPrompt,
    input,
    inputImages,
    activeSession.messages,
    stream,
    enableTemperature,
    temperature,
    enableMaxTokens,
    maxTokens,
    enableTopP,
    topP,
    reasoningEffort,
    customHeaders,
    customBodyFields,
    clientApiKey,
  ]);

  // Auto scroll messages to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeSession.messages, loading]);

  // Copy helper
  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  // Session Handlers
  const handleCreateSession = () => {
    const newId = `session-${Date.now()}`;
    const newSession: PlaygroundSession = {
      id: newId,
      title: `${t("playground.sessionPrefix")}${sessions.length + 1}`,
      model: selectedModel || "gpt-4o",
      protocol: manualProtocol ?? undefined,
      createdAt: Date.now(),
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
    toast.success(t("playground.newSession"));
  };

  const handleSelectModel = (model: string) => {
    const clean = model.trim();
    if (!clean) return;
    setSelectedModel(clean);
    setManualProtocol(null);
    setSessions((currentSessions) =>
      currentSessions.map((s) => (s.id === activeSessionId ? { ...s, model: clean, protocol: undefined } : s)),
    );
  };

  const handleModelInputChange = (val: string) => {
    setSelectedModel(val);
    setManualProtocol(null);
    setSessions((currentSessions) =>
      currentSessions.map((s) => (s.id === activeSessionId ? { ...s, model: val, protocol: undefined } : s)),
    );
  };

  const handleSelectProtocol = (protocol: ApiProtocol) => {
    setManualProtocol(protocol);
    setSessions((currentSessions) =>
      currentSessions.map((s) => (s.id === activeSessionId ? { ...s, protocol } : s)),
    );
  };

  const handleResetProtocol = () => {
    setManualProtocol(null);
    setSessions((currentSessions) =>
      currentSessions.map((s) => (s.id === activeSessionId ? { ...s, protocol: undefined } : s)),
    );
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    const clean = newTitle.trim();
    if (clean) {
      setSessions((currentSessions) =>
        currentSessions.map((s) => (s.id === id ? { ...s, title: clean } : s)),
      );
      toast.success("会话名称已更新");
    }
    setEditingSessionId(null);
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) {
      setSessions([
        {
          id: `session-${Date.now()}`,
          title: "接口调试会话 #1",
          model: selectedModel || "gpt-4o",
          createdAt: Date.now(),
          messages: [],
        },
      ]);
      toast.info("已重置为全新调试会话");
      return;
    }
    const filtered = sessions.filter((s) => s.id !== id);
    setSessions(filtered);
    if (activeSessionId === id && filtered[0]) {
      setActiveSessionId(filtered[0].id);
      setSelectedModel(filtered[0].model || "gpt-4o");
    }
    toast.success("已删除调试会话");
  };

  const updateActiveSessionMessages = (updater: (prev: PlaygroundMessage[]) => PlaygroundMessage[]) => {
    setSessions((currentSessions) =>
      currentSessions.map((s) => {
        if (s.id !== activeSessionId) return s;
        const updatedMessages = updater(s.messages);
        return {
          ...s,
          model: selectedModel,
          messages: updatedMessages,
        };
      }),
    );
  };

  const handleSaveProbeToSession = (
    userPrompt: string,
    assistantReply: string,
    rawRequest?: BuiltPlaygroundRequest,
    rawResponse?: unknown,
    metrics?: MessageMetrics,
  ) => {
    const timestamp = Date.now();
    const userMsg: PlaygroundMessage = {
      id: `probe-user-${timestamp}`,
      role: "user",
      content: userPrompt,
      timestamp,
      model: selectedModel,
      rawRequest: rawRequest
        ? {
            url: rawRequest.endpointPath,
            headers: rawRequest.displayHeaders || rawRequest.headers,
            body: rawRequest.body,
          }
        : undefined,
    };
    const assistantMsg: PlaygroundMessage = {
      id: `probe-assistant-${timestamp + 1}`,
      role: "assistant",
      content: assistantReply,
      timestamp: timestamp + 1,
      model: selectedModel,
      metrics,
      rawResponse,
    };

    updateActiveSessionMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Update title if it was an empty or default session
    if (activeSession.messages.length === 0 || activeSession.title.startsWith("接口调试会话 #")) {
      const targetSummary = `上下文探测 (${selectedModel.split("/").pop() || selectedModel})`;
      setSessions((currentSessions) =>
        currentSessions.map((s) => (s.id === activeSessionId ? { ...s, title: targetSummary } : s)),
      );
    }
  };

  // Inspect specific message in JSON Inspector
  const inspectedMessage =
    activeSession.messages.find((m) => m.id === inspectorMsgId) ||
    [...activeSession.messages].reverse().find((m) => m.rawRequest || m.rawResponse);

  // Message edit and rollback-resend handlers
  const handleSaveEditOnly = (msgId: string, newContent: string) => {
    const clean = newContent.trim();
    if (!clean) {
      toast.error("消息内容不能为空");
      return;
    }
    updateActiveSessionMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, content: clean } : m)),
    );
    setEditingMsgId(null);
    toast.success(t("playground.messageUpdated", "消息内容已更新"));
  };

  const handleConfirmResend = async (msgId: string, newContent: string) => {
    const clean = newContent.trim();
    if (!clean) {
      toast.error("消息内容不能为空");
      return;
    }
    const index = activeSession.messages.findIndex((m) => m.id === msgId);
    if (index === -1) return;

    setEditingMsgId(null);
    void handleSend(clean, index);
  };

  const handleRegenerate = (assistantMsgId: string) => {
    const index = activeSession.messages.findIndex((m) => m.id === assistantMsgId);
    if (index === -1) return;
    let userMsgIndex = -1;
    for (let i = index - 1; i >= 0; i--) {
      const prevMsg = activeSession.messages[i];
      if (prevMsg && prevMsg.role === "user") {
        userMsgIndex = i;
        break;
      }
    }
    const targetMsg = userMsgIndex !== -1 ? activeSession.messages[userMsgIndex] : undefined;
    if (!targetMsg || !targetMsg.content.trim()) {
      toast.error("找不到前置用户提示词");
      return;
    }
    const prompt = targetMsg.content;
    setEditingMsgId(null);
    void handleSend(prompt, userMsgIndex);
  };

  const handleImageUpload = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error("仅支持上传图片文件");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("单张图片大小不能超过 10MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        if (dataUrl) {
          setInputImages((prev) => [...prev, dataUrl]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      handleImageUpload(imageFiles);
      toast.success(`已添加 ${imageFiles.length} 张剪贴板图片`);
    }
  };

  // Send API Request (supports regular send, quick prompt, and rollback resend at truncateIndex)
  const handleSend = async (overridePrompt?: string, truncateIndex?: number) => {
    const textToSend = (overridePrompt ?? input).trim();
    if ((!textToSend && inputImages.length === 0) || loading) return;

    const userMsgId = Math.random().toString(36).slice(2, 10);
    const assistantMsgId = Math.random().toString(36).slice(2, 10);

    const imagesToSend =
      truncateIndex !== undefined && activeSession.messages[truncateIndex]?.images
        ? activeSession.messages[truncateIndex]!.images!
        : [...inputImages];

    const userMessage: PlaygroundMessage = {
      id: userMsgId,
      role: "user",
      content: textToSend,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
      timestamp: Date.now(),
    };

    if (!overridePrompt && truncateIndex === undefined) {
      setInput("");
      setInputImages([]);
    }
    setLoading(true);

    const targetModel = selectedModel.trim() || "gpt-4o";

    const baseHistory =
      truncateIndex !== undefined
        ? activeSession.messages.slice(0, truncateIndex)
        : activeSession.messages;

    const built = buildPlaygroundRequest({
      protocol: activeProtocol,
      model: targetModel,
      systemPrompt,
      inputText: textToSend,
      inputImages: imagesToSend,
      history: baseHistory,
      stream,
      enableTemperature,
      temperature,
      enableMaxTokens,
      maxTokens,
      enableTopP,
      topP,
      reasoningEffort,
      customHeaders,
      customBodyFields,
      clientApiKey,
      managementKey: currentKey(),
    });

    const endpointPath = built.endpointPath;
    const headers = built.headers;
    const displayHeaders = built.displayHeaders;
    const requestPayload = built.body;

    const endpointUrl = `${window.location.origin}${endpointPath}`;
    const startTime = performance.now();
    let ttftTime: number | undefined = undefined;

    const rawReqRecord = {
      url: `POST ${endpointPath}`,
      headers: displayHeaders,
      body: requestPayload,
    };

    // Prepare assistant placeholder with rawRequest attached immediately for JSON Inspector
    const assistantPlaceholder: PlaygroundMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      model: targetModel,
      timestamp: Date.now(),
      rawRequest: rawReqRecord,
    };

    // Auto-update default session title on first message
    if (baseHistory.length === 0 || activeSession.title.startsWith("接口调试会话 #")) {
      const summary = textToSend.replace(/\s+/g, " ").trim();
      const newTitle = summary.length > 18 ? `${summary.slice(0, 18)}…` : summary;
      setSessions((currentSessions) =>
        currentSessions.map((s) => (s.id === activeSessionId ? { ...s, title: newTitle } : s)),
      );
    }

    if (truncateIndex !== undefined) {
      updateActiveSessionMessages(() => [...baseHistory, userMessage, assistantPlaceholder]);
    } else {
      updateActiveSessionMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedContent = "";
    let accumulatedReasoning = "";
    let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined = undefined;
    const rawChunks: string[] = [];

    try {
      if (stream) {
        const response = await fetch(endpointUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        const statusCode = response.status;
        if (!response.ok) {
          const errText = await response.text();
          let parsedError: unknown = null;
          try {
            parsedError = JSON.parse(errText);
          } catch {
            parsedError = null;
          }
          const customErr: ApiError = new Error(extractErrorMessage(parsedError, errText || response.statusText));
          customErr.statusCode = statusCode;
          customErr.payload = parsedError || { status: statusCode, error: errText || response.statusText };
          throw customErr;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === "[DONE]") break;

              rawChunks.push(dataStr);
              try {
                const parsed = JSON.parse(dataStr);
                const deltaRes = extractDeltaFromChunk(parsed);
                if (deltaRes.usage) {
                  streamUsage = deltaRes.usage;
                }
                const contentChunk = deltaRes.contentChunk;
                const reasoningChunk = deltaRes.reasoningChunk;

                if (contentChunk) {
                  if (ttftTime === undefined) {
                    ttftTime = Math.round(performance.now() - startTime);
                  }
                  accumulatedContent += contentChunk;
                }
                if (reasoningChunk) {
                  if (ttftTime === undefined) {
                    ttftTime = Math.round(performance.now() - startTime);
                  }
                  accumulatedReasoning += reasoningChunk;
                }

                if (contentChunk || reasoningChunk) {
                  updateActiveSessionMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? {
                            ...msg,
                            content: accumulatedContent,
                            reasoningContent: accumulatedReasoning || undefined,
                            metrics: {
                              statusCode: 200,
                              ttftMs: ttftTime,
                              latencyMs: Math.round(performance.now() - startTime),
                            },
                          }
                        : msg,
                    ),
                  );
                }
              } catch {
                // Ignore incomplete JSON chunks
              }
            }
          }

          if (buffer.trim().startsWith("data: ")) {
            const dataStr = buffer.trim().slice(6).trim();
            if (dataStr && dataStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(dataStr);
                const deltaRes = extractDeltaFromChunk(parsed);
                if (deltaRes.usage) streamUsage = deltaRes.usage;
                if (deltaRes.contentChunk) accumulatedContent += deltaRes.contentChunk;
                if (deltaRes.reasoningChunk) accumulatedReasoning += deltaRes.reasoningChunk;
              } catch {
                // ignore
              }
            }
          }
        }

        const totalLatency = Math.round(performance.now() - startTime);
        const estInTokens = streamUsage?.prompt_tokens ?? Math.max(1, Math.ceil(textToSend.length / 3));
        const estOutTokens = streamUsage?.completion_tokens ?? Math.max(1, Math.ceil(accumulatedContent.length / 3));
        const estTotalTokens = streamUsage?.total_tokens ?? (estInTokens + estOutTokens);
        const estTPS = totalLatency > 0 ? Number((estOutTokens / (totalLatency / 1000)).toFixed(1)) : 0;

        const metrics: MessageMetrics = {
          latencyMs: totalLatency,
          ttftMs: ttftTime ?? totalLatency,
          tokens: {
            input: estInTokens,
            output: estOutTokens,
            total: estTotalTokens,
          },
          tps: estTPS,
          statusCode: 200,
        };

        updateActiveSessionMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: accumulatedContent || "(空回复内容)",
                  reasoningContent: accumulatedReasoning || undefined,
                  metrics,
                  rawRequest: rawReqRecord,
                  rawResponse: {
                    type: "sse-stream",
                    chunks_count: rawChunks.length,
                    first_chunks: rawChunks.slice(0, 5).map((chunkStr) => {
                      try {
                        return JSON.parse(chunkStr);
                      } catch {
                        return chunkStr;
                      }
                    }),
                    final_content: accumulatedContent,
                    ...(streamUsage ? { usage: streamUsage } : {}),
                  },
                }
              : msg,
          ),
        );
      } else {
        // Non-stream mode
        const response = await fetch(endpointUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        const statusCode = response.status;
        if (!response.ok) {
          const errText = await response.text();
          let parsedError: unknown = null;
          try {
            parsedError = JSON.parse(errText);
          } catch {
            parsedError = null;
          }
          const customErr: ApiError = new Error(extractErrorMessage(parsedError, errText || response.statusText));
          customErr.statusCode = statusCode;
          customErr.payload = parsedError || { status: statusCode, error: errText || response.statusText };
          throw customErr;
        }

        const data = await response.json();
        const totalLatency = Math.round(performance.now() - startTime);
        const nonStreamRes = extractResponseFromData(data);
        const answer = nonStreamRes.content;
        const reasoning = nonStreamRes.reasoning;
        const streamUsageData = nonStreamRes.usage;

        const inTokens = streamUsageData?.prompt_tokens ?? Math.ceil(textToSend.length / 3);
        const outTokens = streamUsageData?.completion_tokens ?? Math.ceil(answer.length / 3);
        const totalTokens = streamUsageData?.total_tokens ?? (inTokens + outTokens);
        const calcTPS = totalLatency > 0 ? Number((outTokens / (totalLatency / 1000)).toFixed(1)) : 0;

        const metrics: MessageMetrics = {
          latencyMs: totalLatency,
          ttftMs: totalLatency,
          tokens: { input: inTokens, output: outTokens, total: totalTokens },
          tps: calcTPS,
          statusCode: 200,
        };

        updateActiveSessionMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: answer,
                  reasoningContent: reasoning,
                  metrics,
                  rawRequest: rawReqRecord,
                  rawResponse: data,
                }
              : msg,
          ),
        );
      }
    } catch (err: unknown) {
      const isAbort = (err as Error).name === "AbortError";
      const totalLatency = Math.round(performance.now() - startTime);
      if (isAbort) {
        toast.info(t("playground.stopped"));
        const outTok = Math.max(1, Math.ceil(accumulatedContent.length / 3));
        updateActiveSessionMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: accumulatedContent ? `${accumulatedContent}\n\n[已手动终止生成]` : "[已手动终止生成]",
                  reasoningContent: accumulatedReasoning || undefined,
                  metrics: {
                    latencyMs: totalLatency,
                    ttftMs: ttftTime ?? totalLatency,
                    tokens: {
                      input: Math.max(1, Math.ceil(textToSend.length / 3)),
                      output: outTok,
                      total: Math.max(1, Math.ceil(textToSend.length / 3)) + outTok,
                    },
                    statusCode: 200,
                  },
                  rawRequest: rawReqRecord,
                  rawResponse: {
                    type: "sse-stream-aborted",
                    partial_content: accumulatedContent,
                    latencyMs: totalLatency,
                  },
                }
              : msg,
          ),
        );
      } else {
        const errObj = err as ApiError;
        const statusCode = typeof errObj?.statusCode === "number" ? errObj.statusCode : 500;
        const errorMsg = errObj?.message || String(err);
        toast.error(`调用失败: ${errorMsg}`);

        const responsePayload =
          errObj?.payload ||
          (normalizePayloadForDisplay(errorMsg) as Record<string, unknown>) ||
          { error: errorMsg };

        updateActiveSessionMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: `⚠️ API 请求异常 (${statusCode}): ${errorMsg}\n\n排查建议：\n1. 检查凭据与供应商列表，确认是否配置了对应上游模型\n2. 检查访问密钥或管理密钥是否具有代理权限\n3. 查看请求日志与运行日志获取详细 upstream 诊断信息`,
                  error: errorMsg,
                  metrics: { latencyMs: totalLatency, statusCode },
                  rawRequest: rawReqRecord,
                  rawResponse: responsePayload,
                }
              : msg,
          ),
        );
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Filter sessions
  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(sessionSearch.toLowerCase()),
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-4 overflow-hidden pb-14 sm:-m-6 md:-m-8 md:pb-0">
      {/* ---------------------------------------------------------------- Column 1: Test Sessions Manager */}
      {mobileSessionsOpen && (
        <div
          className="fixed inset-0 z-40 animate-in fade-in duration-200 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileSessionsOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 overflow-hidden transition-transform duration-200 ease-in-out",
          "lg:static lg:z-auto lg:shrink-0 lg:translate-x-0 lg:transition-[width]",
          mobileSessionsOpen ? "translate-x-0" : "-translate-x-full",
          sidebarCollapsed ? "lg:w-0" : "lg:w-64",
        )}
      >
        <div className="flex h-full w-64 flex-col border-r border-slate-200/60 bg-slate-50 select-none dark:border-slate-800/60 dark:bg-slate-950 lg:bg-slate-50/50 lg:dark:bg-slate-950/40">
          {/* Header & Add Button */}
          <div className="flex items-center justify-between p-3 border-b border-slate-200/60 dark:border-slate-800/60">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-blue-600 dark:text-blue-400" />
              <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{t("playground.sessions")}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleCreateSession}
                title={t("playground.newSession")}
                className="size-7 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-400"
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setMobileSessionsOpen(false)}
                title="关闭"
                className="flex lg:hidden size-7 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Search bar */}
          <div className="p-2.5 pb-1">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-slate-400" />
              <Input
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder={t("playground.searchSessions")}
                className="h-7.5 rounded-xl pl-7.5 text-xs bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
              />
            </div>
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredSessions.map((session) => {
              const active = session.id === activeSessionId;
              const isEditing = editingSessionId === session.id;
              return (
                <div
                  key={session.id}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setSelectedModel(session.model || selectedModel);
                    setMobileSessionsOpen(false);
                  }}
                  className={cn(
                    "group relative flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs transition-all",
                    active
                      ? "bg-blue-600 text-white shadow-xs font-semibold"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60",
                  )}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingTitle}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleRenameSession(session.id, editingTitle)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSession(session.id, editingTitle);
                          if (e.key === "Escape") setEditingSessionId(null);
                        }}
                        className="w-full rounded bg-white px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-slate-100"
                      />
                    ) : (
                      <>
                        <div className="truncate">{session.title}</div>
                        <div className={cn("text-[10px] font-mono font-normal mt-0.5 truncate", active ? "text-blue-100" : "text-slate-400")}>
                          {session.model} · {session.messages.length} 条消息
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSessionId(session.id);
                          setEditingTitle(session.title);
                        }}
                        className={cn(
                          "size-5 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition",
                          active ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-blue-500",
                        )}
                        title="重命名会话"
                      >
                        <Pencil className="size-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      className={cn(
                        "size-5 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition",
                        active ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-rose-500",
                      )}
                      title="删除会话"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer info */}
          <div className="border-t border-slate-200/60 p-2.5 dark:border-slate-800/60 text-[10px] text-slate-400 text-center font-mono">
            会话保存在本地缓存
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- Column 2: Active Chat & Control Area */}
      <div className="flex flex-1 flex-col overflow-hidden bg-white/40 dark:bg-slate-900/40">
        {/* Playground Top Bar */}
        <div className="flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-4 py-2.5 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setMobileSessionsOpen(true)}
                  className="flex lg:hidden size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  aria-label="打开会话列表"
                >
                  <PanelLeftOpen className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">会话列表</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="hidden lg:flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  aria-label={sidebarCollapsed ? "展开会话栏" : "收起会话栏"}
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{sidebarCollapsed ? "展开会话栏" : "收起会话栏"}</TooltipContent>
            </Tooltip>

            {/* Model Selector Dropdown */}
            <DropdownMenu
              open={modelDropdownOpen}
              onOpenChange={(open) => {
                setModelDropdownOpen(open);
                if (!open) setModelSearch("");
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl text-xs font-mono border-slate-200 dark:border-slate-700">
                  <Zap className="size-3 text-amber-500" />
                  <span className="font-semibold">{selectedModel}</span>
                  <ChevronDown className="size-3 text-slate-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 sm:w-96 rounded-2xl p-0 shadow-xl overflow-hidden">
                {/* Search Bar Header */}
                <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                  <div className="relative flex items-center">
                    <Search className="absolute left-2.5 size-3.5 text-slate-400 pointer-events-none" />
                    <Input
                      autoFocus
                      placeholder="搜索模型名称或厂商 (如 gpt, codex, ag/)..."
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const trimmed = modelSearch.trim();
                          if (!trimmed) return;
                          const firstMatch = filteredModels[0];
                          if (firstMatch) {
                            handleSelectModel(firstMatch.id);
                          } else {
                            handleSelectModel(trimmed);
                          }
                          setModelDropdownOpen(false);
                          setModelSearch("");
                        }
                      }}
                      className="h-8 pl-8 pr-7 text-xs font-mono rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus-visible:ring-1"
                    />
                    {modelSearch && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModelSearch("");
                        }}
                        className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 px-0.5 text-[10px] text-slate-400">
                    <span>选择测试模型</span>
                    <span>{filteredModels.length} / {modelOptions.length} 个模型</span>
                  </div>
                </div>

                {/* Custom Model Quick Action when typed text does not match an existing model */}
                {modelSearch.trim() && !modelOptions.some((m) => m.id.toLowerCase() === modelSearch.trim().toLowerCase()) && (
                  <div className="p-1.5 border-b border-slate-100 dark:border-slate-800 bg-blue-50/40 dark:bg-blue-950/20">
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectModel(modelSearch.trim());
                        setModelDropdownOpen(false);
                        setModelSearch("");
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-mono rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-300 transition-colors"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <Plus className="size-3 shrink-0" />
                        <span>使用自定义模型: <strong className="font-semibold">{modelSearch.trim()}</strong></span>
                      </span>
                      <Badge variant="outline" className="text-[10px] shrink-0 border-blue-300 dark:border-blue-700">
                        Enter ↵
                      </Badge>
                    </button>
                  </div>
                )}

                {/* Scrollable Model List */}
                <div className="max-h-80 overflow-y-auto p-1 space-y-0.5">
                  {filteredModels.length === 0 ? (
                    <div className="py-6 px-4 text-center text-xs text-slate-400">
                      <p>未找到匹配的模型</p>
                      {modelSearch.trim() && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 text-xs font-mono h-7"
                          onClick={() => {
                            handleSelectModel(modelSearch.trim());
                            setModelDropdownOpen(false);
                            setModelSearch("");
                          }}
                        >
                          使用 "{modelSearch.trim()}" 作为自定义模型
                        </Button>
                      )}
                    </div>
                  ) : (
                    filteredModels.map((item) => {
                      const isSelected = item.id === selectedModel;
                      return (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() => {
                            handleSelectModel(item.id);
                            setModelDropdownOpen(false);
                            setModelSearch("");
                          }}
                          className={cn(
                            "flex items-center justify-between text-xs font-mono py-1.5 px-2.5 rounded-xl cursor-pointer transition-colors",
                            isSelected && "bg-slate-100 font-medium dark:bg-slate-800/80",
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isSelected ? (
                              <Check className="size-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                            ) : (
                              <div className="size-3.5 shrink-0" />
                            )}
                            <span className="truncate">{item.id}</span>
                          </div>
                          <Badge variant="secondary" className="text-[9px] font-normal shrink-0 ml-2">
                            {item.provider}
                          </Badge>
                        </DropdownMenuItem>
                      );
                    })
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Status Indicator */}
            {!rightPanelTab && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 pl-1 font-mono">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {PROTOCOL_OPTIONS.find((p) => p.id === activeProtocol)?.badge}
                </span>
                <span className="text-slate-400">
                  {getProtocolEndpoint(activeProtocol, selectedModel, stream)}
                </span>
              </div>
            )}
          </div>

          {/* Action Tools (System Prompt, Parameters, Inspector, Clear) */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setContextProberOpen(true)}
              className="h-8 gap-1.5 rounded-xl text-xs border-blue-200 bg-blue-50/50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 font-medium"
              title="最大上下文探测 (Context Prober)"
            >
              <Gauge className="size-3.5" />
              <span className="hidden sm:inline">上下文探测</span>
            </Button>

            <Button
              variant={systemPromptExpanded ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSystemPromptExpanded(!systemPromptExpanded)}
              className="h-8 gap-1 rounded-xl text-xs"
              title={t("playground.systemPrompt")}
            >
              <Sliders className="size-3.5" />
              <span className="hidden sm:inline">System Prompt</span>
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={rightPanelTab ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => {
                    if (!rightPanelTab) setMobileSessionsOpen(false);
                    setRightPanelTab(rightPanelTab ? null : lastPanelTab);
                  }}
                  className="size-8 rounded-xl"
                  aria-label={t("playground.panel")}
                >
                  <Settings2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("playground.panel")}</TooltipContent>
            </Tooltip>

            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={() => {
                setEditingMsgId(null);
                updateActiveSessionMessages(() => []);
              }}
              title={t("playground.clear")}
            >
              <Eraser className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* System Prompt Collapsible Card */}
        {systemPromptExpanded && (
          <div className="border-b border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800/80 dark:bg-slate-950/60 animate-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                系统提示词 (System Prompt Instructions)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {systemPrompt.length} 字符
              </span>
            </div>
            <textarea
              rows={2}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="输入系统提示词，例如：You are an expert full-stack engineer..."
              className="w-full rounded-xl border border-slate-200 bg-white p-2 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>
        )}

        {/* Message Feed Area */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {activeSession.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center max-w-xl mx-auto px-4">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm dark:bg-blue-950/60 dark:text-blue-400 mb-3">
                <Terminal className="size-7" />
              </div>

              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                CLIProxyAPI · 接口调试测控台
              </h3>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                向当前网关后端真实发起 <code className="font-mono text-blue-600 dark:text-blue-400 font-semibold">{getProtocolEndpoint(activeProtocol, selectedModel, stream)}</code> 请求，实时检验流式吞吐、首字延迟 (TTFT) 与模型推理质量。
              </p>

              {/* Preset Quick Prompts */}
              <div className="mt-6 w-full space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left pl-1">
                  快速场景预设
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                  {PRESET_PROMPTS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleSend(item.prompt)}
                      className="group flex flex-col rounded-2xl border border-slate-200/80 bg-white/80 p-3 text-xs shadow-xs transition hover:border-blue-400 hover:bg-blue-50/40 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:hover:bg-slate-800"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-800 group-hover:text-blue-600 dark:text-slate-200 dark:group-hover:text-blue-400">
                          {item.label}
                        </span>
                        <Badge variant="outline" className="text-[9px] font-normal border-slate-200 dark:border-slate-700">
                          {item.tag}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2">
                        {item.prompt}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="pt-1 text-left">
                  <button
                    type="button"
                    onClick={() => setContextProberOpen(true)}
                    className="flex items-center justify-between p-3 rounded-2xl border border-blue-200/70 hover:border-blue-400 bg-blue-50/40 hover:bg-blue-50/80 text-left transition-all dark:border-blue-900/50 dark:hover:border-blue-800 dark:bg-blue-950/20 w-full group cursor-pointer shadow-2xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 dark:text-blue-200">
                        <Gauge className="size-3.5 text-blue-600 dark:text-blue-400" />
                        <span>最大上下文与防静默截断探测 (Context Prober)</span>
                        <Badge variant="outline" className="text-[9px] font-mono border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300">
                          64k / 256k / 500k / 1M
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        单次精准发送目标容量，验证上游真实窗口上限与防截断 PIN，载荷可直接导入复用前缀缓存
                      </p>
                    </div>
                    <ArrowUp className="size-4 text-blue-500 rotate-45 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            activeSession.messages.map((msg) => {
              const isUser = msg.role === "user";
              const isEditing = editingMsgId === msg.id;
              return (
                <div
                  key={msg.id}
                  className={`group relative flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} items-start`}
                >
                  {/* Role Avatar */}
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold select-none",
                      isUser
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
                    )}
                  >
                    {isUser ? "U" : <Zap className="size-4 text-amber-500" />}
                  </div>

                  {/* Bubble Container */}
                  <div
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[88%] sm:max-w-[80%] ${
                      isEditing ? "w-full" : ""
                    }`}
                  >
                    {/* Header info */}
                    <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-slate-400 font-mono">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {isUser ? "User" : (msg.model || selectedModel)}
                      </span>
                      <span>{dayjs(msg.timestamp).format("HH:mm:ss")}</span>
                    </div>

                    {/* Reasoning Block if present (DeepSeek-R1 / o1 thinking) */}
                    {msg.reasoningContent && (
                      <div className="mb-2 w-full rounded-2xl border border-purple-200/80 bg-purple-50/60 p-3 text-xs text-purple-900 dark:border-purple-900/50 dark:bg-purple-950/30 dark:text-purple-200">
                        <div className="flex items-center gap-1.5 font-semibold text-[11px] text-purple-700 dark:text-purple-300 mb-1">
                          <Brain className="size-3.5" />
                          <span>思考链过程 (Reasoning Process)</span>
                        </div>
                        <MarkdownViewer
                          content={msg.reasoningContent}
                          className="opacity-90 text-[11px]"
                        />
                      </div>
                    )}

                    {/* Content Bubble or Inline Editor */}
                    {isEditing ? (
                      <div className="w-full min-w-[280px] sm:min-w-[420px] rounded-2xl border border-blue-400 bg-white p-3 shadow-md dark:border-blue-600 dark:bg-slate-900 text-left">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingMsgId(null);
                            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              if (isUser) {
                                void handleConfirmResend(msg.id, editingContent);
                              } else {
                                handleSaveEditOnly(msg.id, editingContent);
                              }
                            }
                          }}
                          rows={Math.min(10, Math.max(3, editingContent.split("\n").length))}
                          className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 font-sans leading-relaxed"
                          placeholder="输入编辑后的内容..."
                          autoFocus
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">
                            {isUser
                              ? t("playground.editHint", "Ctrl+Enter 回退重发 · Esc 取消")
                              : "Ctrl+Enter 保存 · Esc 取消"}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => setEditingMsgId(null)}
                            >
                              {t("common.cancel", "取消")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => handleSaveEditOnly(msg.id, editingContent)}
                            >
                              {t("playground.saveOnly", "仅保存")}
                            </Button>
                            {isUser && (
                              <Button
                                type="button"
                                size="sm"
                                disabled={loading}
                                className="h-7 px-2.5 text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                onClick={() => void handleConfirmResend(msg.id, editingContent)}
                              >
                                <RotateCw className="mr-1 size-3" />
                                {t("playground.saveAndResend", "回退重发")}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs transition break-words max-w-full",
                            isUser
                              ? "bg-blue-600 text-white selection:bg-blue-800 selection:text-white"
                              : "border border-slate-200/80 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200",
                          )}
                        >
                          {isUser ? (
                            <>
                              {msg.images && msg.images.length > 0 ? (
                                <div className="mb-2 flex flex-wrap gap-1.5">
                                  {msg.images.map((img, imgIdx) => (
                                    <img
                                      key={imgIdx}
                                      src={img}
                                      alt="attachment"
                                      className="size-16 sm:size-20 rounded-lg object-cover border border-white/20 shadow-xs cursor-pointer hover:opacity-90 transition"
                                      onClick={() => window.open(img, "_blank")}
                                    />
                                  ))}
                                </div>
                              ) : null}
                              <p className="whitespace-pre-wrap font-sans">{msg.content}</p>
                            </>
                          ) : (
                            <MarkdownViewer
                              content={msg.content || (loading ? "正在连接上游网关并实时接收推理数据..." : "")}
                            />
                          )}
                        </div>

                        {/* User Message Action Bar */}
                        {isUser && (
                          <div className="mt-1 flex items-center gap-1 px-1 text-[11px] text-slate-400 opacity-80 sm:opacity-0 group-hover:opacity-100 transition">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMsgId(msg.id);
                                setEditingContent(msg.content);
                              }}
                              disabled={loading}
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition disabled:opacity-40"
                              title={t("playground.editMessage", "编辑")}
                            >
                              <Pencil className="size-3" />
                              <span>{t("playground.editMessage", "编辑")}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.content, `msg-${msg.id}`)}
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition"
                              title="复制内容"
                            >
                              {copiedKey === `msg-${msg.id}` ? (
                                <Check className="size-3 text-emerald-500" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                              <span>复制</span>
                            </button>
                          </div>
                        )}

                        {/* Assistant Metrics & Action Bar */}
                        {!isUser && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1 text-[11px] text-slate-400 font-mono">
                            {msg.metrics?.latencyMs !== undefined && (
                              <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                                <Activity className="size-3" />
                                {formatDuration(msg.metrics.latencyMs)}
                              </span>
                            )}

                            {msg.metrics?.ttftMs !== undefined && (
                              <span className="text-slate-500">
                                TTFT: {msg.metrics.ttftMs}ms
                              </span>
                            )}

                            {msg.metrics?.tokens && (
                              <span>
                                Tokens: {msg.metrics.tokens.input}in / {msg.metrics.tokens.output}out
                                {msg.metrics.tps ? ` (${formatTPS(msg.metrics.tps)})` : ""}
                              </span>
                            )}

                            {/* Copy button */}
                            {Boolean(msg.content) && (
                              <button
                                type="button"
                                onClick={() => handleCopy(msg.content, `msg-${msg.id}`)}
                                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition"
                                title="复制内容"
                              >
                                {copiedKey === `msg-${msg.id}` ? (
                                  <Check className="size-3 text-emerald-500" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                                <span>复制</span>
                              </button>
                            )}

                            {/* Edit assistant message button */}
                            {Boolean(msg.content) && !loading && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMsgId(msg.id);
                                  setEditingContent(msg.content);
                                }}
                                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition"
                                title={t("playground.editMessage", "编辑")}
                              >
                                <Pencil className="size-3" />
                                <span>{t("playground.editMessage", "编辑")}</span>
                              </button>
                            )}

                            {/* Regenerate assistant message button */}
                            {!loading && (
                              <button
                                type="button"
                                onClick={() => handleRegenerate(msg.id)}
                                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/60 transition"
                                title={t("playground.regenerate", "重新生成")}
                              >
                                <RotateCw className="size-3" />
                                <span>{t("playground.regenerate", "重新生成")}</span>
                              </button>
                            )}

                            {/* View in Inspector button */}
                            {Boolean(msg.rawRequest || msg.rawResponse) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setInspectorMsgId(msg.id);
                                  setInspectorViewMode("snapshot");
                                  setRightPanelTab("inspector");
                                  setLastPanelTab("inspector");
                                }}
                                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/60 transition"
                                title="在 JSON Inspector 中查看"
                              >
                                <Code2 className="size-3" />
                                <span>Inspect</span>
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Real-time generating animation */}
          {loading && (
            <div className="flex gap-3 items-center">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Zap className="size-4 text-amber-500 animate-pulse" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-4 py-2 text-xs text-slate-500 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <span className="size-2 rounded-full bg-blue-500 animate-bounce" />
                <span className="size-2 rounded-full bg-blue-500 animate-bounce [animation-delay:0.2s]" />
                <span className="size-2 rounded-full bg-blue-500 animate-bounce [animation-delay:0.4s]" />
                <span className="ml-1 text-[11px] font-mono">流式生成中...</span>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- Input Bar */}
        <div className="border-t border-slate-200/70 bg-white/80 p-3 sm:p-4 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-900/80">
          {/* Image preview chips */}
          {inputImages.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {inputImages.map((img, idx) => (
                <div key={idx} className="relative group size-14 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 shadow-xs">
                  <img src={img} alt="preview" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setInputImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 transition cursor-pointer"
                    title="移除图片"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer?.files) handleImageUpload(e.dataTransfer.files);
            }}
            className="relative flex items-center rounded-2xl border border-slate-200/80 bg-slate-50/90 p-1.5 shadow-sm ring-1 ring-slate-100 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-slate-800 dark:bg-slate-950/70 dark:ring-slate-900"
          >
            {/* Image upload button */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleImageUpload(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
              onClick={() => fileInputRef.current?.click()}
              title="上传图片 (支持粘贴与拖拽)"
            >
              <ImagePlus className="size-4" />
            </Button>

            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={t("playground.inputPlaceholder")}
              className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-200 leading-relaxed font-sans"
            />

            {/* Stop or Send Button */}
            {loading ? (
              <Button
                size="icon"
                variant="destructive"
                className="size-8.5 rounded-xl shadow-xs"
                onClick={handleStop}
                title={t("playground.stop")}
              >
                <Pause className="size-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                disabled={!input.trim() && inputImages.length === 0}
                className="size-8.5 rounded-xl bg-blue-600 text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-30"
                onClick={() => handleSend()}
                title={t("playground.send")}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- Column 3: Parameters & JSON Inspector Pane */}
      {rightPanelTab && (
        <div
          className="fixed inset-0 z-40 animate-in fade-in duration-200 bg-slate-950/40 backdrop-blur-sm md:hidden"
          onClick={() => setRightPanelTab(null)}
          aria-hidden="true"
        />
      )}
      <div
        style={{
          width: rightPanelTab ? (isDesktop ? `${panelWidth}px` : undefined) : 0,
        }}
        className={cn(
          "fixed inset-y-0 right-0 z-50 overflow-hidden",
          !isDraggingPanel && "transition-[width,transform] duration-200 ease-in-out",
          "md:static md:z-auto md:shrink-0 md:translate-x-0",
          rightPanelTab ? "translate-x-0 w-80 max-w-[90vw] md:w-auto" : "translate-x-full w-0 md:w-0",
        )}
      >
        <div
          style={{
            width: isDesktop ? `${panelWidth}px` : undefined,
          }}
          className={cn(
            "relative flex h-full w-80 max-w-[90vw] md:w-auto flex-col border-l border-slate-200/70 bg-white/95 dark:border-slate-800/70 dark:bg-slate-900/95 backdrop-blur-xl",
            isDraggingPanel && "select-none",
          )}
        >
          {/* Left Resize Handle on Desktop */}
          {rightPanelTab && isDesktop && (
            <div
              onPointerDown={handlePanelResizeStart}
              className={cn(
                "absolute top-0 bottom-0 -left-1.5 w-3 cursor-col-resize z-50 flex items-center justify-center group/resizer select-none touch-none",
                isDraggingPanel && "cursor-col-resize",
              )}
              title="按住并左右拖动调整面板宽度"
            >
              <div
                className={cn(
                  "w-1 h-8 rounded-full bg-slate-300 dark:bg-slate-700 transition-all duration-150 group-hover/resizer:bg-blue-500 group-hover/resizer:h-16 group-hover/resizer:w-1.5",
                  isDraggingPanel && "bg-blue-600 h-28 w-1.5 shadow-sm",
                )}
              />
            </div>
          )}

          {/* Panel Header Tabs */}
          <div className="flex h-[53px] items-center justify-between border-b border-slate-200/70 px-3 dark:border-slate-800/70 shrink-0">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setRightPanelTab("params");
                  setLastPanelTab("params");
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition",
                  panelTab === "params"
                    ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
                )}
              >
                <Cpu className="size-3" />
                <span>{t("playground.params")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setRightPanelTab("inspector");
                  setLastPanelTab("inspector");
                  setInspectorViewMode("live");
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition",
                  panelTab === "inspector"
                    ? "bg-white text-purple-600 shadow-xs dark:bg-slate-900 dark:text-purple-400"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
                )}
              >
                <Code2 className="size-3" />
                <span>{t("playground.inspector")}</span>
              </button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-slate-400 hover:text-slate-600"
              onClick={() => setRightPanelTab(null)}
              title={t("common.close")}
            >
              <X className="size-3.5" />
            </Button>
          </div>

          {/* Tab Content: Parameters */}
          {panelTab === "params" && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 text-xs select-none">
              {/* Target Model Input */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">目标模型 (Model)</Label>
                <Input
                  value={selectedModel}
                  onChange={(e) => handleModelInputChange(e.target.value)}
                  placeholder="例如: gpt-4o, claude-3-7-sonnet..."
                  className="h-8 font-mono text-xs rounded-xl"
                />
                <p className="text-[10px] text-slate-400">
                  支持官方模型 ID 或 config.yaml 中配置的模型别名
                </p>
              </div>

              {/* API Protocol Selector */}
              <div className="space-y-1.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800/60 dark:bg-slate-950/40">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {t("playground.protocol", "接口协议 (API Protocol)")}
                  </span>
                  {manualProtocol ? (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px] font-normal border-amber-300 text-amber-600 dark:text-amber-400">
                        {t("playground.manualOverrideBadge", "手动指定")}
                      </Badge>
                      <button
                        type="button"
                        onClick={handleResetProtocol}
                        className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        {t("playground.resetToAuto", "恢复自动推断")}
                      </button>
                    </div>
                  ) : (
                    <Badge variant="secondary" className="text-[9px] font-normal bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400" title={inferred.reason}>
                      ⚡ {t("playground.autoInferBadge", "自动推断")}
                    </Badge>
                  )}
                </div>

                <Select
                  value={activeProtocol}
                  onValueChange={(val) => handleSelectProtocol(val as ApiProtocol)}
                >
                  <SelectTrigger className="h-8 w-full rounded-xl text-xs font-mono bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {PROTOCOL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id} className="text-xs font-mono cursor-pointer py-1.5">
                        <div className="flex flex-col gap-0.5 text-left">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{opt.label}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{opt.endpointTemplate}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p className="text-[10px] text-slate-400 leading-tight">
                  {manualProtocol ? "已手动切换请求协议格式" : `已根据模型与凭据推断: ${inferred.reason}`}
                </p>
              </div>

              {/* Context Window Prober Card */}
              <div className="flex items-center justify-between p-3 rounded-2xl border border-blue-200/80 bg-blue-50/40 dark:border-blue-900/60 dark:bg-blue-950/20">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-blue-900 dark:text-blue-200">
                    <Gauge className="size-3.5 text-blue-600 dark:text-blue-400" />
                    <span>最大上下文探测 (Prober)</span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    单次发送 64k/256k/500k/1M 验证上限与截断
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setContextProberOpen(true)}
                  className="h-7 text-xs px-2.5 rounded-xl border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/50 cursor-pointer"
                >
                  开始探测
                </Button>
              </div>

              {/* Reasoning Effort (思考等级) */}
              <div className="space-y-2 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800/70 dark:bg-slate-950/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-amber-500" />
                    <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                      {t("playground.reasoningEffort", "思考等级 (Reasoning Effort)")}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-mono px-1.5 py-0",
                      reasoningEffort === "off"
                        ? "text-slate-400 border-slate-200 dark:border-slate-800"
                        : "text-amber-600 border-amber-300 bg-amber-50/80 dark:text-amber-400 dark:border-amber-900/60 dark:bg-amber-950/30",
                    )}
                  >
                    {reasoningEffort === "off" ? "off" : reasoningEffort}
                  </Badge>
                </div>

                <Select
                  value={reasoningEffort}
                  onValueChange={(val) => setReasoningEffort(val as ReasoningEffortLevel)}
                >
                  <SelectTrigger className="h-8 w-full rounded-xl text-xs font-mono bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {REASONING_EFFORT_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.id}
                        value={opt.id}
                        className="text-xs font-mono cursor-pointer py-1.5"
                      >
                        <div className="flex items-center justify-between gap-3 w-full">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{opt.label}</span>
                          <span className="text-[10px] text-slate-400 font-sans">{opt.desc}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p className="text-[10px] text-slate-400 font-mono leading-tight">
                  {reasoningEffort === "off" ? (
                    <span>不发送思考参数 (使用模型默认)</span>
                  ) : (
                    <span>
                      注入: <code className="text-amber-600 dark:text-amber-400 font-semibold">{getReasoningInjectionPreview(activeProtocol, reasoningEffort)}</code>
                    </span>
                  )}
                </p>
              </div>

              {/* Temperature Slider */}
              <div
                className={cn(
                  "space-y-1.5 rounded-2xl border transition-all p-3",
                  enableTemperature
                    ? "border-blue-200/70 bg-blue-50/20 shadow-2xs dark:border-blue-900/50 dark:bg-blue-950/15"
                    : "border-slate-100 bg-slate-50/60 dark:border-slate-800/60 dark:bg-slate-950/40",
                )}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={enableTemperature}
                      onCheckedChange={setEnableTemperature}
                      className="scale-75 origin-left"
                    />
                    <span
                      className={cn(
                        "text-xs font-semibold transition-colors",
                        enableTemperature ? "text-slate-800 dark:text-slate-200" : "text-slate-500 dark:text-slate-400",
                      )}
                    >
                      {t("playground.temperature")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!enableTemperature && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {t("playground.paramDisabled", "不发送")}
                      </span>
                    )}
                    <span
                      className={cn(
                        "font-mono text-xs font-bold transition-colors",
                        enableTemperature ? "text-blue-600 dark:text-blue-400" : "text-slate-400 line-through opacity-60",
                      )}
                    >
                      {temperature}
                    </span>
                  </div>
                </div>
                <div
                  className={cn(
                    "transition-opacity duration-200",
                    enableTemperature ? "opacity-100" : "opacity-35 pointer-events-none select-none",
                  )}
                >
                  <Slider
                    value={[temperature]}
                    min={0}
                    max={2}
                    step={0.05}
                    onValueChange={(vals) => vals[0] !== undefined && setTemperature(vals[0])}
                    className="py-1"
                    disabled={!enableTemperature}
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>精确严谨 (0.0)</span>
                    <span>富有创意 (2.0)</span>
                  </div>
                </div>
              </div>

              {/* Max Tokens */}
              <div
                className={cn(
                  "space-y-1.5 rounded-2xl border transition-all p-3",
                  enableMaxTokens
                    ? "border-blue-200/70 bg-blue-50/20 shadow-2xs dark:border-blue-900/50 dark:bg-blue-950/15"
                    : "border-slate-100 bg-slate-50/60 dark:border-slate-800/60 dark:bg-slate-950/40",
                )}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={enableMaxTokens}
                      onCheckedChange={setEnableMaxTokens}
                      className="scale-75 origin-left"
                    />
                    <span
                      className={cn(
                        "text-xs font-semibold transition-colors",
                        enableMaxTokens ? "text-slate-800 dark:text-slate-200" : "text-slate-500 dark:text-slate-400",
                      )}
                    >
                      {t("playground.maxTokens")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!enableMaxTokens && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {t("playground.paramDisabled", "不发送")}
                      </span>
                    )}
                    <span
                      className={cn(
                        "font-mono text-xs font-bold transition-colors",
                        enableMaxTokens ? "text-blue-600 dark:text-blue-400" : "text-slate-400 line-through opacity-60",
                      )}
                    >
                      {maxTokens}
                    </span>
                  </div>
                </div>
                <div
                  className={cn(
                    "transition-opacity duration-200",
                    enableMaxTokens ? "opacity-100" : "opacity-35 pointer-events-none select-none",
                  )}
                >
                  <Slider
                    value={[maxTokens]}
                    min={128}
                    max={16384}
                    step={128}
                    onValueChange={(vals) => vals[0] !== undefined && setMaxTokens(vals[0])}
                    className="py-1"
                    disabled={!enableMaxTokens}
                  />
                </div>
              </div>

              {/* Top P */}
              <div
                className={cn(
                  "space-y-1.5 rounded-2xl border transition-all p-3",
                  enableTopP
                    ? "border-blue-200/70 bg-blue-50/20 shadow-2xs dark:border-blue-900/50 dark:bg-blue-950/15"
                    : "border-slate-100 bg-slate-50/60 dark:border-slate-800/60 dark:bg-slate-950/40",
                )}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={enableTopP}
                      onCheckedChange={setEnableTopP}
                      className="scale-75 origin-left"
                    />
                    <span
                      className={cn(
                        "text-xs font-semibold transition-colors",
                        enableTopP ? "text-slate-800 dark:text-slate-200" : "text-slate-500 dark:text-slate-400",
                      )}
                    >
                      {t("playground.topP")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!enableTopP && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {t("playground.paramDisabled", "不发送")}
                      </span>
                    )}
                    <span
                      className={cn(
                        "font-mono text-xs font-bold transition-colors",
                        enableTopP ? "text-blue-600 dark:text-blue-400" : "text-slate-400 line-through opacity-60",
                      )}
                    >
                      {topP}
                    </span>
                  </div>
                </div>
                <div
                  className={cn(
                    "transition-opacity duration-200",
                    enableTopP ? "opacity-100" : "opacity-35 pointer-events-none select-none",
                  )}
                >
                  <Slider
                    value={[topP]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(vals) => vals[0] !== undefined && setTopP(vals[0])}
                    className="py-1"
                    disabled={!enableTopP}
                  />
                </div>
              </div>

              {/* Stream Switch */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800/60 dark:bg-slate-950/40">
                <div>
                  <span className="font-semibold block text-slate-700 dark:text-slate-300">{t("playground.stream")}</span>
                  <span className="text-[10px] text-slate-400">通过 Server-Sent Events 流式传输</span>
                </div>
                <Switch checked={stream} onCheckedChange={setStream} />
              </div>

              {/* Client API Key override */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">客户端 API Key (可选)</Label>
                <Input
                  type="password"
                  value={clientApiKey}
                  onChange={(e) => setClientApiKey(e.target.value)}
                  placeholder="留空自动使用当前控制台管理密钥"
                  className="h-8 font-mono text-xs rounded-xl"
                />
                <p className="text-[10px] text-slate-400">
                  用于模拟下游应用带 Key 访问，测试 API Key 权限策略
                </p>
              </div>

              {/* Custom Headers and Body Parameters */}
              <CustomParamsSection
                protocol={activeProtocol}
                customHeaders={customHeaders}
                setCustomHeaders={setCustomHeaders}
                customBodyFields={customBodyFields}
                setCustomBodyFields={setCustomBodyFields}
              />
            </div>
          )}

          {/* Tab Content: JSON Inspector */}
          {panelTab === "inspector" && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
              {/* Request JSON Section (Live Assembled by Default) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                      Request Payload
                    </span>
                    {inspectedMessage?.rawRequest ? (
                      <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-100 dark:bg-slate-900 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setInspectorViewMode("live")}
                          className={cn(
                            "px-2 py-0.5 rounded-md font-medium transition cursor-pointer",
                            inspectorViewMode === "live"
                              ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-2xs font-semibold"
                              : "text-slate-500 hover:text-slate-700 dark:text-slate-400",
                          )}
                        >
                          ● 实时组装 (Live)
                        </button>
                        <button
                          type="button"
                          onClick={() => setInspectorViewMode("snapshot")}
                          className={cn(
                            "px-2 py-0.5 rounded-md font-medium transition cursor-pointer",
                            inspectorViewMode === "snapshot"
                              ? "bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-2xs font-semibold"
                              : "text-slate-500 hover:text-slate-700 dark:text-slate-400",
                          )}
                        >
                          历史快照 (Snapshot)
                        </button>
                      </div>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-mono px-1.5 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                      >
                        ● 实时组装 (Live)
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const isSnapshot = inspectorViewMode === "snapshot" && Boolean(inspectedMessage?.rawRequest);
                        const reqToCopy = isSnapshot
                          ? {
                              endpointPath: inspectedMessage!.rawRequest!.url.replace(/^POST\s+/, ""),
                              headers: inspectedMessage!.rawRequest!.headers,
                              body: inspectedMessage!.rawRequest!.body as Record<string, unknown>,
                            }
                          : {
                              endpointPath: liveRequest.endpointPath,
                              headers: liveRequest.headers,
                              body: liveRequest.body,
                            };
                        const snippet = generateCurlSnippet(reqToCopy);
                        handleCopy(snippet, "req-curl");
                      }}
                      className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium cursor-pointer"
                      title="复制完整 cURL 命令行"
                    >
                      {copiedKey === "req-curl" ? <Check className="size-3 text-emerald-500" /> : <Terminal className="size-3" />}
                      <span>复制 cURL</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          formatJsonForDisplay(
                            inspectorViewMode === "snapshot" && inspectedMessage?.rawRequest
                              ? inspectedMessage.rawRequest
                              : {
                                  url: `POST ${liveRequest.endpointPath}`,
                                  headers: liveRequest.displayHeaders,
                                  body: liveRequest.body,
                                },
                          ),
                          "req-json",
                        )
                      }
                      className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium cursor-pointer"
                    >
                      {copiedKey === "req-json" ? <Check className="size-3" /> : <Copy className="size-3" />}
                      <span>复制请求 JSON</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-72">
                  <pre className="leading-relaxed whitespace-pre font-mono">
                    {renderJsonHighlighted(
                      formatJsonForDisplay(
                        inspectorViewMode === "snapshot" && inspectedMessage?.rawRequest
                          ? inspectedMessage.rawRequest
                          : {
                              url: `POST ${liveRequest.endpointPath}`,
                              headers: liveRequest.displayHeaders,
                              body: liveRequest.body,
                            },
                      ),
                    )}
                  </pre>
                </div>
                <p className="text-[10px] text-slate-400">
                  {inspectorViewMode === "snapshot"
                    ? "显示该消息被发送时的历史原始请求快照"
                    : "根据右侧参数面板与会话实时组装，点击发送时将完全以此报文为准"}
                </p>
              </div>

              {/* Response JSON Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                      Response Payload
                    </span>
                    {inspectedMessage?.metrics?.statusCode && (
                      <Badge
                        variant={inspectedMessage.metrics.statusCode === 200 ? "default" : "destructive"}
                        className="text-[9px] font-mono px-1.5"
                      >
                        {inspectedMessage.metrics.statusCode}
                      </Badge>
                    )}
                  </div>
                  {Boolean(inspectedMessage?.rawResponse) && (
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          formatJsonForDisplay(inspectedMessage?.rawResponse),
                          "res-json",
                        )
                      }
                      className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-medium cursor-pointer"
                    >
                      {copiedKey === "res-json" ? <Check className="size-3" /> : <Copy className="size-3" />}
                      <span>复制响应 JSON</span>
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-64">
                  {inspectedMessage?.rawResponse ? (
                    <pre className="leading-relaxed whitespace-pre font-mono">
                      {renderJsonHighlighted(formatJsonForDisplay(inspectedMessage.rawResponse))}
                    </pre>
                  ) : (
                    <div className="text-slate-500 italic py-6 text-center text-xs">
                      等待发送请求... 点击「发送」按钮后将在此实时透视真实响应报文与指标
                    </div>
                  )}
                </div>
              </div>

              {/* Metrics Summary Table */}
              {inspectedMessage?.metrics && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60 space-y-1 text-[11px] font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">总响应耗时 (Latency):</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {inspectedMessage.metrics.latencyMs} ms
                    </span>
                  </div>
                  {inspectedMessage.metrics.ttftMs !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">首字生成时间 (TTFT):</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {inspectedMessage.metrics.ttftMs} ms
                      </span>
                    </div>
                  )}
                  {inspectedMessage.metrics.tokens && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Token 消耗 (Prompt / Completion):</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {inspectedMessage.metrics.tokens.input} / {inspectedMessage.metrics.tokens.output}
                      </span>
                    </div>
                  )}
                  {inspectedMessage.metrics.tps ? (
                    <div className="flex justify-between">
                      <span className="text-slate-400">平均生成速率 (TPS):</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {inspectedMessage.metrics.tps} tok/s
                      </span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ContextProberModal
        isOpen={contextProberOpen}
        onClose={() => setContextProberOpen(false)}
        model={selectedModel}
        protocol={activeProtocol}
        stream={stream}
        enableTemperature={enableTemperature}
        temperature={temperature}
        enableMaxTokens={enableMaxTokens}
        maxTokens={maxTokens}
        enableTopP={enableTopP}
        topP={topP}
        reasoningEffort={reasoningEffort}
        customHeaders={customHeaders}
        customBodyFields={customBodyFields}
        clientApiKey={clientApiKey}
        managementKey={currentKey() || undefined}
        onSaveToSession={handleSaveProbeToSession}
      />
    </div>
  );
}
