import { adminApiUrl, adminAuthHeaders } from "../adminFetch";
import type {
  LabConfigSummary,
  LabInteractionMode,
  LabLiveStatus,
  LabPreflightResult,
  LabRunsResponse,
  LabSessionDetail,
  LabThinkingMode,
} from "./LabTypes";

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(adminApiUrl(path), {
    ...init,
    headers: adminAuthHeaders(init?.headers),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function fetchLabConfig(): Promise<LabConfigSummary> {
  return jsonRequest<LabConfigSummary>("/api/admin/lab/config");
}

export async function fetchLabStatus(): Promise<LabLiveStatus> {
  return jsonRequest<LabLiveStatus>("/api/admin/lab/status");
}

export async function fetchLabRuns(params: {
  includeMock: boolean;
  status: string;
}): Promise<LabRunsResponse> {
  const q = new URLSearchParams({
    includeMock: params.includeMock ? "1" : "0",
    status: params.status,
  });
  return jsonRequest<LabRunsResponse>(`/api/admin/lab/runs?${q}`);
}

export async function fetchLabSessionDetail(sessionId: string): Promise<LabSessionDetail> {
  return jsonRequest<LabSessionDetail>(`/api/admin/lab/sessions/${encodeURIComponent(sessionId)}`);
}

export async function runLabPreflightApi(models: string[]): Promise<LabPreflightResult> {
  return jsonRequest<LabPreflightResult>("/api/admin/lab/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
}

export async function startLabRunApi(payload: {
  condition: string;
  name?: string;
  notes?: string;
  games: number;
  seedBase?: number;
  chatEnabled: boolean;
  memoryEnabled: boolean;
  predictionEnabled: boolean;
  autoSocialScore: boolean;
  mock: boolean;
  tokenBudgetPerAgent: number;
  models: string[];
  interactionMode?: LabInteractionMode;
  thinkingMode?: LabThinkingMode;
  publicChatEnabled?: boolean;
  privateChatEnabled?: boolean;
  customGroupsEnabled?: boolean;
  transferEnabled?: boolean;
  auctionEnabled?: boolean;
  buffCardsEnabled?: boolean;
  coffeeEnabled?: boolean;
  customSystemPrompt?: string;
}): Promise<{ ok: boolean }> {
  return jsonRequest<{ ok: boolean }>("/api/admin/lab/runs/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function stopLabRunApi(): Promise<{ ok: boolean }> {
  return jsonRequest<{ ok: boolean }>("/api/admin/lab/runs/stop", {
    method: "POST",
  });
}

export async function deleteLabRunApi(runId: string): Promise<{ ok: boolean }> {
  return jsonRequest<{ ok: boolean }>(`/api/admin/lab/runs/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
}

export async function downloadLabFile(apiPath: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(adminApiUrl(apiPath), {
    headers: adminAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const filename = match ? decodeURIComponent(match[1]) : fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
