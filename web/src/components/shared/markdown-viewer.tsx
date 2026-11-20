import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className={cn("space-y-2 text-xs leading-relaxed break-words", className)}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "code":
            return <CodeBlock key={idx} language={block.language} code={block.text} isStreaming={block.isStreaming} />;
          case "table":
            return <TableBlock key={idx} header={block.header} rows={block.rows} />;
          case "heading": {
            const Tag = `h${Math.min(block.level + 1, 6)}` as keyof React.JSX.IntrinsicElements;
            const sizeClass =
              block.level === 1
                ? "text-base font-bold text-foreground mt-3 mb-1"
                : block.level === 2
                  ? "text-sm font-bold text-foreground mt-2 mb-1"
                  : "text-xs font-semibold text-foreground mt-2 mb-0.5";
            return (
              <Tag key={idx} className={sizeClass}>
                <InlineRenderer text={block.text} />
              </Tag>
            );
          }
          case "blockquote":
            return (
              <blockquote
                key={idx}
                className="my-1.5 border-l-2 border-primary/50 bg-muted/40 py-1 pl-3 pr-2 text-xs italic text-muted-foreground rounded-r"
              >
                <InlineRenderer text={block.text} />
              </blockquote>
            );
          case "list":
            return (
              <ul
                key={idx}
                className={cn("my-1 space-y-1 pl-4", block.ordered ? "list-decimal" : "list-disc")}
              >
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx}>
                    <InlineRenderer text={item} />
                  </li>
                ))}
              </ul>
            );
          case "hr":
            return <hr key={idx} className="my-3 border-border/60" />;
          case "paragraph":
          default:
            return (
              <p key={idx} className="my-1 whitespace-pre-wrap">
                <InlineRenderer text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------- CodeBlock

function CodeBlock({
  language,
  code,
  isStreaming,
}: {
  language?: string;
  code: string;
  isStreaming?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("common.codeCopied", "代码已复制到剪贴板"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.copyFailed", "复制失败"));
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950 text-slate-100 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-1 text-[10px] font-mono text-slate-400 select-none">
        <span className="font-semibold text-slate-300">{language || "text"}</span>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="flex items-center gap-1 text-[10px] text-amber-400">
              <span className="inline-block size-1.5 rounded-full bg-amber-400 animate-pulse" />
              {t("common.streamingOutput", "输出中")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 hover:text-white transition cursor-pointer"
          >
            {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
            <span>{copied ? t("common.copied", "已复制") : t("common.copy", "复制")}</span>
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed select-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------- TableBlock

function TableBlock({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-border/80 shadow-xs">
      <table className="w-full text-left text-xs border-collapse">
        <thead className="bg-muted/70 text-foreground font-semibold border-b border-border">
          <tr>
            {header.map((col, idx) => (
              <th key={idx} className="px-3 py-1.5 font-medium">
                <InlineRenderer text={col} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50 bg-card/60">
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-muted/30 transition-colors">
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className="px-3 py-1.5 align-top text-foreground/90">
                  <InlineRenderer text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------- InlineRenderer

function InlineRenderer({ text }: { text: string }) {
  const parts = useMemo(() => parseInline(text), [text]);

  return (
    <>
      {parts.map((p, idx) => {
        if (p.type === "code") {
          return (
            <code
              key={idx}
              className="mx-0.5 rounded border border-border/60 bg-muted/80 px-1 py-0.5 font-mono text-[11px] text-primary"
            >
              {p.text}
            </code>
          );
        }
        if (p.type === "bold") {
          return (
            <strong key={idx} className="font-semibold text-foreground">
              {p.text}
            </strong>
          );
        }
        if (p.type === "italic") {
          return (
            <em key={idx} className="italic text-foreground/90">
              {p.text}
            </em>
          );
        }
        if (p.type === "link") {
          return (
            <a
              key={idx}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
            >
              {p.text}
            </a>
          );
        }
        return <span key={idx}>{p.text}</span>;
      })}
    </>
  );
}

// ---------------------------------------------------------------------- Parser logic

type ParsedBlock =
  | { type: "code"; text: string; language?: string; isStreaming?: boolean }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "heading"; level: number; text: string }
  | { type: "blockquote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "hr" }
  | { type: "paragraph"; text: string };

function parseBlocks(markdown: string): ParsedBlock[] {
  if (!markdown) return [];

  const lines = markdown.split("\n");
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // 1. Code Block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i]?.trim().startsWith("```")) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i] ?? "");
        i++;
      }
      blocks.push({
        type: "code",
        text: codeLines.join("\n"),
        language: lang,
        isStreaming: !closed,
      });
      continue;
    }

    // 2. Horizontal Rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // 3. Headings: #, ##, ###
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1]?.length ?? 1,
        text: headingMatch[2] ?? "",
      });
      i++;
      continue;
    }

    // 4. Blockquote: > ...
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i]?.trim().startsWith(">") || (lines[i]?.trim() && !lines[i]?.startsWith("```")))) {
        if (lines[i]?.trim().startsWith(">")) {
          quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ""));
        } else {
          quoteLines.push(lines[i]!);
        }
        i++;
      }
      blocks.push({
        type: "blockquote",
        text: quoteLines.join("\n"),
      });
      continue;
    }

    // 5. Tables: | col1 | col2 |
    if (line.trim().startsWith("|") && line.trim().endsWith("|") && i + 1 < lines.length) {
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (nextLine.startsWith("|") && /^[|:\-\s]+$/.test(nextLine)) {
        const parseRow = (r: string) =>
          r
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
        const header = parseRow(line);
        i += 2; // skip header and delimiter
        const rows: string[][] = [];
        while (i < lines.length && lines[i]?.trim().startsWith("|") && lines[i]?.trim().endsWith("|")) {
          rows.push(parseRow(lines[i]!));
          i++;
        }
        blocks.push({
          type: "table",
          header,
          rows,
        });
        continue;
      }
    }

    // 6. Lists
    const listOrderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    const listUnorderedMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (listOrderedMatch || listUnorderedMatch) {
      const ordered = Boolean(listOrderedMatch);
      const items: string[] = [];
      while (i < lines.length) {
        const curLine = lines[i] ?? "";
        const m = ordered ? curLine.match(/^(\s*)(\d+)\.\s+(.*)$/) : curLine.match(/^(\s*)([-*+])\s+(.*)$/);
        if (m) {
          items.push(m[3] ?? "");
          i++;
        } else if (curLine.startsWith("  ") && items.length > 0) {
          items[items.length - 1] += "\n" + curLine.trim();
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        type: "list",
        ordered,
        items,
      });
      continue;
    }

    // 7. Regular paragraph / text lines
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      !lines[i]?.trim().startsWith("```") &&
      !lines[i]?.trim().startsWith("#") &&
      !lines[i]?.trim().startsWith(">") &&
      !(lines[i]?.trim().startsWith("|") && lines[i]?.trim().endsWith("|")) &&
      !lines[i]?.match(/^(\s*)(\d+\.|[-*+])\s+/) &&
      !/^(\s*[-*_]\s*){3,}$/.test(lines[i] ?? "")
    ) {
      if (lines[i]?.trim() === "" && paragraphLines.length > 0) {
        i++;
        break;
      }
      paragraphLines.push(lines[i] ?? "");
      i++;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        type: "paragraph",
        text: paragraphLines.join("\n"),
      });
    } else {
      i++;
    }
  }

  return blocks;
}

interface InlineToken {
  type: "text" | "bold" | "italic" | "code" | "link";
  text: string;
  url?: string;
}

function parseInline(raw: string): InlineToken[] {
  if (!raw) return [];
  const tokens: InlineToken[] = [];
  // Tokenize `code`, **bold**, *italic*, [text](url)
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: raw.slice(lastIndex, match.index) });
    }
    const tokenStr = match[0];
    if (tokenStr.startsWith("`") && tokenStr.endsWith("`")) {
      tokens.push({ type: "code", text: tokenStr.slice(1, -1) });
    } else if (tokenStr.startsWith("**") && tokenStr.endsWith("**")) {
      tokens.push({ type: "bold", text: tokenStr.slice(2, -2) });
    } else if (tokenStr.startsWith("*") && tokenStr.endsWith("*")) {
      tokens.push({ type: "italic", text: tokenStr.slice(1, -1) });
    } else if (tokenStr.startsWith("[") && tokenStr.includes("](") && tokenStr.endsWith(")")) {
      const closeBracket = tokenStr.indexOf("](");
      const linkText = tokenStr.slice(1, closeBracket);
      const linkUrl = tokenStr.slice(closeBracket + 2, -1);
      tokens.push({ type: "link", text: linkText, url: linkUrl });
    } else {
      tokens.push({ type: "text", text: tokenStr });
    }
    lastIndex = match.index + tokenStr.length;
  }

  if (lastIndex < raw.length) {
    tokens.push({ type: "text", text: raw.slice(lastIndex) });
  }

  return tokens;
}
