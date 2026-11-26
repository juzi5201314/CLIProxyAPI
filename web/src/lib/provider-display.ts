import { extractHost, maskKey } from "@/lib/format";

export interface ProviderLike {
  provider?: string;
  provider_name?: string;
  provider_key?: string;
  provider_label?: string;
  label?: string;
  key?: string;
  auth_id?: string;
  auth_index?: string;
  auth_type?: string;
  source?: string;
  api_key?: string;
  base_url?: string;
}

/** Canonical display badge text for credential auth type ("OAuth" / "API Key"). */
export function formatAuthTypeBadge(authType?: string): string {
  const normalized = (authType ?? "").trim().toLowerCase();
  if (normalized === "oauth" || normalized === "oauth2") return "OAuth";
  if (normalized === "apikey" || normalized === "api_key" || normalized === "api-key") return "API Key";
  return "";
}

/** Subtle badge color classes distinguishing OAuth vs API-key credentials. */
export function getAuthTypeBadgeClass(authType?: string): string {
  const normalized = (authType ?? "").trim().toLowerCase();
  if (normalized === "oauth" || normalized === "oauth2") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400";
  }
  if (normalized === "apikey" || normalized === "api_key" || normalized === "api-key") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  return "border-border bg-muted text-muted-foreground";
}

/**
 * Splits a formatted provider label like "codex(alice@gmail.com)" into
 * `{ prefix: "codex", qualifier: "alice@gmail.com" }` for two-tone rendering.
 */
export function splitProviderLabel(label: string): { prefix: string; qualifier: string } {
  const trimmed = label.trim();
  const open = trimmed.indexOf("(");
  if (open > 0 && trimmed.endsWith(")")) {
    return {
      prefix: trimmed.slice(0, open),
      qualifier: trimmed.slice(open + 1, -1),
    };
  }
  return { prefix: trimmed, qualifier: "" };
}

function cleanOAuthStem(provider: string, authId: string): string {
  const base = authId.trim().split(/[\\/]/).pop() ?? "";
  let stem = base.toLowerCase().endsWith(".json") ? base.slice(0, -5) : base;
  const p = provider.trim().toLowerCase();
  if (p) {
    const lower = stem.toLowerCase();
    for (const sep of ["-", "_"]) {
      const prefix = p + sep;
      if (lower.startsWith(prefix) && stem.length > prefix.length) {
        stem = stem.slice(prefix.length);
        break;
      }
    }
  }
  stem = stem.trim();
  if (stem.toLowerCase() === p) return "";
  return stem;
}

/**
 * Resolves a human-readable provider label for a request record or breakdown row,
 * preferring the server-disambiguated label and falling back gracefully for older payloads.
 */
export function resolveProviderLabel(item: ProviderLike): string {
  const direct = (item.provider_label ?? item.label ?? "").trim();
  if (direct) return direct;

  const rawProvider = (item.provider ?? "").trim();
  const lowerProvider = rawProvider.toLowerCase();
  let displayProvider = rawProvider;
  let compatFallback = "";
  if (lowerProvider.startsWith("openai-compatible-")) {
    displayProvider = "openai-compatible";
    compatFallback = rawProvider.slice("openai-compatible-".length).trim();
  } else if (lowerProvider === "openai-compatibility") {
    displayProvider = "openai-compatible";
  }

  const authType = (item.auth_type ?? "").trim().toLowerCase();
  const customName = (item.provider_name ?? "").trim();
  const host = extractHost(item.base_url);
  const authId = (item.auth_id ?? "").trim();
  const rawSource = (item.source ?? "").trim();
  const effectiveSource = rawSource && rawSource !== (item.api_key ?? "").trim() ? rawSource : "";

  let qualifier = "";
  if (authType === "oauth" || authId.toLowerCase().endsWith(".json")) {
    qualifier = customName || effectiveSource || cleanOAuthStem(rawProvider, authId) || (item.auth_index ? `#${item.auth_index.slice(0, 8)}` : "oauth");
  } else if (authType === "apikey" || authId.includes(":apikey:") || customName || host) {
    qualifier = customName || compatFallback || host || (effectiveSource ? maskKey(effectiveSource) : "") || (item.auth_index ? `#${item.auth_index.slice(0, 8)}` : "");
  } else if (compatFallback) {
    qualifier = compatFallback;
  }

  if (!displayProvider) return qualifier || (item.key ?? "");
  return qualifier ? `${displayProvider}(${qualifier})` : displayProvider;
}

/** Formats a canonical backend provider key into a readable fallback if no row label is cached. */
export function formatProviderKeyFallback(key: string): string {
  const trimmed = key.trim();
  if (trimmed.startsWith("id:")) {
    const rest = trimmed.slice(3);
    const sep = rest.indexOf("|");
    if (sep >= 0) {
      const provider = rest.slice(0, sep);
      const authId = rest.slice(sep + 1);
      return resolveProviderLabel({ provider, auth_id: authId });
    }
  }
  if (trimmed.startsWith("idx:")) {
    const rest = trimmed.slice(4);
    const sep = rest.indexOf("|");
    if (sep >= 0) {
      const provider = rest.slice(0, sep);
      const authIndex = rest.slice(sep + 1);
      return `${provider}(#${authIndex.slice(0, 8)})`;
    }
  }
  if (trimmed.startsWith("cfg:")) {
    try {
      const params = new URLSearchParams(trimmed.slice(4));
      return resolveProviderLabel({
        provider: params.get("p") ?? "",
        auth_type: params.get("t") ?? "",
        provider_name: params.get("n") ?? "",
        base_url: params.get("u") ?? "",
        source: params.get("s") ?? "",
      });
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("type:")) {
    return trimmed.slice(5);
  }
  return trimmed;
}

/** Multi-line tooltip summarizing provider identity details. */
export function buildProviderTooltip(item: ProviderLike): string {
  const label = resolveProviderLabel(item);
  const badge = formatAuthTypeBadge(item.auth_type);
  const lines: string[] = [];
  if (label) {
    lines.push(badge ? `${label} [${badge}]` : label);
  }
  if (item.provider && item.provider !== label) {
    lines.push(`Type: ${item.provider}`);
  }
  if (item.base_url) {
    lines.push(`Base URL: ${item.base_url}`);
  }
  if (item.auth_id) {
    lines.push(`Auth ID: ${item.auth_id}`);
  }
  return lines.join("\n");
}
