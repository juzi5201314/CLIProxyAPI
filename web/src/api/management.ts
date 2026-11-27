import { client, v0 } from "./client";
import { ApiError } from "./types";
import type {
  AuthFileListResponse,
  BreakdownDimension,
  BreakdownRow,
  ErrorLogFile,
  LogLinesResponse,
  ModelInfo,
  ModelPrice,
  ModelPricesResponse,
  OAuthPollStatus,
  OAuthStartResponse,
  PluginInfo,
  PluginStoreItem,
  QuotaProviderInfo,
  RequestDBStats,
  RequestDBStorageInfo,
  RequestDBCleanOptions,
  RequestDBCleanResult,
  RequestRecord,
  RequestRecordPage,
  ServerInfo,
  TimeseriesResponse,
} from "./types";

// ---------------------------------------------------------------- request-db

export interface RecordFilter {
  model?: string;
  models?: string[];
  provider?: string;
  providers?: string[];
  api_key?: string;
  api_keys?: string[];
  session_id?: string;
  request_id?: string;
  trace_id?: string;
  failed?: boolean;
  status_code?: number;
  from?: number;
  to?: number;
  before_id?: number;
  page?: number;
  page_size?: number;
}

function filterParams(filter: RecordFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.models && filter.models.length > 0) {
    for (const m of filter.models) params.append("models[]", m);
  } else if (filter.model) {
    params.set("model", filter.model);
  }
  if (filter.providers && filter.providers.length > 0) {
    for (const p of filter.providers) params.append("providers[]", p);
  } else if (filter.provider) {
    params.set("provider", filter.provider);
  }
  if (filter.api_keys && filter.api_keys.length > 0) {
    for (const k of filter.api_keys) params.append("api_keys[]", k);
  } else if (filter.api_key) {
    params.set("api_key", filter.api_key);
  }
  if (filter.session_id) params.set("session_id", filter.session_id);
  if (filter.request_id) params.set("request_id", filter.request_id);
  if (filter.trace_id) params.set("trace_id", filter.trace_id);
  if (filter.failed !== undefined) params.set("failed", String(filter.failed));
  if (filter.status_code) params.set("status_code", String(filter.status_code));
  if (filter.from) params.set("from", String(filter.from));
  if (filter.to) params.set("to", String(filter.to));
  if (filter.before_id) params.set("before_id", String(filter.before_id));
  if (filter.page) params.set("page", String(filter.page));
  if (filter.page_size) params.set("page_size", String(filter.page_size));
  return params;
}

export const requestDB = {
  async records(filter: RecordFilter): Promise<RequestRecordPage> {
    const { data } = await client.get("/observability/request-db/records", { params: filterParams(filter) });
    return data as RequestRecordPage;
  },
  async recordDetail(id: number): Promise<RequestRecord> {
    const { data } = await client.get(`/observability/request-db/records/${id}`);
    return data as RequestRecord;
  },
  async stats(filter: RecordFilter): Promise<RequestDBStats> {
    const { data } = await client.get("/observability/request-db/stats", { params: filterParams(filter) });
    return data as RequestDBStats;
  },
  async timeseries(filter: RecordFilter, intervalSeconds?: number): Promise<TimeseriesResponse> {
    const params = filterParams(filter);
    if (intervalSeconds) params.set("interval", String(intervalSeconds));
    const { data } = await client.get("/observability/request-db/timeseries", { params });
    return data as TimeseriesResponse;
  },
  async breakdown(dimension: BreakdownDimension, filter: RecordFilter, limit = 10): Promise<BreakdownRow[]> {
    const params = filterParams(filter);
    params.set("dimension", dimension);
    params.set("limit", String(limit));
    const { data } = await client.get("/observability/request-db/breakdown", { params });
    return (data as { rows: BreakdownRow[] }).rows;
  },
  async modelPrices(): Promise<ModelPricesResponse> {
    const { data } = await client.get("/observability/model-prices");
    return data as ModelPricesResponse;
  },
  async setModelPrice(payload: {
    model: string;
    input_cost_per_token: number;
    output_cost_per_token: number;
    cache_read_cost_per_token?: number;
  }): Promise<{ message: string; model?: string; custom_prices: Record<string, ModelPrice> }> {
    const { data } = await client.post("/observability/model-prices", payload);
    return data as { message: string; model?: string; custom_prices: Record<string, ModelPrice> };
  },
  async deleteModelPrice(model: string): Promise<{ message: string; model: string; custom_prices: Record<string, ModelPrice> }> {
    const { data } = await client.delete("/observability/model-prices", { params: { model } });
    return data as { message: string; model: string; custom_prices: Record<string, ModelPrice> };
  },
  streamPath(filter: RecordFilter): string {
    const params = filterParams(filter);
    params.delete("page");
    params.delete("page_size");
    params.delete("before_id");
    const query = params.toString();
    return `/observability/request-db/stream${query ? `?${query}` : ""}`;
  },
  async storage(): Promise<RequestDBStorageInfo> {
    const { data } = await client.get("/observability/request-db/storage");
    return data as RequestDBStorageInfo;
  },
  async clean(opts: RequestDBCleanOptions): Promise<RequestDBCleanResult> {
    const { data } = await client.post("/observability/request-db/clean", opts);
    return data as RequestDBCleanResult;
  },
};

// --------------------------------------------------------------- server info

export const server = {
  async info(): Promise<ServerInfo> {
    const { data } = await client.get("/server/info");
    return data as ServerInfo;
  },
  async latestVersion(): Promise<string> {
    const { data } = await client.get("/server/latest-version");
    return (data as { "latest-version": string })["latest-version"];
  },
};

// ------------------------------------------------------------------- config

export interface ConfigGetResponse<T = Record<string, unknown>> {
  config: T;
  etag: string;
}

export interface CodexWebsocketProbeRequest {
  base_url: string;
  api_key: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  model?: string;
  disable_codex_cloaking?: boolean;
}

export type CodexWebsocketProbeStatus =
  | "supported"
  | "unsupported"
  | "auth_error"
  | "model_error"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "network_error";

export interface CodexWebsocketProbeResponse {
  supported: boolean;
  status: CodexWebsocketProbeStatus;
  stage: string;
  probe_mode?: "prewarm" | "fallback_chat";
  endpoint: string;
  model: string;
  http_status?: number;
  close_code?: number;
  error_code?: string;
  event_type?: string;
  latency_ms: number;
  message?: string;
  raw_error?: string;
}

export const config = {
  /** GET /config returns the v8 document itself plus a strong ETag. */
  async get<T = Record<string, unknown>>(): Promise<ConfigGetResponse<T>> {
    const { data, headers } = await client.get("/config");
    return { config: data as T, etag: (headers.etag as string) ?? "" };
  },
  /** PATCH /config/<path> merges the body object into the value at path. */
  async patchPath(path: string, body: unknown, etag: string): Promise<void> {
    await client.patch(`/config/${path}`, body, { headers: { "If-Match": etag } });
  },
  async getYAML(): Promise<{ yaml: string; etag: string }> {
    const { data, headers } = await client.get("/config.yaml", { responseType: "text", transformResponse: (r) => r });
    return { yaml: data as string, etag: (headers.etag as string) ?? "" };
  },
  async putYAML(yaml: string, etag: string): Promise<void> {
    await client.put("/config.yaml", yaml, {
      headers: { "If-Match": etag, "Content-Type": "application/yaml" },
      transformRequest: [(value) => value],
    });
  },
  /** Generic credentialed upstream HTTP tool (connectivity tests, model discovery). */
  async apiCall(body: Record<string, unknown>): Promise<{ status_code: number; header: Record<string, string>; body: string }> {
    const { data } = await client.post("/requests/api-call", body);
    return data as { status_code: number; header: Record<string, string>; body: string };
  },
  /** Probe whether a Codex upstream supports Responses API over WebSocket. */
  async probeCodexWebsocket(body: CodexWebsocketProbeRequest): Promise<CodexWebsocketProbeResponse> {
    const { data } = await client.post("/requests/codex-websocket-probe", body);
    return data as CodexWebsocketProbeResponse;
  },
};

// --------------------------------------------------------------- credentials

export const credentials = {
  async list(params?: { page?: number; page_size?: number }): Promise<AuthFileListResponse> {
    const { data } = await client.get("/credentials", { params });
    return data as AuthFileListResponse;
  },
  async models(name: string): Promise<ModelInfo[]> {
    const { data } = await client.get("/credentials/models", { params: { name } });
    return (data as { models: ModelInfo[] }).models;
  },
  async syncModels(body: { name?: string; auth_index?: string }): Promise<{ ok: boolean; models: ModelInfo[]; count?: number; cached?: boolean; synced_at?: string; synced_peers?: number }> {
    const { data } = await client.post("/credentials/models/sync", body);
    return data as { ok: boolean; models: ModelInfo[]; count?: number; cached?: boolean; synced_at?: string; synced_peers?: number };
  },
  async upload(files: File[]): Promise<{ status?: string; uploaded?: number; failed?: { name: string; error: string }[] }> {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const { data } = await client.post("/credentials", form);
    return data as { status?: string; uploaded?: number; failed?: { name: string; error: string }[] };
  },
  async remove(names: string[], all = false): Promise<void> {
    await client.delete("/credentials", { params: all ? { all: "true" } : { name: names } });
  },
  async setStatus(name: string, disabled: boolean, authIndex?: string): Promise<void> {
    await client.patch("/credentials/status", { name, auth_index: authIndex, disabled });
  },
  async setFields(name: string, fields: Record<string, unknown>): Promise<void> {
    await client.patch("/credentials/fields", { name, ...fields });
  },
  async refresh(body: { name?: string; auth_index?: string; all?: boolean }): Promise<unknown> {
    const { data } = await client.post("/credentials/refresh", body);
    return data;
  },
  async download(name: string): Promise<void> {
    const response = await client.get("/credentials/download", { params: { name }, responseType: "blob" });
    triggerBlobDownload(response.data as Blob, name);
  },
};

// --------------------------------------------------------------------- oauth

export interface OAuthProviderSpec {
  id: string;
  /** browser flows open a URL; device flows show a code. */
  flow: "browser" | "device" | "plugin";
  domain?: string;
}

/** Built-in providers exposed by GET /oauth/auth-url?provider=. */
export const OAUTH_PROVIDERS: OAuthProviderSpec[] = [
  { id: "claude", flow: "browser" },
  { id: "codex", flow: "browser" },
  { id: "antigravity", flow: "browser" },
  { id: "devin", flow: "browser" },
  { id: "xai", flow: "device" },
  { id: "kimi", flow: "device" },
  { id: "kimi-ai", flow: "device" },
  { id: "meta", flow: "device" },
];

export const oauth = {
  async start(provider: string, opts?: { isWebUI?: boolean; domain?: string }): Promise<OAuthStartResponse> {
    const params: Record<string, string> = { provider };
    if (opts?.isWebUI) params.is_webui = "true";
    if (opts?.domain) params.domain = opts.domain;
    const { data } = await client.get("/oauth/auth-url", { params });
    return data as OAuthStartResponse;
  },
  async status(state: string): Promise<OAuthPollStatus> {
    const { data } = await client.get("/oauth/status", { params: { state } });
    return data as OAuthPollStatus;
  },
  async cancel(state: string): Promise<void> {
    await client.delete("/oauth/session", { params: { state } });
  },
  /** Submit a pasted redirect URL / code manually (remote or headless setups). */
  async callback(body: { provider?: string; redirect_url?: string; code?: string; state: string; error?: string; client_id?: string }): Promise<void> {
    await client.post("/oauth/callback", body);
  },
  async siwcBind(name: string): Promise<OAuthStartResponse> {
    const { data } = await client.post("/oauth/siwc/bind", { name });
    return data as OAuthStartResponse;
  },
  async siwcStatus(params: { name?: string; id?: string; auth_index?: string }): Promise<{ status: "off" | "valid" | "invalid" }> {
    const { data } = await client.get("/oauth/siwc/status", { params });
    return data as { status: "off" | "valid" | "invalid" };
  },
  async importVertex(file: File, location: string): Promise<{ auth_file?: string; project_id?: string; email?: string }> {
    const form = new FormData();
    form.append("file", file);
    const { data } = await client.post("/oauth/import", form, { params: { provider: "vertex", location } });
    return data as { auth_file?: string; project_id?: string; email?: string };
  },
};

// --------------------------------------------------------------------- quota

export const quota = {
  async providers(): Promise<QuotaProviderInfo[]> {
    const { data } = await client.get("/quota/providers").catch(() => ({ data: { providers: [] } }));
    return (data as { providers: QuotaProviderInfo[] }).providers;
  },
  async fetch(body: { auth_index: string; plugin_id?: string; provider?: string }): Promise<unknown> {
    const { data } = await client.post("/quota/fetch", body);
    return data;
  },
  async reset(body: { auth_index: string; plugin_id?: string; provider?: string }): Promise<unknown> {
    const { data } = await client.post("/quota/reset", body);
    return data;
  },
  async resetRouting(authIndex: string): Promise<unknown> {
    const { data } = await client.post("/routing/cooldown/reset", { auth_index: authIndex });
    return data;
  },
  async pluginQuota(pluginId: string, authIndex: string): Promise<unknown> {
    const { data } = await client.get(`/plugins/${pluginId}/quota`, { params: { auth_index: authIndex } });
    return data;
  },
};

// ------------------------------------------------------------------- plugins

export type PluginListResult = PluginInfo[] & {
  plugins_enabled?: boolean;
  plugins_dir?: string;
};

export interface PluginStoreResult {
  plugins_enabled?: boolean;
  plugins_dir?: string;
  sources_count?: number;
  plugins: PluginStoreItem[];
  sources?: unknown[];
  source_errors?: string[];
}

export const plugins = {
  async list(): Promise<PluginListResult> {
    const { data } = await client.get("/plugins");
    const payload = data as {
      plugins_enabled?: boolean;
      plugins_dir?: string;
      plugins?: PluginInfo[];
    };
    const arr = (payload.plugins ?? []) as PluginListResult;
    arr.plugins_enabled = Boolean(payload.plugins_enabled);
    arr.plugins_dir = payload.plugins_dir || "plugins";
    return arr;
  },
  async store(): Promise<PluginStoreResult> {
    const { data } = await client.get("/plugins/store");
    return data as PluginStoreResult;
  },
  async install(storeId: string, opts?: { version?: string; source?: string }): Promise<void> {
    let id = (storeId || "").trim();
    const params: { version?: string; source?: string } = { ...opts };
    const lastSlash = id.lastIndexOf("/");
    if (lastSlash >= 0) {
      const sourcePart = id.slice(0, lastSlash).trim();
      const idPart = id.slice(lastSlash + 1).trim();
      if (sourcePart && !params.source) {
        params.source = sourcePart;
      }
      if (idPart) {
        id = idPart;
      }
    }
    await client.post(`/plugins/store/${encodeURIComponent(id)}/install`, null, { params });
  },
  async remove(id: string): Promise<void> {
    await client.delete(`/plugins/${id}`);
  },
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await client.patch(`/plugins/${id}/enabled`, { enabled }, v0());
  },
  async getConfig(id: string): Promise<Record<string, unknown>> {
    const { data } = await client.get(`/plugins/${id}/config`, v0());
    return (data || {}) as Record<string, unknown>;
  },
  async putConfig(id: string, body: unknown): Promise<void> {
    await client.put(`/plugins/${id}/config`, body, v0());
  },
};

// ---------------------------------------------------------------- file logs

export const fileLogs = {
  async lines(params: { limit?: number; cursor?: string; after?: number }): Promise<LogLinesResponse> {
    const { data } = await client.get("/observability/logs", { params });
    return data as LogLinesResponse;
  },
  async clear(): Promise<void> {
    await client.delete("/observability/logs");
  },
  async errorLogs(): Promise<ErrorLogFile[]> {
    const { data } = await client.get("/observability/logs/errors");
    return (data as { files: ErrorLogFile[] }).files;
  },
  async downloadErrorLog(name: string): Promise<void> {
    const response = await client.get(`/observability/logs/errors/${name}`, { responseType: "blob" });
    triggerBlobDownload(response.data as Blob, name);
  },
  async downloadRequestLog(requestID: string): Promise<void> {
    const response = await client.get(`/observability/logs/requests/${requestID}`, { responseType: "blob" });
    triggerBlobDownload(response.data as Blob, `${requestID}.log`);
  },
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------- api-key provider lists

/** CRUD against the generic string-list and typed provider-list endpoints.
 *  These list endpoints live only under the legacy v0 prefix. */
export const providerLists = {
  async getList<T>(path: string, responseKey: string): Promise<T[]> {
    const { data } = await client.get(`/${path}`, v0());
    const value = (data as Record<string, unknown>)[responseKey];
    return Array.isArray(value) ? (value as T[]) : [];
  },
  async getMap<T>(path: string, responseKey: string): Promise<T> {
    const { data } = await client.get(`/${path}`, v0());
    return ((data as Record<string, unknown>)[responseKey] ?? {}) as T;
  },
  /** Typed/string lists accept a bare array or an {"items": [...]} wrapper. */
  async putList<T>(path: string, items: T[]): Promise<void> {
    await client.put(`/${path}`, { items }, v0());
  },
  /** Map-shaped endpoints (oauth-excluded-models, oauth-model-alias) take the bare object. */
  async putMap(path: string, map: unknown): Promise<void> {
    await client.put(`/${path}`, map, v0());
  },
};

const V8_SHARED_KEY_FIELDS = new Set([
  "base-url",
  "priority",
  "disabled",
  "prefix",
  "proxy-url",
  "headers",
  "models",
  "excluded-models",
  "disable-cooling",
  "request-retry",
  "max-concurrency",
  "request-scoped-errors",
  "service-tier",
  "connection-pool",
]);

function stripAuthIndex<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const { "auth-index": _a1, auth_index: _a2, ...rest } = obj;
  return rest;
}

/** V8 API-key provider list adapter over /v8/management/config/api-keys/:kind. */
export const apiKeyProviders = {
  async getList<T extends Record<string, unknown>>(kindId: string): Promise<T[]> {
    let raw: unknown;
    try {
      const { data } = await client.get(`/config/api-keys/${encodeURIComponent(kindId)}`);
      raw = data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return [];
      }
      throw error;
    }
    if (!Array.isArray(raw)) return [];

    if (kindId === "openai-compatibility") {
      return raw.map((item) => {
        const group = (item ?? {}) as Record<string, unknown>;
        const { keys, ...rest } = group;
        const entries = Array.isArray(keys) ? keys : (group["api-key-entries"] as unknown[] | undefined);
        return {
          ...rest,
          ...(entries !== undefined ? { "api-key-entries": entries } : {}),
        } as T;
      });
    }

    const out: T[] = [];
    for (const item of raw) {
      const group = (item ?? {}) as Record<string, unknown>;
      const { keys, name: _groupName, ...groupShared } = group;
      const keyList = Array.isArray(keys) ? keys : [];
      if (keyList.length === 0) continue;
      for (const k of keyList) {
        const keyObj = (k ?? {}) as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...groupShared, ...keyObj };
        const groupPool = groupShared["connection-pool"];
        const keyPool = keyObj["connection-pool"];
        if (
          groupPool &&
          typeof groupPool === "object" &&
          !Array.isArray(groupPool) &&
          keyPool &&
          typeof keyPool === "object" &&
          !Array.isArray(keyPool)
        ) {
          merged["connection-pool"] = {
            ...(groupPool as Record<string, unknown>),
            ...(keyPool as Record<string, unknown>),
          };
        }
        out.push(merged as T);
      }
    }
    return out;
  },

  async putList<T extends Record<string, unknown>>(kindId: string, items: T[]): Promise<void> {
    const path = `/config/api-keys/${encodeURIComponent(kindId)}`;
    if (items.length === 0) {
      try {
        await client.delete(path);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return;
        }
        throw error;
      }
      return;
    }

    if (kindId === "openai-compatibility") {
      const payload = items.map((entry) => {
        const { "api-key-entries": apiKeyEntries, ...rest } = stripAuthIndex(entry);
        const cleanKeys = Array.isArray(apiKeyEntries)
          ? apiKeyEntries.map((k) => stripAuthIndex((k ?? {}) as Record<string, unknown>))
          : [];
        return { ...rest, keys: cleanKeys };
      });
      await client.put(path, payload);
      return;
    }

    const payload = items.map((entry, index) => {
      const clean = stripAuthIndex(entry);
      const group: Record<string, unknown> = { name: `${kindId}-${index + 1}` };
      const keyEntry: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(clean)) {
        if (v === undefined) continue;
        if (V8_SHARED_KEY_FIELDS.has(k)) {
          group[k] = v;
        } else {
          keyEntry[k] = v;
        }
      }
      group.keys = [keyEntry];
      return group;
    });
    await client.put(path, payload);
  },
};

// ------------------------------------------------------------- modelDefinitions

export const modelDefinitions = {
  async getByChannel(channel: string): Promise<ModelInfo[]> {
    try {
      const { data } = await client.get(`/routing/model-definitions/${encodeURIComponent(channel)}`);
      return (data as { models: ModelInfo[] }).models ?? [];
    } catch {
      return [];
    }
  },
};
