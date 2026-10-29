import axios, { AxiosError, type AxiosInstance } from "axios";
import { currentKey, useAuthStore } from "@/stores/auth";
import { ApiError } from "./types";
export const MANAGEMENT_PREFIX = "/v8/management";
/**
 * The v8 contract is intentionally independent of the legacy v0 surface
 * (pinned by TestManagementV8IndependentContract): provider key lists, quota
 * probes and plugin config/enabled operations only exist under /v0/management,
 * so those specific calls go there. Same management key, same auth middleware.
 */
export const V0_MANAGEMENT_PREFIX = "/v0/management";

const v0Base = window.location.origin + V0_MANAGEMENT_PREFIX;

/** Per-request axios config targeting the legacy management prefix. */
export function v0(): { baseURL: string } {
  return { baseURL: v0Base };
}

/** Absolute URL for a v8 management path — the one place that builds
 *  non-axios request URLs (e.g. the SSE fetch), so the prefix cannot drift. */
export function managementURL(path: string): string {
  return window.location.origin + MANAGEMENT_PREFIX + path;
}

export const client: AxiosInstance = axios.create({
  baseURL: window.location.origin + MANAGEMENT_PREFIX,
  timeout: 30_000,
});

client.interceptors.request.use((config) => {
  const key = currentKey();
  if (key) config.headers.Authorization = `Bearer ${key}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status ?? 0;
    let message = error.message;
    const data = error.response?.data as { error?: string; message?: string } | undefined;
    if (data?.message) message = data.message;
    else if (data?.error) message = data.error;
    if (status === 401 || (status === 403 && /management key/i.test(message))) {
      useAuthStore.getState().clear();
    }
    return Promise.reject(new ApiError(message, status));
  },
);
