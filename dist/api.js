"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = exports.ApiError = void 0;
const crypto_1 = __importDefault(require("crypto"));
const BASE = (process.env.BASTION_API_URL || "http://localhost:3000").replace(/\/$/, "");
const HMAC_KEY = process.env.BOT_HMAC_KEY || "";
class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.ApiError = ApiError;
function sign(method, pathname, rawBody) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto_1.default.randomBytes(16).toString("hex");
    const payload = method.toUpperCase() + pathname + rawBody + ts + nonce;
    const signature = crypto_1.default.createHmac("sha256", HMAC_KEY).update(payload).digest("hex");
    return {
        "content-type": "application/json",
        "x-bot-signature": signature,
        "x-bot-timestamp": ts,
        "x-bot-nonce": nonce,
    };
}
async function call(method, path, body) {
    const url = new URL(BASE + path);
    const rawBody = body ? JSON.stringify(body) : "";
    const headers = sign(method, url.pathname, method === "GET" ? "" : rawBody);
    const res = await fetch(url.toString(), {
        method,
        headers,
        body: method === "GET" ? undefined : rawBody,
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch {
        json = null;
    }
    if (!res.ok) {
        const msg = json?.error || `Request failed (${res.status})`;
        throw new ApiError(res.status, msg);
    }
    return json;
}
exports.api = {
    generate: (body) => call("POST", "/api/bot/keys", body),
    lookup: (params) => {
        const q = new URLSearchParams();
        if (params.key)
            q.set("key", params.key);
        if (params.discordId)
            q.set("discordId", params.discordId);
        if (params.projectId)
            q.set("projectId", params.projectId);
        return call("GET", `/api/bot/lookup?${q.toString()}`);
    },
    manage: (body) => call("POST", "/api/bot/manage", body),
    stats: (projectId) => {
        const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        return call("GET", `/api/bot/stats${q}`);
    },
    getPanel: (guildId) => call("GET", `/api/bot/panel?guildId=${encodeURIComponent(guildId)}`),
    setPanel: (body) => call("POST", "/api/bot/panel", body),
    login: (body) => call("POST", "/api/bot/login", body),
};
