"use client";

import { isFirebaseConfigured, getUser } from "./firebase";

// Client plumbing for the /admin console: every screen fetches the same way
// (Bearer token when Firebase is configured), maps 404 to "denied" (the
// server's flat-404 design means denied and missing are indistinguishable on
// purpose), and mutates with JSON bodies. Shared so eight screens don't each
// reimplement the token dance the two originals duplicated.

export type AdminState = "loading" | "ok" | "denied" | "error";

export async function adminHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (isFirebaseConfigured()) {
    const user = await getUser();
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  return headers;
}

export interface AdminResult<T> {
  status: number;
  ok: boolean;
  denied: boolean;
  data: T | null;
  /** Server-provided error message, when the body carried one. */
  error: string | null;
}

async function run<T>(
  path: string,
  init: RequestInit
): Promise<AdminResult<T>> {
  try {
    const res = await fetch(path, init);
    const denied = res.status === 404;
    let data: T | null = null;
    let error: string | null = null;
    try {
      const body = await res.json();
      if (res.ok) data = body as T;
      else if (body && typeof body.error === "string") error = body.error;
    } catch {
      // non-JSON body (the flat-404 text, an empty response)
    }
    return { status: res.status, ok: res.ok, denied, data, error };
  } catch {
    return { status: 0, ok: false, denied: false, data: null, error: null };
  }
}

export async function adminGet<T>(path: string): Promise<AdminResult<T>> {
  return run<T>(path, { headers: await adminHeaders() });
}

export async function adminSend<T>(
  path: string,
  method: "POST" | "DELETE",
  body: Record<string, unknown>
): Promise<AdminResult<T>> {
  return run<T>(path, {
    method,
    headers: {
      ...(await adminHeaders()),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Authenticated file download (the admin data export). A `body` makes it a
 *  POST — the export route requires one, carrying the typed confirmEmail. */
export async function adminDownload(
  path: string,
  filename: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res = await fetch(path, {
      ...(body
        ? {
            method: "POST",
            body: JSON.stringify(body),
          }
        : {}),
      headers: {
        ...(await adminHeaders()),
        ...(body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      let error: string | null = null;
      try {
        const body = await res.json();
        if (body && typeof body.error === "string") error = body.error;
      } catch {
        // ignore
      }
      return { ok: false, error };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: null };
  }
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtMoney(
  cents: number | null | undefined,
  currency: string | null | undefined
): string {
  if (typeof cents !== "number") return "-";
  return `${(cents / 100).toFixed(2)} ${String(currency ?? "usd").toUpperCase()}`;
}
