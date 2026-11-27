import { client } from "./client";
import { ApiError } from "./types";

/** Read a nested v8 config subtree at /v8/management/config/<path>, returning fallback on 404. */
export async function getConfigPath<T>(path: string, fallback: T): Promise<{ value: T; etag: string }> {
  try {
    const { data, headers } = await client.get(`/config/${path}`);
    return {
      value: (data ?? fallback) as T,
      etag: (headers.etag as string) ?? "",
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { value: fallback, etag: "" };
    }
    throw error;
  }
}

/** Replace a nested v8 config subtree via PUT /v8/management/config/<path>. */
export async function putConfigPath(path: string, body: unknown, etag?: string): Promise<void> {
  await client.put(`/config/${path}`, body, etag ? { headers: { "If-Match": etag } } : undefined);
}

/** Delete a nested v8 config subtree via DELETE /v8/management/config/<path>, ignoring 404. */
export async function deleteConfigPath(path: string, etag?: string): Promise<void> {
  try {
    await client.delete(`/config/${path}`, etag ? { headers: { "If-Match": etag } } : undefined);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return;
    }
    throw error;
  }
}
