import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Gauge,
  RotateCw,
  ScanLine,
  Settings2,
  StopCircle,
  Target,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CustomHeader, VisualFieldNode } from "@/components/playground/custom-params-editor";
import {
  type ApiProtocol,
  type ReasoningEffortLevel,
  type MessageMetrics,
  type BuiltPlaygroundRequest,
  buildPlaygroundRequest,
  extractDeltaFromChunk,
  extractErrorMessage,
  extractResponseFromData,
} from "@/pages/playground";

// ---------------------------------------------------------------------- Types & Presets

export type ProbeTier = "64k" | "256k" | "500k" | "1M" | "custom";

export interface ProbeTierConfig {
  id: ProbeTier;
  label: string;
  tokens: number;
  description: string;
  approxSize: string;
}

export const PROBE_TIERS: ProbeTierConfig[] = [
  { id: "64k", label: "64k", tokens: 65536, description: "标准长上下文", approxSize: "~250 KB" },
  { id: "256k", label: "256k", tokens: 262144, description: "现代主流长文本", approxSize: "~1.0 MB" },
  { id: "500k", label: "500k", tokens: 500000, description: "超长上下文探测", approxSize: "~1.9 MB" },
  { id: "1M", label: "1M", tokens: 1048576, description: "百万级全景上下文", approxSize: "~3.9 MB" },
  { id: "custom", label: "自定义", tokens: 128000, description: "自定义目标 Token", approxSize: "可调" },
];

const PROTOCOL_OPTIONS: { id: ApiProtocol; label: string; endpointTemplate: string }[] = [
  { id: "openai", label: "OpenAI 兼容", endpointTemplate: "/v1/chat/completions" },
  { id: "claude", label: "Claude 原生", endpointTemplate: "/v1/messages" },
  { id: "codex", label: "Codex 原生", endpointTemplate: "/v1/responses" },
  { id: "gemini", label: "Gemini 原生", endpointTemplate: "/v1beta/models/..." },
];

export interface ProbeResult {
  status: "success" | "warning" | "limit_detected" | "error";
  statusCode: number;
  latencyMs: number;
  ttftMs?: number;
  pin: string;
  pinMatched: boolean;
  targetTokens: number;
  detectedLimit?: number;
  replyContent?: string;
  errorMessage?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  rawRequest?: BuiltPlaygroundRequest;
  rawResponse?: unknown;
}

// ---------------------------------------------------------------------- Code Generator

/**
 * Generates realistic TypeScript AST/Tokenizer/Router code blocks.
 * Avoids simple word repetitions ("hello") to ensure realistic tokenization density.
 */
function generateCodeBlock(index: number): string {
  const modId = index % 5;
  switch (modId) {
    case 0:
      return `
// Module: syntax/ast_optimizer_${index}.ts
export interface SyntaxNode_${index} {
  readonly id: number;
  readonly kind: "Identifier" | "BinaryExpression" | "CallExpression" | "BlockStatement";
  readonly span: { start: number; end: number; line: number };
  parent?: SyntaxNode_${index};
  children: SyntaxNode_${index}[];
  attributes: Record<string, string | number | boolean>;
}

export class ASTOptimizer_${index} {
  private cache = new Map<number, SyntaxNode_${index}>();
  private checksum: number = ${10000 + (index * 37) % 89999};

  public transform(node: SyntaxNode_${index}): SyntaxNode_${index} {
    if (!node || !node.children) return node;
    const optimizedChildren = node.children.map((child) => this.transform(child));
    const nextChecksum = (this.checksum * 31 + node.span.start * 17) ^ ${index};
    return { ...node, children: optimizedChildren, attributes: { ...node.attributes, checksum: nextChecksum } };
  }
}
`;
    case 1:
      return `
// Module: runtime/memory_pool_${index}.ts
export class MemorySlab_${index} {
  private buffer: Uint8Array;
  private offset: number = 0;
  private readonly capacity: number = ${4096 + (index % 16) * 1024};

  constructor() {
    this.buffer = new Uint8Array(this.capacity);
  }

  public allocate(size: number): { ptr: number; length: number } | null {
    if (this.offset + size > this.capacity) return null;
    const ptr = this.offset;
    this.offset += size;
    return { ptr, length: size };
  }

  public reset(): void {
    this.offset = 0;
    this.buffer.fill(0);
  }
}
`;
    case 2:
      return `
// Module: net/protocol_router_${index}.ts
export interface RouteHandler_${index} {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  handler: (ctx: { traceId: string; timestamp: number; payload: unknown }) => Promise<unknown>;
}

export class Dispatcher_${index} {
  private routes: RouteHandler_${index}[] = [];

  public register(handler: RouteHandler_${index}): void {
    this.routes.push(handler);
  }

  public async execute(endpoint: string, method: string): Promise<boolean> {
    const matched = this.routes.find((r) => r.endpoint === endpoint && r.method === method);
    return Boolean(matched);
  }
}
`;
    case 3:
      return `
// Module: crypto/token_hash_${index}.ts
export function computeFNV1a_${index}(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash ^ ${index * 13}) >>> 0;
}
`;
    default:
      return `
// Module: concurrent/lru_cache_${index}.ts
export class ConcurrentLRU_${index}<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();
  private readonly ttlMs: number = ${60000 + (index % 60) * 1000};

  public set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  public get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
`;
  }
}

/**
 * Builds the complete probe prompt consisting of:
 * 1. Verification PIN Header
 * 2. Realistic repetitive TypeScript AST/runtime code blocks
 * 3. Verification Instruction Footer
 */
export function buildProbePayload(targetTokens: number, pin: string): {
  payload: string;
  estimatedTokens: number;
  byteSize: number;
  chunkCount: number;
  headerPreview: string;
  footerPreview: string;
} {
  const header = `// ============================================================================
// [CLIProxyAPI CONTEXT INTEGRITY PROBE - HEADER]
// VERIFICATION_PIN: "${pin}"
// TARGET_CAPACITY: ${targetTokens.toLocaleString()} TOKENS
// 
// INSTRUCTIONS:
// You are undergoing an automated context window capacity and truncation probe.
// A verification PIN has been stamped above: ${pin}
// Below is a codebase of mock runtime modules and compiler passes.
// Please read through the entire stream. At the very end of this document, you
// must strictly follow the final instruction regarding this PIN.
// ============================================================================
`;

  const footer = `
// ============================================================================
// [CLIProxyAPI CONTEXT INTEGRITY PROBE - FOOTER]
// END OF CODEBASE STREAM.
// 
// MANDATORY FINAL INSTRUCTION:
// Reply ONLY with the exact verification PIN stamped in the header of this prompt: ${pin}
// Do NOT include any markdown code blocks, explanations, greetings, or extra words.
// Your entire response must contain: ${pin}
// ============================================================================
`;

  // Code token density: ~3.8 characters per token in standard BPE (o200k/cl100k/llama/claude)
  const targetChars = Math.max(1000, Math.round(targetTokens * 3.8));
  let codeBody = "";
  let chunkIndex = 0;

  const baseChars = header.length + footer.length;
  const remainingBudget = Math.max(0, targetChars - baseChars);

  while (codeBody.length < remainingBudget) {
    codeBody += generateCodeBlock(chunkIndex++);
  }

  const payload = `${header}${codeBody}${footer}`;
  const byteSize = new Blob([payload]).size;
  const estimatedTokens = Math.round(payload.length / 3.8);

  return {
    payload,
    estimatedTokens,
    byteSize,
    chunkCount: chunkIndex,
    headerPreview: header.trim(),
    footerPreview: footer.trim(),
  };
}

/**
 * Extracts exact context limit from upstream HTTP 400 error messages using regex.
 */
export function extractContextLimitFromError(errMsg: string): number | null {
  if (!errMsg) return null;
  const patterns = [
    // OpenAI / vLLM: "maximum context length is 128000 tokens"
    /(?:maximum|max)\s+context\s+length\s+is\s+(\d+)/i,
    // Anthropic Claude: "210000 tokens > 200000 maximum"
    />\s*(\d+)\s+maximum/i,
    // Anthropic / Claude: "exceeds maximum limit (200000)" or "exceeds maximum limit of 200000"
    /maximum\s+limit\s*(?:\(|of|:)?\s*(\d+)/i,
    // Gemini: "allowed tokens: 1048576" or "maximum allowed tokens (1048576)"
    /(?:maximum\s+allowed\s+tokens?|allowed\s+tokens?)\s*(?:\(|of|:)?\s*(\d+)/i,
    // Context window: "context window of 65536 tokens"
    /context\s+window\s+(?:of|is|:)?\s*(\d+)/i,
    // Limit: "context_length_exceeded: limit 65536"
    /limit\s*(?:of|is|:)?\s*(\d{4,9})\b/i,
    // Exceeds max: "exceeds the maximum context of 131072"
    /maximum\s+context\s*(?:of|is|:)?\s*(\d{4,9})\b/i,
    // Generic: "max tokens of 131072" or "max tokens: 65536"
    /max(?:imum)?\s+tokens?\s*(?:of|is|:)?\s*(\d{4,9})\b/i,
  ];

  for (const pattern of patterns) {
    const match = errMsg.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num >= 1024) {
        return num;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------- Component

export interface ContextProberModalProps {
  isOpen: boolean;
  onClose: () => void;
  model: string;
  protocol: ApiProtocol;
  stream: boolean;
  enableTemperature: boolean;
  temperature: number;
  enableMaxTokens: boolean;
  maxTokens: number;
  enableTopP: boolean;
  topP: number;
  reasoningEffort: ReasoningEffortLevel;
  customHeaders?: CustomHeader[];
  customBodyFields?: VisualFieldNode[];
  clientApiKey?: string;
  managementKey?: string;
  onSaveToSession?: (
    userPrompt: string,
    assistantReply: string,
    rawRequest?: BuiltPlaygroundRequest,
    rawResponse?: unknown,
    metrics?: MessageMetrics,
  ) => void;
}

export function ContextProberModal({
  isOpen,
  onClose,
  model,
  protocol: initialProtocol,
  stream: initialStream,
  enableTemperature: initialEnableTemperature,
  temperature: initialTemperature,
  enableMaxTokens: initialEnableMaxTokens,
  maxTokens: initialMaxTokens,
  reasoningEffort: initialReasoningEffort,
  customHeaders = [],
  customBodyFields = [],
  clientApiKey,
  managementKey,
  onSaveToSession,
}: ContextProberModalProps) {
  // Prober tier & target tokens
  const [selectedTier, setSelectedTier] = useState<ProbeTier>("256k");
  const [customTokens, setCustomTokens] = useState<number>(128000);
  const [pin, setPin] = useState<string>(() => `PIN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
  
  // Execution & Live feedback state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [liveStreamText, setLiveStreamText] = useState<string>("");
  const [result, setResult] = useState<ProbeResult | null>(null);
  
  // UI collapse sections
  const [previewExpanded, setPreviewExpanded] = useState<boolean>(false);
  const [paramsExpanded, setParamsExpanded] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);

  // Synchronized probe parameters (Inherited from Playground, configurable inside modal)
  const [probeProtocol, setProbeProtocol] = useState<ApiProtocol>(initialProtocol);
  const [probeStream, setProbeStream] = useState<boolean>(initialStream);
  const [probeEnableTemp, setProbeEnableTemp] = useState<boolean>(initialEnableTemperature);
  const [probeTemp, setProbeTemp] = useState<number>(initialTemperature);
  const [probeEnableMaxTokens, setProbeEnableMaxTokens] = useState<boolean>(true); // default true for probe budget
  const [probeMaxTokens, setProbeMaxTokens] = useState<number>(32); // default 32 to minimize output cost
  const [probeReasoningEffort, setProbeReasoningEffort] = useState<ReasoningEffortLevel>(initialReasoningEffort);

  // Sync state whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setProbeProtocol(initialProtocol);
      setProbeStream(initialStream);
      setProbeEnableTemp(initialEnableTemperature);
      setProbeTemp(initialTemperature);
      setProbeEnableMaxTokens(initialEnableMaxTokens || true);
      setProbeMaxTokens(initialEnableMaxTokens ? initialMaxTokens : 32);
      setProbeReasoningEffort(initialReasoningEffort);
      setResult(null);
      setLiveStreamText("");
    }
  }, [
    isOpen,
    initialProtocol,
    initialStream,
    initialEnableTemperature,
    initialTemperature,
    initialEnableMaxTokens,
    initialMaxTokens,
    initialReasoningEffort,
  ]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  // Compute active target token count
  const targetTokens = useMemo(() => {
    if (selectedTier === "custom") {
      return Math.max(1024, customTokens || 128000);
    }
    const found = PROBE_TIERS.find((t) => t.id === selectedTier);
    return found ? found.tokens : 262144;
  }, [selectedTier, customTokens]);

  // Generate payload bundle
  const payloadData = useMemo(() => {
    return buildProbePayload(targetTokens, pin);
  }, [targetTokens, pin]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleResetToPg = () => {
    setProbeProtocol(initialProtocol);
    setProbeStream(initialStream);
    setProbeEnableTemp(initialEnableTemperature);
    setProbeTemp(initialTemperature);
    setProbeEnableMaxTokens(initialEnableMaxTokens || true);
    setProbeMaxTokens(initialEnableMaxTokens ? initialMaxTokens : 32);
    setProbeReasoningEffort(initialReasoningEffort);
    toast.info("已恢复与当前 Playground 设置一致");
  };

  const handleRegeneratePin = () => {
    if (isRunning) return;
    const newPin = `PIN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    setPin(newPin);
    setResult(null);
    setLiveStreamText("");
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRunning(false);
    toast.info("已手动中止探测请求");
  };

  // Perform single probe execution
  const handleRunSingleProbe = async () => {
    if (isRunning) return;
    setResult(null);
    setLiveStreamText("");
    setIsRunning(true);
    setElapsedMs(0);

    const startTime = performance.now();
    let ttftTime: number | undefined = undefined;

    timerRef.current = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - startTime));
    }, 100);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Build playground request with configured probe parameters
    const built = buildPlaygroundRequest({
      model: model || "gpt-4o",
      protocol: probeProtocol,
      history: [],
      inputText: payloadData.payload,
      inputImages: [],
      systemPrompt: "",
      temperature: probeTemp,
      enableTemperature: probeEnableTemp,
      maxTokens: probeMaxTokens,
      enableMaxTokens: probeEnableMaxTokens,
      topP: 1,
      enableTopP: false,
      stream: probeStream,
      reasoningEffort: probeReasoningEffort,
      customHeaders,
      customBodyFields,
      clientApiKey,
      managementKey,
    });

    try {
      const response = await fetch(built.endpointPath, {
        method: "POST",
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: controller.signal,
      });

      const statusCode = response.status;

      if (!response.ok) {
        const totalLatency = Math.round(performance.now() - startTime);
        const errText = await response.text();
        let parsedError: unknown = null;
        try {
          parsedError = JSON.parse(errText);
        } catch {
          parsedError = null;
        }

        const rawMsg = extractErrorMessage(parsedError, errText || response.statusText);
        const detectedLimit = extractContextLimitFromError(rawMsg);

        let finalErrorMsg = rawMsg;
        let finalStatus: ProbeResult["status"] = "error";

        if (detectedLimit) {
          finalStatus = "limit_detected";
          finalErrorMsg = `上游模型返回了明确的最大上下文限制：${detectedLimit.toLocaleString()} tokens`;
        } else if (statusCode === 413) {
          finalErrorMsg = `HTTP 413 (Payload Too Large): 请求体体积过大 (${(payloadData.byteSize / 1024 / 1024).toFixed(2)} MB)，被中间 Nginx / Cloudflare 网关拦截，未达模型后端。`;
        } else if (rawMsg.includes("invalid_argument") && probeEnableTemp) {
          finalErrorMsg = `上游拒绝参数 (invalid_argument): 该模型（如 SWE-2、o1、o3 等现代推理模型）通常不支持指定采样温度 (Temperature)。建议在下方“参数配置”中关闭“采样温度 (不发送)”后再试。\n[原始错误]: ${rawMsg}`;
        }

        setResult({
          status: finalStatus,
          statusCode,
          latencyMs: totalLatency,
          pin,
          pinMatched: false,
          targetTokens,
          detectedLimit: detectedLimit ?? undefined,
          errorMessage: finalErrorMsg,
          rawRequest: built,
          rawResponse: parsedError || { status: statusCode, error: errText },
        });
        return;
      }

      // ----------------- STREAMING RESPONSE PATH -----------------
      if (probeStream) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined = undefined;

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

              try {
                const chunkObj = JSON.parse(dataStr);
                const deltaRes = extractDeltaFromChunk(chunkObj);
                if (deltaRes.usage) {
                  streamUsage = deltaRes.usage;
                }
                if (deltaRes.contentChunk) {
                  if (ttftTime === undefined) {
                    ttftTime = Math.round(performance.now() - startTime);
                  }
                  accumulated += deltaRes.contentChunk;
                  setLiveStreamText(accumulated);
                }
              } catch {
                // Ignore incomplete SSE chunk
              }
            }
          }
        }

        const totalLatency = Math.round(performance.now() - startTime);
        const reply = accumulated.trim();
        const pinMatched = reply.toUpperCase().includes(pin.toUpperCase());

        setResult({
          status: pinMatched ? "success" : "warning",
          statusCode: 200,
          latencyMs: totalLatency,
          ttftMs: ttftTime,
          pin,
          pinMatched,
          targetTokens,
          replyContent: reply,
          usage: streamUsage,
          rawRequest: built,
          rawResponse: { stream: true, content: reply },
        });

        if (pinMatched) {
          toast.success(`探测通过！模型完整读取 ${targetTokens.toLocaleString()} tokens 并准确核对 PIN`);
        } else {
          toast.warning("请求虽返回成功，但未识别到头部 PIN，疑似存在静默截断！");
        }
        return;
      }

      // ----------------- NON-STREAMING RESPONSE PATH -----------------
      const totalLatency = Math.round(performance.now() - startTime);
      const data = await response.json();
      const nonStreamRes = extractResponseFromData(data);
      const reply = (nonStreamRes.content || "").trim();
      const pinMatched = reply.toUpperCase().includes(pin.toUpperCase());

      setResult({
        status: pinMatched ? "success" : "warning",
        statusCode: response.status,
        latencyMs: totalLatency,
        ttftMs: totalLatency,
        pin,
        pinMatched,
        targetTokens,
        replyContent: reply,
        usage: nonStreamRes.usage,
        rawRequest: built,
        rawResponse: data,
      });

      if (pinMatched) {
        toast.success(`探测通过！模型完整读取 ${targetTokens.toLocaleString()} tokens 并准确核对 PIN`);
      } else {
        toast.warning("请求虽返回成功，但未识别到头部 PIN，疑似存在静默截断！");
      }
    } catch (err: unknown) {
      const isAbort = (err as Error).name === "AbortError";
      if (isAbort) return;

      const totalLatency = Math.round(performance.now() - startTime);
      const errMsg = (err as Error)?.message || String(err);
      const detectedLimit = extractContextLimitFromError(errMsg);

      let finalErrorMsg = errMsg;
      if (errMsg.includes("invalid_argument") && probeEnableTemp) {
        finalErrorMsg = `上游参数拒绝 (invalid_argument): 现代推理模型通常不支持设置 Temperature。建议关闭“采样温度 (不发送)”后再试。\n[详细报错]: ${errMsg}`;
      }

      setResult({
        status: detectedLimit ? "limit_detected" : "error",
        statusCode: 0,
        latencyMs: totalLatency,
        pin,
        pinMatched: false,
        targetTokens,
        detectedLimit: detectedLimit ?? undefined,
        errorMessage: finalErrorMsg,
        rawRequest: built,
      });
      toast.error(`探测失败: ${errMsg}`);
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(payloadData.payload);
      setCopiedPrompt(true);
      toast.success("已复制完整探测代码载荷到剪贴板");
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      toast.error("复制失败，请检查浏览器权限");
    }
  };

  const handleSaveToActiveSession = () => {
    if (!result || !onSaveToSession) return;
    const assistantReply =
      result.replyContent ||
      (result.status === "limit_detected"
        ? `[上下文上限探测结果]\n上游报错限制: ${result.detectedLimit?.toLocaleString()} tokens\n错误详情: ${result.errorMessage}`
        : `[上下文探测异常 HTTP ${result.statusCode}]\n${result.errorMessage}`);

    const metrics: MessageMetrics = {
      latencyMs: result.latencyMs,
      ttftMs: result.ttftMs ?? result.latencyMs,
      statusCode: result.statusCode,
      tokens: {
        input: result.usage?.prompt_tokens ?? payloadData.estimatedTokens,
        output: result.usage?.completion_tokens ?? 1,
        total: result.usage?.total_tokens ?? (payloadData.estimatedTokens + 1),
      },
    };

    onSaveToSession(payloadData.payload, assistantReply, result.rawRequest, result.rawResponse, metrics);
    toast.success("已将探测载荷与结果导入当前会话！后续提问将直接命中上游前缀缓存 (Prefix Cache)。");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isRunning && !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-2xl">
        {/* Modal Header */}
        <DialogHeader className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400">
                <Gauge className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  最大上下文探测
                  <Badge variant="outline" className="text-[10px] font-mono border-blue-200 text-blue-600 dark:border-blue-900 dark:text-blue-400">
                    Context Prober
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  单次精准发送目标上下文 · 验证真实窗口容量与防静默截断 · 支持载荷导入复用前缀缓存
                </DialogDescription>
              </div>
            </div>

            {/* Target Model & Protocol Badges */}
            <div className="flex items-center gap-1.5 text-xs">
              <Badge variant="secondary" className="font-mono text-[11px] px-2 py-0.5 max-w-44 truncate">
                {model || "未选择模型"}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px] uppercase",
                  probeProtocol !== initialProtocol && "border-amber-300 text-amber-600 dark:text-amber-400",
                )}
              >
                {probeProtocol}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
          {/* Preset Quick Tiers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Target className="size-3.5 text-blue-600 dark:text-blue-400" />
                选择单次探测目标容量 (Target Context Tier)
              </Label>
              <span className="text-[11px] text-slate-400">
                严格单次请求 · 拒绝批量浪费成本
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {PROBE_TIERS.map((tier) => {
                const isSelected = selectedTier === tier.id;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    disabled={isRunning}
                    onClick={() => {
                      setSelectedTier(tier.id);
                      setResult(null);
                      setLiveStreamText("");
                    }}
                    className={cn(
                      "flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer relative",
                      isSelected
                        ? "border-blue-500 bg-blue-50/70 shadow-2xs dark:border-blue-500 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200"
                        : "border-slate-200 hover:border-slate-300 bg-white dark:border-slate-800 dark:bg-slate-900 hover:dark:border-slate-700 text-slate-700 dark:text-slate-300",
                      isRunning && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-bold text-sm font-mono">{tier.label}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{tier.approxSize}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                      {tier.description}
                    </span>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom Tokens Input */}
            {selectedTier === "custom" && (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-blue-200 bg-blue-50/30 dark:border-blue-900/50 dark:bg-blue-950/20 animate-in fade-in-50">
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-300">
                      自定义目标 Tokens
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      范围: 1,024 ~ 4,000,000
                    </span>
                  </div>
                  <Input
                    type="number"
                    min={1024}
                    max={4000000}
                    step={1024}
                    value={customTokens}
                    disabled={isRunning}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setCustomTokens(isNaN(val) ? 0 : val);
                      setResult(null);
                      setLiveStreamText("");
                    }}
                    className="h-8 font-mono text-xs bg-white dark:bg-slate-900"
                    placeholder="输入目标 token 数量，例如 128000"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-4">
                  {[32000, 128000, 200000, 500000, 2000000].map((quick) => (
                    <Button
                      key={quick}
                      variant="outline"
                      size="sm"
                      disabled={isRunning}
                      onClick={() => {
                        setCustomTokens(quick);
                        setResult(null);
                        setLiveStreamText("");
                      }}
                      className="h-6 px-2 text-[10px] font-mono"
                    >
                      {quick >= 1000000 ? `${quick / 1000000}M` : `${quick / 1000}k`}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Payload Overview & PIN Stamp Card */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl border border-slate-200/80 bg-slate-50/60 dark:border-slate-800/80 dark:bg-slate-900/30">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">目标载荷大小</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-bold text-sm font-mono text-slate-900 dark:text-slate-100">
                  {payloadData.estimatedTokens.toLocaleString()}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">tokens</span>
                <span className="text-[10px] text-slate-400">
                  ({(payloadData.byteSize / 1024 / 1024).toFixed(2)} MB · {payloadData.chunkCount} 代码块)
                </span>
              </div>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">探测验证识别码 (PIN)</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <code className="font-bold font-mono text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  {pin}
                </code>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={handleRegeneratePin}
                      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      <RotateCw className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">重新生成随机 PIN</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">防截断机制说明</span>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                头部植入 PIN，尾部下达核对指令。若中转反代存在静默截断，模型将无法正确输出 PIN。
              </p>
            </div>
          </div>

          {/* Model Parameters Accordion (Follows PG, Configurable) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <button
              type="button"
              onClick={() => setParamsExpanded(!paramsExpanded)}
              className="flex items-center justify-between w-full p-2.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="size-3.5 text-blue-600 dark:text-blue-400" />
                <span className="font-semibold">探测参数与接口格式</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  (已同步 Playground：{probeProtocol.toUpperCase()} · 流式 {probeStream ? "开" : "关"} · Temperature {probeEnableTemp ? probeTemp : "不发送"})
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <span>{paramsExpanded ? "收起设置" : "展开调整"}</span>
                {paramsExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </div>
            </button>

            {paramsExpanded && (
              <div className="p-3.5 border-t border-slate-100 dark:border-slate-800 space-y-3 bg-slate-50/50 dark:bg-slate-950/40">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[11px] text-slate-500">
                    可在此覆盖或微调本次探测的参数配置，默认完全继承 Playground 当前设置：
                  </span>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={handleResetToPg}
                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    重置与 Playground 同步
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Protocol Selector */}
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      API 协议格式 (Protocol)
                    </Label>
                    <Select
                      value={probeProtocol}
                      onValueChange={(val) => setProbeProtocol(val as ApiProtocol)}
                      disabled={isRunning}
                    >
                      <SelectTrigger className="h-8 font-mono text-xs bg-white dark:bg-slate-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROTOCOL_OPTIONS.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs font-mono">
                            {p.label} ({p.endpointTemplate})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Stream Mode Toggle */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        传输模式 (Stream SSE)
                      </Label>
                      <Switch
                        checked={probeStream}
                        onCheckedChange={setProbeStream}
                        disabled={isRunning}
                        className="scale-75 origin-right"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {probeStream ? "流式传输：实时展现首字延迟 (TTFT) 与输出字符" : "非流式：单次 JSON 响应"}
                    </p>
                  </div>

                  {/* Temperature Toggle */}
                  <div className="space-y-1 p-2 rounded-lg border border-slate-200/70 bg-white/70 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={probeEnableTemp}
                          onCheckedChange={setProbeEnableTemp}
                          disabled={isRunning}
                          className="scale-75 origin-left"
                        />
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          采样温度 (Temperature)
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {probeEnableTemp ? probeTemp : "不发送 (默认)"}
                      </span>
                    </div>
                    {probeEnableTemp ? (
                      <Slider
                        value={[probeTemp]}
                        min={0}
                        max={2}
                        step={0.05}
                        disabled={isRunning || !probeEnableTemp}
                        onValueChange={(vals) => vals[0] !== undefined && setProbeTemp(vals[0])}
                        className="py-1"
                      />
                    ) : (
                      <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-tight">
                        提示：SWE-2、o1、o3 等现代推理模型不支持 Temperature，不发送可防止 502/invalid_argument。
                      </p>
                    )}
                  </div>

                  {/* Max Output Tokens */}
                  <div className="space-y-1 p-2 rounded-lg border border-slate-200/70 bg-white/70 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={probeEnableMaxTokens}
                          onCheckedChange={setProbeEnableMaxTokens}
                          disabled={isRunning}
                          className="scale-75 origin-left"
                        />
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          输出上限 (Max Tokens)
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {probeEnableMaxTokens ? `${probeMaxTokens} tok` : "不发送"}
                      </span>
                    </div>
                    {probeEnableMaxTokens && (
                      <div className="flex items-center gap-2 pt-1">
                        <Input
                          type="number"
                          min={8}
                          max={4096}
                          value={probeMaxTokens}
                          disabled={isRunning || !probeEnableMaxTokens}
                          onChange={(e) => setProbeMaxTokens(parseInt(e.target.value, 10) || 32)}
                          className="h-6 text-[10px] font-mono w-24 bg-white dark:bg-slate-900"
                        />
                        <span className="text-[9px] text-slate-400">
                          单次探测仅需核对 PIN，建议设置 16~64 严格控制输出费用。
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Custom Body & Headers Summary */}
                <div className="flex items-center justify-between pt-1 text-[10px] text-slate-500">
                  <span>
                    携带配置: {customHeaders.filter((h) => h.enabled).length} 个自定义 Header · {customBodyFields.filter((f) => f.enabled).length} 个自定义 Body 字段
                  </span>
                  {probeReasoningEffort !== "off" && (
                    <Badge variant="outline" className="text-[9px] font-mono">
                      Reasoning: {probeReasoningEffort}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Expandable Code Preview */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <button
              type="button"
              onClick={() => setPreviewExpanded(!previewExpanded)}
              className="flex items-center justify-between w-full p-2.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Code2 className="size-3.5 text-slate-400" />
                <span>预览生成代码结构 (首尾指令与 AST/Token 模块切片)</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <span>{previewExpanded ? "收起" : "展开预览"}</span>
                {previewExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </div>
            </button>

            {previewExpanded && (
              <div className="p-3 border-t border-slate-100 dark:border-slate-800 space-y-2 bg-slate-950 font-mono text-[11px] text-slate-300 max-h-56 overflow-y-auto">
                <div className="text-amber-400 font-semibold">// 1. Header (头部植入):</div>
                <pre className="text-slate-400 whitespace-pre-wrap">{payloadData.headerPreview}</pre>

                <div className="text-blue-400 font-semibold pt-1">
                  // 2. 模拟真实 AST/Tokenizer/Router 代码库 ({payloadData.chunkCount} 个切片，无简单重复):
                </div>
                <pre className="text-slate-500 whitespace-pre-wrap">
                  {generateCodeBlock(0)}
                  {generateCodeBlock(1)}
                  {"\n// ... 已连续生成 " + (payloadData.chunkCount - 2) + " 个结构化代码切片 ...\n"}
                </pre>

                <div className="text-emerald-400 font-semibold pt-1">// 3. Footer (尾部指令):</div>
                <pre className="text-slate-400 whitespace-pre-wrap">{payloadData.footerPreview}</pre>
              </div>
            )}
          </div>

          {/* Live Streaming Indicator (when running with stream: true) */}
          {isRunning && probeStream && liveStreamText && (
            <div className="p-3 rounded-xl border border-blue-200 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-950/30 space-y-1">
              <div className="flex items-center justify-between text-blue-700 dark:text-blue-300 text-[11px]">
                <span className="font-semibold flex items-center gap-1.5">
                  <Zap className="size-3 animate-pulse" />
                  模型正在流式回复...
                </span>
                <span className="font-mono">{Math.round(elapsedMs / 1000)}s</span>
              </div>
              <div className="p-2 rounded bg-white/80 dark:bg-slate-900/80 font-mono text-xs text-slate-800 dark:text-slate-200 break-all">
                {liveStreamText}
              </div>
            </div>
          )}

          {/* Diagnostic Result Card */}
          {result && (
            <div
              className={cn(
                "p-4 rounded-xl border space-y-2.5 transition-all animate-in fade-in-50",
                result.status === "success" &&
                  "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20",
                result.status === "warning" &&
                  "border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20",
                result.status === "limit_detected" &&
                  "border-purple-300 bg-purple-50/60 dark:border-purple-900/60 dark:bg-purple-950/20",
                result.status === "error" &&
                  "border-rose-300 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/20",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {result.status === "success" && <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />}
                  {result.status === "warning" && <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />}
                  {result.status === "limit_detected" && <Target className="size-4 text-purple-600 dark:text-purple-400" />}
                  {result.status === "error" && <XCircle className="size-4 text-rose-600 dark:text-rose-400" />}

                  <span className="font-bold text-xs">
                    {result.status === "success" && "探测通过：完整支持目标上下文"}
                    {result.status === "warning" && "警告：请求返回但未匹配到 PIN (疑似静默截断)"}
                    {result.status === "limit_detected" && "命中上游最大上下文限制 (Exact Limit Found)"}
                    {result.status === "error" && `探测失败 (HTTP ${result.statusCode || "网络异常"})`}
                  </span>
                </div>

                <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                  <span>耗时: {result.latencyMs}ms</span>
                  {result.ttftMs !== undefined && <span>TTFT: {result.ttftMs}ms</span>}
                  {result.usage?.prompt_tokens && (
                    <span>上游 Prompt Tokens: {result.usage.prompt_tokens.toLocaleString()}</span>
                  )}
                </div>
              </div>

              {/* Status Specific Description */}
              {result.status === "success" && (
                <div className="text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
                  <p>
                    ✅ 模型成功读取了全部 <strong>{result.targetTokens.toLocaleString()} tokens</strong> 并准确输出了头部验证码 <code>{result.pin}</code>。
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    验证确认：上游及中间网关均未发生静默截断，模型在该长度下能够精准召回首部信息。
                  </p>
                  <div className="p-2 rounded bg-white/70 dark:bg-black/30 font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all">
                    模型回复: "{result.replyContent}"
                  </div>
                </div>
              )}

              {result.status === "warning" && (
                <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                  <p>
                    ⚠️ 虽成功获得 HTTP 200 回复，但回复中未包含头部 PIN <code>{result.pin}</code>。
                  </p>
                  <div className="p-2 rounded bg-white/70 dark:bg-black/30 font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all">
                    模型实际回复: "{result.replyContent || "(空回复)"}"
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-normal">
                    排查建议：
                    <br />
                    1. 检查中间代理聚合器（如 OneAPI / NewAPI / Nginx 等）是否配置了 prompt 最大截断策略（如 32k/128k 静默裁剪）。
                    <br />
                    2. 若中间代理截断了前半部分，头部 PIN 将丢失；若截断了后半部分，尾部指令将丢失。
                  </p>
                </div>
              )}

              {result.status === "limit_detected" && (
                <div className="text-xs text-purple-900 dark:text-purple-200 space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs">探测出该模型实际最大上下文限制：</span>
                    <span className="font-mono font-bold text-base text-purple-700 dark:text-purple-300">
                      {result.detectedLimit?.toLocaleString()} tokens
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-700 dark:text-purple-300 leading-normal">
                    上游服务端在拒绝请求时明确返回了该模型的真实最大上下文窗口，已通过正则精确捕获。
                  </p>
                  <div className="p-2 rounded bg-white/70 dark:bg-black/30 font-mono text-[10px] text-slate-700 dark:text-slate-300 break-all">
                    {result.errorMessage}
                  </div>
                </div>
              )}

              {result.status === "error" && (
                <div className="text-xs text-rose-900 dark:text-rose-200 space-y-1">
                  <p className="whitespace-pre-wrap break-all">{result.errorMessage}</p>
                </div>
              )}
            </div>
          )}

          {/* Prefix Caching Tip */}
          <div className="flex items-start gap-2 p-3 rounded-xl border border-blue-100 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/20 text-slate-600 dark:text-slate-400">
            <Zap className="size-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5 leading-tight">
              <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                前缀缓存复用 (Prefix Caching)
              </span>
              <p className="text-[10px]">
                探测完成后，可点击下方的“保存到当前会话”将整段载荷载入 Playground。后续基于此会话提问，将直接命中 Anthropic Prompt Caching / OpenAI Prefix Cache / DeepSeek KV 缓存，享受低延迟与高达 90% 的 Token 折扣。
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <DialogFooter className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-center justify-between sm:justify-between w-full">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isRunning}
              onClick={handleCopyPrompt}
              className="h-8 gap-1 rounded-xl text-xs"
            >
              {copiedPrompt ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              <span>{copiedPrompt ? "已复制载荷" : "复制探测提示词"}</span>
            </Button>

            {result && onSaveToSession && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveToActiveSession}
                className="h-8 gap-1 rounded-xl text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300"
              >
                <Download className="size-3.5" />
                <span>保存/导入到当前会话</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleAbort}
                className="h-8 gap-1 rounded-xl text-xs"
              >
                <StopCircle className="size-3.5" />
                <span>中止探测 ({Math.round(elapsedMs / 1000)}s)</span>
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleRunSingleProbe}
                className="h-8 gap-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
              >
                <ScanLine className="size-3.5" />
                <span>发送单次探测 ({selectedTier === "custom" ? `${Math.round(targetTokens / 1000)}k` : selectedTier})</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              disabled={isRunning}
              onClick={onClose}
              className="h-8 rounded-xl text-xs text-slate-500"
            >
              关闭
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
