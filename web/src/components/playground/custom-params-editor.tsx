import React, { useState } from "react";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChevronRight,
  Plus,
  Trash2,
  Layers,
  Braces,
  Brackets,
  Sparkles,
  Eye,
  Copy,
  Check,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------- Data Types

export type VisualFieldType = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface VisualFieldNode {
  id: string;
  key: string;
  type: VisualFieldType;
  value: string | number | boolean | null;
  children?: VisualFieldNode[];
  items?: VisualFieldNode[];
  enabled: boolean;
  collapsed?: boolean;
}

export interface CustomHeader {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

// ---------------------------------------------------------------- Helpers & Conversions

let idSeq = 0;
export function createNodeId(prefix = "node"): string {
  idSeq = (idSeq + 1) % 1000000;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createDefaultNode(key = "", type: VisualFieldType = "string"): VisualFieldNode {
  const id = createNodeId();
  switch (type) {
    case "string":
      return { id, key, type: "string", value: "", enabled: true };
    case "number":
      return { id, key, type: "number", value: 0, enabled: true };
    case "boolean":
      return { id, key, type: "boolean", value: false, enabled: true };
    case "null":
      return { id, key, type: "null", value: null, enabled: true };
    case "object":
      return { id, key, type: "object", value: null, children: [], enabled: true, collapsed: false };
    case "array":
      return { id, key, type: "array", value: null, items: [], enabled: true, collapsed: false };
  }
}

export function nodeToJson(node: VisualFieldNode): unknown {
  if (!node.enabled) return undefined;
  switch (node.type) {
    case "string":
      return typeof node.value === "string" ? node.value : String(node.value ?? "");
    case "number": {
      if (typeof node.value === "number") return isNaN(node.value) ? 0 : node.value;
      const num = Number(node.value);
      return isNaN(num) ? 0 : num;
    }
    case "boolean":
      return Boolean(node.value);
    case "null":
      return null;
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const child of node.children || []) {
        if (child.enabled && child.key.trim()) {
          const val = nodeToJson(child);
          if (val !== undefined) {
            obj[child.key.trim()] = val;
          }
        }
      }
      return obj;
    }
    case "array": {
      const arr: unknown[] = [];
      for (const item of node.items || []) {
        if (item.enabled) {
          const val = nodeToJson(item);
          if (val !== undefined) {
            arr.push(val);
          }
        }
      }
      return arr;
    }
    default:
      return node.value;
  }
}

export function customFieldsToBody(fields: VisualFieldNode[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.enabled && field.key.trim()) {
      const val = nodeToJson(field);
      if (val !== undefined) {
        result[field.key.trim()] = val;
      }
    }
  }
  return result;
}

export function customHeadersToRecord(headers: CustomHeader[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    if (h.enabled && h.key.trim()) {
      result[h.key.trim()] = h.value;
    }
  }
  return result;
}

// ---------------------------------------------------------------- Presets

export const COMMON_HEADER_PRESETS = [
  { key: "X-Custom-Header", value: "custom-value" },
  { key: "anthropic-version", value: "2023-06-01" },
  { key: "User-Agent", value: "CLIProxyAPI-Playground/1.0" },
  { key: "x-api-key", value: "" },
];

export const COMMON_BODY_PRESETS = [
  {
    name: "reasoning_effort",
    badge: "string",
    desc: "推理强度 (low/medium/high)",
    create: () => ({
      id: createNodeId(),
      key: "reasoning_effort",
      type: "string" as const,
      value: "high",
      enabled: true,
    }),
  },
  {
    name: "thinking",
    badge: "object",
    desc: "Claude / Gemini 思考配置",
    create: () => ({
      id: createNodeId(),
      key: "thinking",
      type: "object" as const,
      value: null,
      enabled: true,
      collapsed: false,
      children: [
        {
          id: createNodeId(),
          key: "type",
          type: "string" as const,
          value: "enabled",
          enabled: true,
        },
        {
          id: createNodeId(),
          key: "budget_tokens",
          type: "number" as const,
          value: 2048,
          enabled: true,
        },
      ],
    }),
  },
  {
    name: "response_format",
    badge: "object",
    desc: "JSON 模式输出",
    create: () => ({
      id: createNodeId(),
      key: "response_format",
      type: "object" as const,
      value: null,
      enabled: true,
      collapsed: false,
      children: [
        {
          id: createNodeId(),
          key: "type",
          type: "string" as const,
          value: "json_object",
          enabled: true,
        },
      ],
    }),
  },
  {
    name: "stop",
    badge: "array",
    desc: "停止词数组",
    create: () => ({
      id: createNodeId(),
      key: "stop",
      type: "array" as const,
      value: null,
      enabled: true,
      collapsed: false,
      items: [
        {
          id: createNodeId(),
          key: "[0]",
          type: "string" as const,
          value: "<|endoftext|>",
          enabled: true,
        },
      ],
    }),
  },
  {
    name: "seed",
    badge: "number",
    desc: "固定随机种子",
    create: () => ({
      id: createNodeId(),
      key: "seed",
      type: "number" as const,
      value: 42,
      enabled: true,
    }),
  },
  {
    name: "presence_penalty",
    badge: "number",
    desc: "存在惩罚 (-2.0 ~ 2.0)",
    create: () => ({
      id: createNodeId(),
      key: "presence_penalty",
      type: "number" as const,
      value: 0.5,
      enabled: true,
    }),
  },
];

// ---------------------------------------------------------------- Recursive Tree Modifiers

function updateNodeInList(
  list: VisualFieldNode[],
  targetId: string,
  update: (node: VisualFieldNode) => VisualFieldNode,
): VisualFieldNode[] {
  return list.map((node) => {
    if (node.id === targetId) {
      return update(node);
    }
    if (node.type === "object" && node.children) {
      return {
        ...node,
        children: updateNodeInList(node.children, targetId, update),
      };
    }
    if (node.type === "array" && node.items) {
      return {
        ...node,
        items: updateNodeInList(node.items, targetId, update),
      };
    }
    return node;
  });
}

function removeNodeFromList(list: VisualFieldNode[], targetId: string): VisualFieldNode[] {
  return list
    .filter((node) => node.id !== targetId)
    .map((node) => {
      if (node.type === "object" && node.children) {
        return {
          ...node,
          children: removeNodeFromList(node.children, targetId),
        };
      }
      if (node.type === "array" && node.items) {
        return {
          ...node,
          items: removeNodeFromList(node.items, targetId),
        };
      }
      return node;
    });
}

function addChildToNode(
  list: VisualFieldNode[],
  parentId: string,
  newNode: VisualFieldNode,
): VisualFieldNode[] {
  return list.map((node) => {
    if (node.id === parentId) {
      if (node.type === "object") {
        return {
          ...node,
          collapsed: false,
          children: [...(node.children || []), newNode],
        };
      }
      if (node.type === "array") {
        return {
          ...node,
          collapsed: false,
          items: [...(node.items || []), newNode],
        };
      }
    }
    if (node.type === "object" && node.children) {
      return {
        ...node,
        children: addChildToNode(node.children, parentId, newNode),
      };
    }
    if (node.type === "array" && node.items) {
      return {
        ...node,
        items: addChildToNode(node.items, parentId, newNode),
      };
    }
    return node;
  });
}

// ---------------------------------------------------------------- VisualFieldItem Component

interface VisualFieldItemProps {
  node: VisualFieldNode;
  isArrayItem: boolean;
  index?: number;
  depth: number;
  onUpdate: (id: string, update: (n: VisualFieldNode) => VisualFieldNode) => void;
  onRemove: (id: string) => void;
  onAddChild: (parentId: string, child: VisualFieldNode) => void;
  onAddItem: (parentId: string, item: VisualFieldNode) => void;
}

function VisualFieldItem({
  node,
  isArrayItem,
  index = 0,
  depth,
  onUpdate,
  onRemove,
  onAddChild,
  onAddItem,
}: VisualFieldItemProps) {
  const { t } = useTranslation();
  const isContainer = node.type === "object" || node.type === "array";

  const handleTypeChange = (newType: VisualFieldType) => {
    onUpdate(node.id, (n) => {
      let nextValue: string | number | boolean | null = "";
      let nextChildren = n.children;
      let nextItems = n.items;

      if (newType === "string") {
        nextValue = typeof n.value === "string" ? n.value : "";
      } else if (newType === "number") {
        nextValue = typeof n.value === "number" ? n.value : 0;
      } else if (newType === "boolean") {
        nextValue = Boolean(n.value);
      } else if (newType === "null") {
        nextValue = null;
      } else if (newType === "object") {
        nextValue = null;
        if (!nextChildren || nextChildren.length === 0) {
          nextChildren = [];
        }
      } else if (newType === "array") {
        nextValue = null;
        if (!nextItems || nextItems.length === 0) {
          nextItems = [];
        }
      }

      return {
        ...n,
        type: newType,
        value: nextValue,
        children: nextChildren,
        items: nextItems,
        collapsed: false,
      };
    });
  };

  return (
    <div
      className={cn(
        "group/field rounded-xl border border-slate-200/80 bg-white p-2 text-xs shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900/90 overflow-hidden",
        !node.enabled && "opacity-50 bg-slate-50/70 dark:bg-slate-950/40",
      )}
    >
      {/* Row 1: Key / Type / Indicators / Enable / Delete */}
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Collapse toggle or leaf bullet */}
        {isContainer ? (
          <button
            type="button"
            onClick={() => onUpdate(node.id, (n) => ({ ...n, collapsed: !n.collapsed }))}
            className="size-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition shrink-0"
            title={node.collapsed ? "展开" : "折叠"}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform duration-150", !node.collapsed && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mx-1 shrink-0" />
        )}

        {/* Key Display / Input */}
        {isArrayItem ? (
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/60 shrink-0 select-none">
            [{index}]
          </span>
        ) : (
          <Input
            value={node.key}
            onChange={(e) => onUpdate(node.id, (n) => ({ ...n, key: e.target.value }))}
            placeholder={depth === 0 ? t("playground.fieldNamePlaceholder", "字段名") : t("playground.propNamePlaceholder", "属性名")}
            className="h-7 min-w-[70px] max-w-[140px] flex-1 text-xs font-mono rounded-lg px-2 bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800"
          />
        )}

        {/* Type Selector */}
        <Select value={node.type} onValueChange={(val) => handleTypeChange(val as VisualFieldType)}>
          <SelectTrigger className="h-7 w-[82px] text-[11px] font-medium px-1.5 rounded-lg shrink-0 border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="string">{t("playground.typeString", "文本 (str)")}</SelectItem>
            <SelectItem value="number">{t("playground.typeNumber", "数字 (num)")}</SelectItem>
            <SelectItem value="boolean">{t("playground.typeBoolean", "布尔 (bool)")}</SelectItem>
            <SelectItem value="null">{t("playground.typeNull", "空值 (null)")}</SelectItem>
            <SelectItem value="object">{t("playground.typeObject", "对象 ({})")}</SelectItem>
            <SelectItem value="array">{t("playground.typeArray", "数组 ([])")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Container Badge (for object / array) */}
        {node.type === "object" && (
          <Badge
            variant="outline"
            className="h-6 px-1.5 font-mono text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 flex items-center gap-1 select-none shrink-0"
          >
            <Braces className="size-2.5" />
            <span>{node.children?.length ?? 0}</span>
          </Badge>
        )}

        {node.type === "array" && (
          <Badge
            variant="outline"
            className="h-6 px-1.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 flex items-center gap-1 select-none shrink-0"
          >
            <Brackets className="size-2.5" />
            <span>{node.items?.length ?? 0}</span>
          </Badge>
        )}

        {/* Actions: Switch and Delete */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <Switch
            size="sm"
            checked={node.enabled}
            onCheckedChange={(val) => onUpdate(node.id, (n) => ({ ...n, enabled: val }))}
            title={node.enabled ? "已启用" : "已禁用"}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            onClick={() => onRemove(node.id)}
            title="删除此字段"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Row 2: Value Input for Primitive Types */}
      {!isContainer && (
        <div className="mt-1.5 pl-4 flex items-center gap-1.5 min-w-0">
          {node.type === "string" && (
            <Input
              value={typeof node.value === "string" ? node.value : ""}
              onChange={(e) => onUpdate(node.id, (n) => ({ ...n, value: e.target.value }))}
              placeholder={t("playground.fieldValuePlaceholder", "文本内容...")}
              className="h-7 w-full text-xs font-mono rounded-lg px-2 bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800"
            />
          )}

          {node.type === "number" && (
            <Input
              type="number"
              step="any"
              value={node.value !== null && node.value !== undefined ? String(node.value) : ""}
              onChange={(e) =>
                onUpdate(node.id, (n) => ({
                  ...n,
                  value: e.target.value === "" ? 0 : Number(e.target.value),
                }))
              }
              placeholder="0"
              className="h-7 w-full text-xs font-mono rounded-lg px-2 bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800"
            />
          )}

          {node.type === "boolean" && (
            <button
              type="button"
              onClick={() => onUpdate(node.id, (n) => ({ ...n, value: !n.value }))}
              className={cn(
                "h-7 px-3 rounded-lg text-xs font-mono font-semibold transition shrink-0 flex items-center gap-1.5",
                node.value
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800"
                  : "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
              )}
            >
              <span className={cn("size-1.5 rounded-full", node.value ? "bg-emerald-500" : "bg-slate-400")} />
              <span>{node.value ? "true" : "false"}</span>
            </button>
          )}

          {node.type === "null" && (
            <span className="px-2 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800/80 rounded-md italic select-none border border-dashed border-slate-200 dark:border-slate-700">
              null
            </span>
          )}
        </div>
      )}

      {/* Nested Object Children */}
      {node.type === "object" && !node.collapsed && (
        <div className="mt-2 pl-2 ml-1.5 border-l-2 border-blue-300 dark:border-blue-800/80 space-y-1.5">
          {node.children && node.children.length > 0 ? (
            node.children.map((child) => (
              <VisualFieldItem
                key={child.id}
                node={child}
                isArrayItem={false}
                depth={depth + 1}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onAddChild={onAddChild}
                onAddItem={onAddItem}
              />
            ))
          ) : (
            <div className="text-[10px] text-slate-400 italic py-0.5">空对象 (点击下方按钮添加属性)</div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-2 rounded-lg text-blue-600 hover:text-blue-700 dark:text-blue-400 border-dashed border-blue-300 dark:border-blue-800/80 hover:bg-blue-50/80 dark:hover:bg-blue-950/50"
            onClick={() => onAddChild(node.id, createDefaultNode("", "string"))}
          >
            <Plus className="size-3 mr-1" />
            {t("playground.addProperty", "添加属性")}
          </Button>
        </div>
      )}

      {/* Nested Array Items */}
      {node.type === "array" && !node.collapsed && (
        <div className="mt-2 pl-2 ml-1.5 border-l-2 border-emerald-300 dark:border-emerald-800/80 space-y-1.5">
          {node.items && node.items.length > 0 ? (
            node.items.map((item, idx) => (
              <VisualFieldItem
                key={item.id}
                node={item}
                isArrayItem={true}
                index={idx}
                depth={depth + 1}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onAddChild={onAddChild}
                onAddItem={onAddItem}
              />
            ))
          ) : (
            <div className="text-[10px] text-slate-400 italic py-0.5">空数组 (点击下方按钮添加元素)</div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-2 rounded-lg text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 border-dashed border-emerald-300 dark:border-emerald-800/80 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/50"
            onClick={() => onAddItem(node.id, createDefaultNode(`[${node.items?.length || 0}]`, "string"))}
          >
            <Plus className="size-3 mr-1" />
            {t("playground.addItem", "添加元素")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Custom Headers Editor

export interface CustomHeadersEditorProps {
  headers: CustomHeader[];
  onChange: (headers: CustomHeader[]) => void;
}

export function CustomHeadersEditor({ headers, onChange }: CustomHeadersEditorProps) {
  const { t } = useTranslation();

  const handleAddHeader = (key = "", value = "") => {
    onChange([
      ...headers,
      {
        id: createNodeId("hdr"),
        key,
        value,
        enabled: true,
      },
    ]);
  };

  const handleUpdate = (id: string, field: "key" | "value" | "enabled", val: unknown) => {
    onChange(
      headers.map((h) => {
        if (h.id === id) {
          return { ...h, [field]: val };
        }
        return h;
      }),
    );
  };

  const handleRemove = (id: string) => {
    onChange(headers.filter((h) => h.id !== id));
  };

  return (
    <div className="space-y-2.5">
      {/* Quick Header Suggestions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-slate-400 font-medium">常用 Header:</span>
        {COMMON_HEADER_PRESETS.map((p) => {
          const exists = headers.some((h) => h.key.toLowerCase() === p.key.toLowerCase());
          return (
            <button
              key={p.key}
              type="button"
              disabled={exists}
              onClick={() => handleAddHeader(p.key, p.value)}
              className={cn(
                "text-[10px] font-mono px-1.5 py-0.5 rounded-md border transition flex items-center gap-1",
                exists
                  ? "opacity-40 border-slate-200 text-slate-400 dark:border-slate-800 cursor-not-allowed"
                  : "border-slate-200/90 text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-800 dark:text-slate-300 dark:hover:text-blue-400 bg-white dark:bg-slate-900/60",
              )}
            >
              <Plus className="size-2.5" />
              <span>{p.key}</span>
            </button>
          );
        })}
      </div>

      {/* Header List */}
      {headers.length > 0 ? (
        <div className="space-y-1.5">
          {headers.map((h) => (
            <div
              key={h.id}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900/90 transition-opacity min-w-0 overflow-hidden",
                !h.enabled && "opacity-50 bg-slate-50/70 dark:bg-slate-950/40",
              )}
            >
              <Input
                value={h.key}
                onChange={(e) => handleUpdate(h.id, "key", e.target.value)}
                placeholder={t("playground.headerNamePlaceholder", "Header 名称 (如 X-Custom-Header)")}
                className="h-7 min-w-[70px] max-w-[130px] flex-1 text-xs font-mono rounded-lg px-2 bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 shrink-0"
              />
              <Input
                value={h.value}
                onChange={(e) => handleUpdate(h.id, "value", e.target.value)}
                placeholder={t("playground.headerValuePlaceholder", "Header 内容")}
                className="h-7 flex-1 min-w-[60px] text-xs font-mono rounded-lg px-2 bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800"
              />
              <Switch
                size="sm"
                checked={h.enabled}
                onCheckedChange={(val) => handleUpdate(h.id, "enabled", val)}
                title={h.enabled ? "已启用" : "已禁用"}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                onClick={() => handleRemove(h.id)}
                title="删除 Header"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-3 text-center text-slate-400 text-[11px]">
          {t("playground.emptyHeaders", "暂无自定义请求头")}
        </div>
      )}

      {/* Add Header Button */}
      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs rounded-xl border-dashed"
          onClick={() => handleAddHeader()}
        >
          <Plus className="size-3.5 mr-1" />
          {t("playground.addHeader", "添加 Header")}
        </Button>
        {headers.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-slate-400 hover:text-rose-500"
            onClick={() => onChange([])}
          >
            {t("playground.clearAll", "清空全部")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Visual Body Editor

export interface VisualBodyEditorProps {
  fields: VisualFieldNode[];
  onChange: (fields: VisualFieldNode[]) => void;
}

export function VisualBodyEditor({ fields, onChange }: VisualBodyEditorProps) {
  const { t } = useTranslation();
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleAddField = () => {
    onChange([...fields, createDefaultNode("", "string")]);
  };

  const handleUpdate = (id: string, update: (n: VisualFieldNode) => VisualFieldNode) => {
    onChange(updateNodeInList(fields, id, update));
  };

  const handleRemove = (id: string) => {
    onChange(removeNodeFromList(fields, id));
  };

  const handleAddChild = (parentId: string, child: VisualFieldNode) => {
    onChange(addChildToNode(fields, parentId, child));
  };

  const handleAddItem = (parentId: string, item: VisualFieldNode) => {
    onChange(addChildToNode(fields, parentId, item));
  };

  const handleApplyPreset = (preset: (typeof COMMON_BODY_PRESETS)[0]) => {
    const exists = fields.some((f) => f.key.trim().toLowerCase() === preset.name.toLowerCase());
    if (exists) {
      toast.info(`字段 "${preset.name}" 已在自定义列表中`);
      return;
    }
    onChange([...fields, preset.create()]);
    toast.success(t("playground.presetAdded", { name: preset.name, defaultValue: `已添加预设参数: ${preset.name}` }));
  };

  const generatedBody = customFieldsToBody(fields);
  const jsonPreviewText = JSON.stringify(generatedBody, null, 2);

  const handleCopyPreview = () => {
    navigator.clipboard.writeText(jsonPreviewText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("已复制请求 Body 字段 JSON");
  };

  return (
    <div className="space-y-3">
      {/* Quick Body Presets */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
            <Sparkles className="size-3 text-amber-500" />
            <span>{t("playground.quickPresets", "常用参数预设")}:</span>
          </span>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
          >
            <Eye className="size-3" />
            <span>{showPreview ? "收起预览" : t("playground.previewJson", "实时 JSON 预览")}</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {COMMON_BODY_PRESETS.map((p) => {
            const exists = fields.some((f) => f.key.trim().toLowerCase() === p.name.toLowerCase());
            return (
              <button
                key={p.name}
                type="button"
                disabled={exists}
                onClick={() => handleApplyPreset(p)}
                className={cn(
                  "text-[10px] font-mono px-2 py-0.5 rounded-md border transition flex items-center gap-1",
                  exists
                    ? "opacity-40 border-slate-200 text-slate-400 dark:border-slate-800 cursor-not-allowed"
                    : "border-slate-200/90 text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-800 dark:text-slate-300 dark:hover:text-blue-400 bg-white dark:bg-slate-900/60 shadow-2xs",
                )}
                title={p.desc}
              >
                <Plus className="size-2.5" />
                <span>{p.name}</span>
                <span className="text-[9px] text-slate-400">({p.badge})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live JSON Preview Box (Collapsible) */}
      {showPreview && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 p-2.5 text-[11px] font-mono text-slate-200 space-y-1.5 animate-in slide-in-from-top-1">
          <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold">Live JSON Output</span>
            <button
              type="button"
              onClick={handleCopyPreview}
              className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              <span>{copied ? "已复制" : t("playground.copyJson", "复制 JSON")}</span>
            </button>
          </div>
          <pre className="overflow-x-auto max-h-40 leading-relaxed text-[10px] text-emerald-400">
            {Object.keys(generatedBody).length > 0
              ? jsonPreviewText
              : "{\n  // 暂无生效的自定义字段\n}"}
          </pre>
        </div>
      )}

      {/* Visual Field List */}
      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field) => (
            <VisualFieldItem
              key={field.id}
              node={field}
              isArrayItem={false}
              depth={0}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
              onAddChild={handleAddChild}
              onAddItem={handleAddItem}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-4 text-center text-slate-400 space-y-1.5">
          <Braces className="size-5 mx-auto opacity-40 text-blue-500" />
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("playground.emptyBodyFields", "暂无自定义 Body 字段")}
          </p>
          <p className="text-[11px] text-slate-400">
            使用纯控件编辑，支持嵌套对象与数组，将合并至 POST /v1/chat/completions 请求
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs rounded-xl border-dashed text-blue-600 hover:text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/60"
          onClick={handleAddField}
        >
          <Plus className="size-3.5 mr-1" />
          {t("playground.addField", "添加根字段")}
        </Button>

        {fields.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-slate-400 hover:text-rose-500"
            onClick={() => onChange([])}
          >
            {t("playground.clearAll", "清空全部")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Combined CustomParamsSection

export interface CustomParamsSectionProps {
  customHeaders: CustomHeader[];
  setCustomHeaders: React.Dispatch<React.SetStateAction<CustomHeader[]>>;
  customBodyFields: VisualFieldNode[];
  setCustomBodyFields: React.Dispatch<React.SetStateAction<VisualFieldNode[]>>;
}

export function CustomParamsSection({
  customHeaders,
  setCustomHeaders,
  customBodyFields,
  setCustomBodyFields,
}: CustomParamsSectionProps) {
  const { t } = useTranslation();
  const [headersOpen, setHeadersOpen] = useState(() => customHeaders.length > 0);
  const [bodyOpen, setBodyOpen] = useState(() => customBodyFields.length > 0);

  const activeHeadersCount = customHeaders.filter((h) => h.enabled && h.key.trim()).length;
  const activeBodyCount = customBodyFields.filter((f) => f.enabled && f.key.trim()).length;

  return (
    <div className="space-y-3 pt-1">
      {/* 1. Custom Headers Collapsible Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800/70 dark:bg-slate-950/40 space-y-2.5">
        <button
          type="button"
          onClick={() => setHeadersOpen(!headersOpen)}
          className="flex w-full items-center justify-between text-left select-none"
        >
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-purple-600 dark:text-purple-400" />
            <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
              {t("playground.customHeaders", "自定义请求头 (Headers)")}
            </span>
            {activeHeadersCount > 0 && (
              <Badge
                variant="secondary"
                className="h-4.5 px-1.5 text-[10px] font-mono bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
              >
                {activeHeadersCount}
              </Badge>
            )}
          </div>
          <ChevronRight
            className={cn(
              "size-3.5 text-slate-400 transition-transform duration-200",
              headersOpen && "rotate-90",
            )}
          />
        </button>

        {headersOpen && (
          <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800/70 animate-in slide-in-from-top-1">
            <p className="text-[10px] text-slate-400 mb-2 leading-relaxed">
              {t("playground.customHeadersDesc", "随请求携带额外的 HTTP Header，支持开关与覆盖标准头")}
            </p>
            <CustomHeadersEditor headers={customHeaders} onChange={setCustomHeaders} />
          </div>
        )}
      </div>

      {/* 2. Custom Body Fields Collapsible Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800/70 dark:bg-slate-950/40 space-y-2.5">
        <button
          type="button"
          onClick={() => setBodyOpen(!bodyOpen)}
          className="flex w-full items-center justify-between text-left select-none"
        >
          <div className="flex items-center gap-2">
            <Braces className="size-4 text-blue-600 dark:text-blue-400" />
            <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
              {t("playground.customBody", "自定义请求体 (Body 字段)")}
            </span>
            {activeBodyCount > 0 && (
              <Badge
                variant="secondary"
                className="h-4.5 px-1.5 text-[10px] font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
              >
                {activeBodyCount}
              </Badge>
            )}
          </div>
          <ChevronRight
            className={cn(
              "size-3.5 text-slate-400 transition-transform duration-200",
              bodyOpen && "rotate-90",
            )}
          />
        </button>

        {bodyOpen && (
          <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800/70 animate-in slide-in-from-top-1">
            <p className="text-[10px] text-slate-400 mb-2 leading-relaxed">
              {t("playground.customBodyDesc", "通过可视化控件向请求 Body 注入字段，支持嵌套对象与数组")}
            </p>
            <VisualBodyEditor fields={customBodyFields} onChange={setCustomBodyFields} />
          </div>
        )}
      </div>
    </div>
  );
}
