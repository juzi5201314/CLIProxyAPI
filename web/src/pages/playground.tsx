import { useEffect, useRef, useState } from "react";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ALL_KINDS, type Entry } from "@/components/providers/provider-tools";
import { MarkdownViewer } from "@/components/shared/markdown-viewer";
import { providerLists } from "@/api/management";
import { currentKey } from "@/stores/auth";
import { dayjs, formatDuration, formatTPS } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------- Types

interface MessageMetrics {
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

interface PlaygroundMessage {
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
  createdAt: number;
  messages: PlaygroundMessage[];
}

interface ModelItem {
  id: string;
  provider: string;
}

// ---------------------------------------------------------------- Default Data

const STORAGE_KEY = "cpa-playground-sessions-v2";

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
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [topP, setTopP] = useState(1.0);
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful and concise AI assistant.");
  const [selectedModel, setSelectedModel] = useState<string>(activeSession.model || "gpt-4o");
  const [customModelInput, setCustomModelInput] = useState("");
  const [clientApiKey, setClientApiKey] = useState<string>("");

  // Panels & Tabs
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"params" | "inspector" | null>("params");
  const [lastPanelTab, setLastPanelTab] = useState<"params" | "inspector">("params");
  const panelTab = rightPanelTab ?? lastPanelTab;
  const [inspectorMsgId, setInspectorMsgId] = useState<string | null>(null);
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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

  // Reset message editing when session switches
  useEffect(() => {
    setEditingMsgId(null);
  }, [activeSessionId]);

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

    // 1. From /v1/models
    for (const item of modelsApiQuery.data ?? []) {
      addModel(item.id, item.provider);
    }

    // 2. From provider lists
    const data = providersQuery.data ?? {};
    for (const [kindId, entries] of Object.entries(data)) {
      for (const entry of entries) {
        const providerName = String(entry.name || entry.prefix || kindId);
        const models = (entry.models as { name?: string; alias?: string }[] | undefined) ?? [];
        for (const m of models) {
          if (m.alias) addModel(m.alias, providerName);
          if (m.name) addModel(m.name, providerName);
        }
      }
    }

    // 3. Append standard popular models if not yet in list
    for (const item of POPULAR_MODELS) {
      addModel(item.id, item.provider);
    }

    setModelOptions(list);
  }, [modelsApiQuery.data, providersQuery.data]);

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
    setSessions((currentSessions) =>
      currentSessions.map((s) => (s.id === activeSessionId ? { ...s, model: clean } : s)),
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
      return m.content;
    };

    // Assemble OpenAI-standard chat payload, excluding empty or errored entries
    const validHistory = baseHistory
      .filter((m) => !m.error && (m.content.trim().length > 0 || (m.images && m.images.length > 0)) && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: buildContent(m) }));

    const userPayloadContent =
      imagesToSend.length > 0
        ? [
            ...(textToSend.trim() ? [{ type: "text", text: textToSend }] : [{ type: "text", text: " " }]),
            ...imagesToSend.map((img) => ({ type: "image_url", image_url: { url: img } })),
          ]
        : textToSend;

    const messagesPayload = [
      ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt.trim() }] : []),
      ...validHistory,
      { role: "user", content: userPayloadContent },
    ];

    const requestPayload = {
      model: targetModel,
      messages: messagesPayload,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream,
    };

    const authKey = clientApiKey.trim() || currentKey() || "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authKey) {
      headers["Authorization"] = `Bearer ${authKey}`;
    }

    const endpointUrl = `${window.location.origin}/v1/chat/completions`;
    const startTime = performance.now();
    let ttftTime: number | undefined = undefined;

    const rawReqRecord = {
      url: "POST /v1/chat/completions",
      headers: {
        ...headers,
        ...(authKey ? { Authorization: `Bearer ${authKey.slice(0, 8)}...` } : {}),
      },
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
          throw new Error(`[HTTP ${statusCode}] ${errText || response.statusText}`);
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
                if (parsed.usage) {
                  streamUsage = parsed.usage;
                }
                const delta = parsed.choices?.[0]?.delta;
                if (delta) {
                  const contentChunk = delta.content || "";
                  const reasoningChunk = delta.reasoning_content || delta.reasoning || delta.thought || "";

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
                if (parsed.usage) streamUsage = parsed.usage;
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) accumulatedContent += delta.content;
                if (delta?.reasoning_content) accumulatedReasoning += delta.reasoning_content;
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
                    first_chunks: rawChunks.slice(0, 5),
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
          throw new Error(`[HTTP ${statusCode}] ${errText || response.statusText}`);
        }

        const data = await response.json();
        const totalLatency = Math.round(performance.now() - startTime);
        const answer = data.choices?.[0]?.message?.content || "(无回复内容)";
        const reasoning = data.choices?.[0]?.message?.reasoning_content || undefined;

        const inTokens = data.usage?.prompt_tokens ?? Math.ceil(textToSend.length / 3);
        const outTokens = data.usage?.completion_tokens ?? Math.ceil(answer.length / 3);
        const totalTokens = data.usage?.total_tokens ?? (inTokens + outTokens);
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
        const errorMsg = (err as Error).message || String(err);
        toast.error(`调用失败: ${errorMsg}`);

        updateActiveSessionMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: `⚠️ API 请求异常: ${errorMsg}\n\n排查建议：\n1. 检查凭据与供应商列表，确认是否配置了对应上游模型\n2. 检查访问密钥或管理密钥是否具有代理权限\n3. 查看请求日志与运行日志获取详细 upstream 诊断信息`,
                  error: errorMsg,
                  metrics: { latencyMs: totalLatency, statusCode: 500 },
                  rawRequest: rawReqRecord,
                  rawResponse: { error: errorMsg },
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
      <div
        className={cn(
          "hidden lg:flex shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
          sidebarCollapsed ? "w-0" : "w-64",
        )}
      >
        <div className="flex w-64 flex-col border-r border-slate-200/60 bg-slate-50/50 dark:border-slate-800/60 dark:bg-slate-950/40 select-none">
          {/* Header & Add Button */}
          <div className="flex items-center justify-between p-3 border-b border-slate-200/60 dark:border-slate-800/60">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-blue-600 dark:text-blue-400" />
              <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{t("playground.sessions")}</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleCreateSession}
              title={t("playground.newSession")}
              className="size-7 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-400"
            >
              <Plus className="size-3.5" />
            </Button>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl text-xs font-mono border-slate-200 dark:border-slate-700">
                  <Zap className="size-3 text-amber-500" />
                  <span className="font-semibold">{selectedModel}</span>
                  <ChevronDown className="size-3 text-slate-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto rounded-2xl p-1.5">
                <DropdownMenuLabel className="text-[10px] text-slate-400 uppercase tracking-wider px-2 py-1">
                  选择测试模型
                </DropdownMenuLabel>
                <div className="p-1">
                  <Input
                    placeholder="输入自定义模型名..."
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customModelInput.trim()) {
                        handleSelectModel(customModelInput.trim());
                        setCustomModelInput("");
                      }
                    }}
                    className="h-7 text-xs font-mono rounded-lg mb-1"
                  />
                  {customModelInput.trim() && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full h-6 text-[10px] mb-1"
                      onClick={() => {
                        handleSelectModel(customModelInput.trim());
                        setCustomModelInput("");
                      }}
                    >
                      使用自定义: {customModelInput.trim()}
                    </Button>
                  )}
                </div>
                <DropdownMenuSeparator />
                {modelOptions.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onClick={() => handleSelectModel(item.id)}
                    className="flex items-center justify-between text-xs font-mono py-1.5 rounded-xl cursor-pointer"
                  >
                    <span>{item.id}</span>
                    <Badge variant="secondary" className="text-[9px] font-normal">
                      {item.provider}
                    </Badge>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Status Indicator */}
            {!rightPanelTab && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 pl-1 font-mono">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span>/v1/chat/completions</span>
              </div>
            )}
          </div>

          {/* Action Tools (System Prompt, Parameters, Inspector, Clear) */}
          <div className="flex items-center gap-1.5">
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
                  onClick={() => setRightPanelTab(rightPanelTab ? null : lastPanelTab)}
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
                向当前网关后端真实发起 <code className="font-mono text-blue-600 dark:text-blue-400 font-semibold">/v1/chat/completions</code> 请求，实时检验流式吞吐、首字延迟 (TTFT) 与模型推理质量。
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
                                  setRightPanelTab("inspector");
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
      <div
        className={cn(
          "flex shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
          rightPanelTab ? "w-80 md:w-96" : "w-0",
        )}
      >
        <div className="flex w-80 md:w-96 flex-col border-l border-slate-200/70 bg-white/95 dark:border-slate-800/70 dark:bg-slate-900/95 backdrop-blur-xl">
          {/* Panel Header Tabs */}
          <div className="flex h-[53px] items-center justify-between border-b border-slate-200/70 px-3 dark:border-slate-800/70">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl">
              <button
                type="button"
                onClick={() => setRightPanelTab("params")}
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
                onClick={() => setRightPanelTab("inspector")}
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
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs select-none">
              {/* Target Model Input */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">目标模型 (Model)</Label>
                <Input
                  value={selectedModel}
                  onChange={(e) => handleSelectModel(e.target.value)}
                  placeholder="例如: gpt-4o, claude-3-7-sonnet..."
                  className="h-8 font-mono text-xs rounded-xl"
                />
                <p className="text-[10px] text-slate-400">
                  支持官方模型 ID 或 config.yaml 中配置的模型别名
                </p>
              </div>

              {/* Temperature Slider */}
              <div className="space-y-1.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800/60 dark:bg-slate-950/40">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{t("playground.temperature")}</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{temperature}</span>
                </div>
                <Slider
                  value={[temperature]}
                  min={0}
                  max={2}
                  step={0.05}
                  onValueChange={(vals) => vals[0] !== undefined && setTemperature(vals[0])}
                  className="py-1"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>精确严谨 (0.0)</span>
                  <span>富有创意 (2.0)</span>
                </div>
              </div>

              {/* Max Tokens */}
              <div className="space-y-1.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800/60 dark:bg-slate-950/40">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{t("playground.maxTokens")}</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{maxTokens}</span>
                </div>
                <Slider
                  value={[maxTokens]}
                  min={128}
                  max={16384}
                  step={128}
                  onValueChange={(vals) => vals[0] !== undefined && setMaxTokens(vals[0])}
                  className="py-1"
                />
              </div>

              {/* Top P */}
              <div className="space-y-1.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800/60 dark:bg-slate-950/40">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{t("playground.topP")}</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{topP}</span>
                </div>
                <Slider
                  value={[topP]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(vals) => vals[0] !== undefined && setTopP(vals[0])}
                  className="py-1"
                />
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
            </div>
          )}

          {/* Tab Content: JSON Inspector */}
          {panelTab === "inspector" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {inspectedMessage && (inspectedMessage.rawRequest || inspectedMessage.rawResponse) ? (
                <>
                  {/* Request JSON Section */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                        Request Payload
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(
                            JSON.stringify(inspectedMessage.rawRequest, null, 2),
                            "req-json",
                          )
                        }
                        className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
                      >
                        {copiedKey === "req-json" ? <Check className="size-3" /> : <Copy className="size-3" />}
                        <span>复制请求 JSON</span>
                      </button>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-56">
                      <pre>{JSON.stringify(inspectedMessage.rawRequest, null, 2)}</pre>
                    </div>
                  </div>

                  {/* Response JSON Section */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                          Response Payload
                        </span>
                        {inspectedMessage.metrics?.statusCode && (
                          <Badge
                            variant={inspectedMessage.metrics.statusCode === 200 ? "default" : "destructive"}
                            className="text-[9px] font-mono px-1.5"
                          >
                            {inspectedMessage.metrics.statusCode}
                          </Badge>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(
                            JSON.stringify(inspectedMessage.rawResponse, null, 2),
                            "res-json",
                          )
                        }
                        className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-medium"
                      >
                        {copiedKey === "res-json" ? <Check className="size-3" /> : <Copy className="size-3" />}
                        <span>复制响应 JSON</span>
                      </button>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-64">
                      <pre>{JSON.stringify(inspectedMessage.rawResponse, null, 2)}</pre>
                    </div>
                  </div>

                  {/* Metrics Summary Table */}
                  {inspectedMessage.metrics && (
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
                </>
              ) : (
                <div className="flex h-64 flex-col items-center justify-center text-center text-slate-400">
                  <Code2 className="size-8 mb-2 opacity-50" />
                  <p className="text-xs">暂无请求与响应数据</p>
                  <p className="text-[10px] mt-1">在左侧发送测试请求后即可在此检查底层 JSON 负载与指标</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
