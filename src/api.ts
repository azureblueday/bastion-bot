import crypto from "crypto";

const BASE = (process.env.BASTION_API_URL || "http://localhost:3000").replace(/\/$/, "");
const HMAC_KEY = process.env.BOT_HMAC_KEY || "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function sign(method: string, pathname: string, rawBody: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = method.toUpperCase() + pathname + rawBody + ts + nonce;
  const signature = crypto.createHmac("sha256", HMAC_KEY).update(payload).digest("hex");
  return {
    "content-type": "application/json",
    "x-bot-signature": signature,
    "x-bot-timestamp": ts,
    "x-bot-nonce": nonce,
  };
}

async function call<T>(method: string, path: string, body?: object): Promise<T> {
  const url = new URL(BASE + path);
  const rawBody = body ? JSON.stringify(body) : "";
  const headers = sign(method, url.pathname, method === "GET" ? "" : rawBody);

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: method === "GET" ? undefined : rawBody,
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg =
      (json as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return json as T;
}

export type BotKey = {
  id: string;
  keyPrefix: string;
  last4: string;
  key: string | null;
  isLifetime: boolean;
  isLocked: boolean;
  lockReason: string | null;
  expiresAt: string | null;
  hwid: string | null;
  lastSeen: string | null;
  note: string | null;
  discordId: string | null;
  executions: number;
  projectId: string | null;
  project: string | null;
};

export const api = {
  generate: (body: {
    projectId: string;
    count: number;
    durationDays?: number;
    isLifetime?: boolean;
    note?: string;
    reason?: string;
    adminId?: string;
  }) =>
    call<{ keys: { id: string; raw: string }[] }>("POST", "/api/bot/keys", body),

  lookup: (params: { key?: string; discordId?: string; projectId?: string }) => {
    const q = new URLSearchParams();
    if (params.key) q.set("key", params.key);
    if (params.discordId) q.set("discordId", params.discordId);
    if (params.projectId) q.set("projectId", params.projectId);
    return call<{ keys: BotKey[] }>("GET", `/api/bot/lookup?${q.toString()}`);
  },

  manage: (body: {
    action: "reset_hwid" | "lock" | "unlock" | "set_discord" | "set_note";
    keyId: string;
    discordId?: string;
    note?: string;
    lockReason?: string;
    adminId?: string;
  }) => call<{ ok: true }>("POST", "/api/bot/manage", body),

  stats: (projectId?: string) => {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return call<{
      project: string | null;
      total: number;
      active: number;
      locked: number;
      expired: number;
      executions: number;
    }>("GET", `/api/bot/stats${q}`);
  },

  getPanel: (guildId: string) =>
    call<{ panel: GuildPanel | null }>(
      "GET",
      `/api/bot/panel?guildId=${encodeURIComponent(guildId)}`
    ),

  setPanel: (body: {
    guildId: string;
    buyerRoleId: string;
    managerRoleId?: string | null;
    loaderText: string;
    createdBy?: string;
  }) => call<{ ok: true }>("POST", "/api/bot/panel", body),

  login: (body: { guildId: string; apiKey: string }) =>
    call<{
      username: string;
      userId: string;
      projectId: string | null;
      projectName: string | null;
    }>("POST", "/api/bot/login", body),
};

export type GuildPanel = {
  guildId: string;
  buyerRoleId: string | null;
  managerRoleId: string | null;
  loaderText: string | null;
  linkedUserId: string | null;
  defaultProjectId: string | null;
};
