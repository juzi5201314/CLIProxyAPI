import type { AxiosResponse } from "axios";

/** One stored request record from the fork-local request database. */
export interface RequestRecord {
  id: number;
  requested_at: number;
  request_id: string;
  trace_id?: string;
  endpoint?: string;
  client_ip?: string;
  resolved_client_ip?: string;
  x_forwarded_for?: string;
  user_agent?: string;
  session_id?: string;
  parent_session_id?: string;
  api_key?: string;
  access_provider?: string;
  is_native_key: boolean;
  provider?: string;
  executor_type?: string;
  upstream_websocket?: boolean;
  auth_id?: string;
  auth_index?: string;
  auth_type?: string;
  source?: string;
  base_url?: string;
  model?: string;
  alias?: string;
  response_model?: string;
  reasoning_effort?: string;
  requested_reasoning_effort?: string;
  service_tier?: string;
  effective_service_tier?: string;
  response_service_tier?: string;
  generate: boolean;
  stream: boolean;
  failed: boolean;
  status_code: number;
  latency_ms: number;
  ttft_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  // Detail-only fields:
  token_breakdown?: unknown;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  error_body?: string;
  request_preview?: string;
  response_preview?: string;
}

export interface RequestRecordPage {
  records: RequestRecord[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface RequestDBStorageInfo {
  enabled: boolean;
  path: string;
  retention_days: number;
  total_records: number;
  failed_records: number;
  payload_records: number;
  earliest_record_ms: number;
  latest_record_ms: number;
  file_size_bytes: number;
  wal_size_bytes: number;
  total_file_size_bytes: number;
  compressed_payload_bytes: number;
  estimated_uncompressed_bytes: number;
  compression_ratio: number;
}

export interface RequestDBCleanOptions {
  action: "delete_before" | "delete_failed" | "strip_payloads" | "cap_size" | "clear_all" | "vacuum";
  before_days?: number;
  before_ms?: number;
  target_size_mb?: number;
  vacuum?: boolean;
}

export interface RequestDBCleanResult {
  action: string;
  affected_rows: number;
  vacuum_run: boolean;
  file_size_bytes_before: number;
  file_size_bytes_after: number;
}

export interface TPSBucket {
  label: string;
  count: number;
}

export interface ModelPrice {
  input_cost_per_token: number;
  output_cost_per_token: number;
  cache_read_cost_per_token?: number;
}

export interface ModelPricesResponse {
  prices: Record<string, ModelPrice>;
  custom_prices?: Record<string, ModelPrice>;
  count: number;
}

export interface RequestDBStats {
  total_requests: number;
  failed_requests: number;
  stream_requests: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  unique_models: number;
  unique_providers: number;
  unique_api_keys: number;
  unique_sessions: number;
  first_request_ms: number;
  last_request_ms: number;
  latency_avg_ms: number;
  latency_p50_ms: number;
  latency_p90_ms: number;
  latency_p99_ms: number;
  latency_sampled: boolean;
  ttft_requests: number;
  ttft_avg_ms: number;
  ttft_p50_ms: number;
  ttft_p90_ms: number;
  ttft_sampled: boolean;
  tps_rows: number;
  tps_avg: number;
  tps_p50: number;
  tps_p90: number;
  tps_sampled: boolean;
  tps_histogram: TPSBucket[];
}

export interface TimeseriesPoint {
  bucket_ms: number;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  latency_avg_ms: number;
  ttft_avg_ms: number;
  tps_avg: number;
}

export interface TimeseriesResponse {
  interval_ms: number;
  from_ms: number;
  to_ms: number;
  points: TimeseriesPoint[];
}

export interface BreakdownRow {
  key: string;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  latency_avg_ms: number;
  tps_avg: number;
}

export type BreakdownDimension = "model" | "provider" | "api_key" | "auth_id" | "session_id";

export interface ServerInfo {
  version: string;
  commit: string;
  build_date: string;
  plugin_support: string;
  uptime_seconds: number;
  request_db: { enabled: boolean };
}

/** Credential entry from GET /credentials (auth-files). */
export interface AuthFileEntry {
  id: string;
  auth_index?: string;
  name: string;
  type?: string;
  provider?: string;
  label?: string;
  status?: string;
  status_message?: string;
  disabled?: boolean;
  unavailable?: boolean;
  runtime_only?: boolean;
  source?: string;
  size?: number;
  success?: number;
  failed?: number;
  recent_requests?: { time: number; success: number; failed: number }[];
  quota?: unknown;
  manual_quota?: {
    data: unknown;
    fetched_at: string;
    base_success: number;
    base_failed: number;
  };
  model_quotas?: Record<string, unknown>;
  supports_quota?: boolean;
  quota_provider?: string;
  email?: string;
  project_id?: string;
  account_type?: string;
  plan_type?: string;
  active_resets?: string | number;
  modtime?: string;
  id_token?: Record<string, unknown>;
  created_at?: number;
  updated_at?: string;
  last_refresh?: string;
  next_retry_after?: string;
  path?: string;
  priority?: number;
  note?: string;
  weight?: number;
  websockets?: boolean;
  request_retry?: number;
  max_concurrency?: number;
  cooldowns?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AuthFileListResponse {
  observed_at: number;
  files: AuthFileEntry[];
  total?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
}

export interface ModelInfo {
  id: string;
  display_name?: string;
  type?: string;
  owned_by?: string;
}

export interface PluginMenu {
  path: string;
  menu: string;
  description?: string;
  title?: string;
  url?: string;
  icon?: string;
}

export interface PluginConfigField {
  default?: unknown;
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "enum" | "array" | "object" | string;
  enum_values?: string[];
  description?: string;
}

export interface PluginInfo {
  id: string;
  path?: string;
  configured: boolean;
  registered: boolean;
  enabled: boolean;
  effective_enabled: boolean;
  supports_oauth: boolean;
  oauth_provider?: string;
  supports_quota: boolean;
  quota_provider?: string;
  logo?: string;
  config_fields?: PluginConfigField[];
  menus?: PluginMenu[];
  metadata?: {
    name?: string;
    version?: string;
    author?: string;
    description?: string;
    homepage?: string;
    repository?: string;
    github_repository?: string;
    logo?: string;
    config_fields?: PluginConfigField[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PluginStoreItem {
  store_id: string;
  source_id?: string;
  source_name?: string;
  source_url?: string;
  id?: string;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  repository?: string;
  install_type?: string;
  auth_required: boolean;
  auth_configured: boolean;
  platforms?: { goos: string; goarch: string }[];
  logo?: string;
  homepage?: string;
  license?: string;
  tags?: string[];
  installed: boolean;
  installed_version?: string;
  installed_source_id?: string;
  install_source_status?: string;
  path?: string;
  configured?: boolean;
  registered?: boolean;
  enabled?: boolean;
  effective_enabled?: boolean;
  update_available: boolean;
  [key: string]: unknown;
}

export interface OAuthStartResponse {
  status?: string;
  url: string;
  state: string;
  flow?: string;
  user_code?: string;
  expires_in?: number;
  [key: string]: unknown;
}

export type OAuthPollStatus =
  | { status: "ok" }
  | { status: "error"; error: string }
  | { status: "wait" };

export interface LogLinesResponse {
  lines: string[];
  "line-count": number;
  "latest-timestamp": number;
  "next-cursor"?: string;
  "cursor-reset"?: boolean;
}

export interface ErrorLogFile {
  name: string;
  size: number;
  modified: string;
}

export interface QuotaProviderInfo {
  id?: string;
  provider?: string;
  plugin_id?: string;
  [key: string]: unknown;
}

/** Normalized API error surfaced by the axios interceptor. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function errMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errStatus(error: unknown): number {
  if (error instanceof ApiError) return error.status;
  if ((error as { response?: AxiosResponse })?.response) {
    return (error as { response: AxiosResponse }).response.status;
  }
  return 0;
}
