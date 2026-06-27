#!/usr/bin/env node
/**
 * NotiKeeper MCP server + ingest + dashboard.
 *
 * Three jobs in one process:
 *  1) HTTP POST /ingest   — receives uploads from the NotiKeeper app
 *     (point the app's "Upload API" endpoint here). Stores rows in a local
 *     JSONL file (deduplicated).
 *  2) HTTP dashboard      — GET /          serves a small browser dashboard
 *                          GET /api/messages, /api/stats, /events (SSE)
 *  3) MCP (stdio)         — exposes the same data as tools to Claude.
 *
 * All logs go to STDERR; STDOUT is reserved for the MCP protocol.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import QRCode from "qrcode";
import { openDb, reindex, listThreads, getThread, listUsers, statsSummary } from "./relations.mjs";
import { rebuildFromSqlite as rebuildGraph, neighbors as graphNeighbors,
         executeHql as graphHql, statusSync as graphStatus,
         embedMessages, searchSemantic } from "./graph-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.NOTIKEEPER_DATA || path.join(__dirname, "data.jsonl");
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");
const PORT = parseInt(process.env.NOTIKEEPER_PORT || "8765", 10);
const TOKEN = process.env.NOTIKEEPER_TOKEN || "";

const rows = [];
const seen = new Set();
const keyOf = (r) => `${r.id}-${r.time}`;

/** Live SSE subscribers (browsers watching the dashboard). */
const sseClients = new Set();
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { /* client gone */ }
  }
}

function load() {
  if (!fs.existsSync(DATA_FILE)) return;
  for (const line of fs.readFileSync(DATA_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      const k = keyOf(r);
      if (!seen.has(k)) { seen.add(k); rows.push(r); }
    } catch { /* skip */ }
  }
}

function ingest(arr) {
  const fresh = [];
  for (const r of arr) {
    if (r == null || r.id == null) continue;
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k); rows.push(r); fresh.push(r);
  }
  if (fresh.length) {
    fs.appendFileSync(DATA_FILE, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n");
    // incrementally fold the new rows into the relational DB
    try { reindex(RDB, fresh); } catch (e) { console.error("[relations] fold failed:", e.message); }
    broadcast("new", { count: fresh.length, total: rows.length, sample: fresh.slice(-3) });
  }
  return fresh.length;
}

load();
console.error(`[notikeeper-mcp] loaded ${rows.length} rows from ${DATA_FILE}`);

// Relational DB — derived view over data.jsonl
const RDB = openDb(path.join(__dirname, "relations.db"));
function rebuildRelations() {
  const result = reindex(RDB, rows);
  console.error(`[notikeeper-mcp] relations: +${result.inserted} (${result.threads} threads, ${result.users} users)`);
  return result;
}
rebuildRelations();

/** Return the first private-LAN IPv4 address (e.g. 192.168.x.x or 10.x), skipping
 *  loopback, link-local, and the noisy 172.x ranges used by WSL/Hyper-V. */
function getLanIp() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const ip = a.address;
      if (ip.startsWith("169.254.")) continue;     // link-local
      if (ip.startsWith("172.")) continue;          // WSL / Hyper-V
      if (ip.startsWith("192.168.") || ip.startsWith("10.")) return ip;
    }
  }
  return "127.0.0.1";
}

// ---------- noise rules (configurable via NOTIKEEPER_NOISE_OFF=1 to disable) ----------
const NOISE_APPS = new Set([
  "Meta App Manager", "Galaxy Store", "Samsung capture", "Samsung Internet",
  "Dashboard Test", "HealthCheck", "Android System", "Samsung DeX",
]);

const NOISE_PKG_PREFIX = ["com.samsung.android.app.", "com.android.systemui", "com.google.android.gms"];

// Apps the user marked as promotional/marketing (default heuristic; tweak per taste)
const PROMO_APPS = new Set(["7-Eleven", "Galaxy Store", "Grab"]);

const GENERIC_TITLES = [
  "การแจ้งเตือน", "Notification", "New notification", "New message", "Messages",
];

// Promo language patterns (Thai + English)
const PROMO_RE = /(โปรโม|พิเศษ ?\d|ราคาพิเศษ|sale|discount|ลด ?\d|ฟรี ?ดูค|click here|จองเลย|ส่งฟรี|coupon|รับเลย|กดรับ)/i;

// URL/sticker spam (e.g., line stickers)
const URL_ONLY_RE = /^https?:\/\/\S+\s*$/;

function classifyNoise(r) {
  const app = (r.app || "").trim();
  const pkg = (r.pkg || "").trim();
  const title = (r.title || "").trim();
  const text = (r.text || "").trim();

  if (NOISE_APPS.has(app)) return "system-app";
  if (NOISE_PKG_PREFIX.some((p) => pkg.startsWith(p))) return "system-pkg";
  if (!text && !title) return "empty";
  if (!text && title.length < 4) return "empty-text";
  if (GENERIC_TITLES.includes(title) && text.length < 12) return "generic-title";
  if (URL_ONLY_RE.test(text)) return "sticker-url";
  if (PROMO_RE.test(text) || PROMO_RE.test(title)) return "promo";
  if (PROMO_APPS.has(app) && r.source === "noti") return "promo-app";
  return null; // not noise
}

const isNoise = (r) => classifyNoise(r) !== null;

// ---------- helpers used by every layer ----------
const byNewest = (a, b) => b.time - a.time;

function filterRows({ query, app, source, sinceMs, denoise = false }) {
  const q = (query || "").toLowerCase();
  const a = (app || "").toLowerCase();
  return rows.filter((r) => {
    if (sinceMs && r.time < sinceMs) return false;
    if (source && r.source !== source) return false;
    if (a && !(r.app || "").toLowerCase().includes(a)) return false;
    if (q && !((r.text || "").toLowerCase().includes(q) ||
               (r.title || "").toLowerCase().includes(q) ||
               (r.app || "").toLowerCase().includes(q))) return false;
    if (denoise && isNoise(r)) return false;
    return true;
  });
}

const fmt = (r) =>
  `[${new Date(r.time).toLocaleString()}] ${r.app}` +
  `${r.title ? " · " + r.title : ""}` +
  `${r.side ? " (" + r.side + ")" : ""}: ${r.text}`;

// ---------- HTTP server ----------
const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS for any cross-origin browser (e.g. opening dashboard from file://)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // 1) Upload endpoint (the phone POSTs here)
  if (req.method === "POST" && url.pathname === "/ingest") {
    if (TOKEN && req.headers["authorization"] !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"error":"unauthorized"}');
      return;
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 50_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const n = ingest(Array.isArray(parsed) ? parsed : [parsed]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, received: n, total: rows.length }));
        console.error(`[notikeeper-mcp] ingested ${n} new (total ${rows.length})`);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  // 2) Dashboard SPA
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
    try {
      const html = fs.readFileSync(DASHBOARD_FILE);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500); res.end("dashboard.html missing");
    }
    return;
  }

  // 3) JSON APIs for the dashboard
  if (req.method === "GET" && url.pathname === "/api/messages") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 5000);
    const filtered = filterRows({
      query:  url.searchParams.get("q") || "",
      app:    url.searchParams.get("app") || "",
      source: url.searchParams.get("source") || "",
      sinceMs: parseInt(url.searchParams.get("since") || "0", 10) || 0,
      denoise: url.searchParams.get("denoise") === "1",
    }).sort(byNewest).slice(0, limit);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ total: filtered.length, all: rows.length, rows: filtered }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    const byApp = {}, bySource = {}, byNoise = {};
    let min = Infinity, max = -Infinity, noiseCount = 0;
    for (const r of rows) {
      byApp[r.app] = (byApp[r.app] || 0) + 1;
      bySource[r.source] = (bySource[r.source] || 0) + 1;
      if (r.time < min) min = r.time;
      if (r.time > max) max = r.time;
      const tag = classifyNoise(r);
      if (tag) { noiseCount++; byNoise[tag] = (byNoise[tag] || 0) + 1; }
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      total: rows.length,
      noiseCount,
      cleanCount: rows.length - noiseCount,
      byNoise,
      byApp: Object.fromEntries(Object.entries(byApp).sort((a, b) => b[1] - a[1])),
      bySource,
      minTime: rows.length ? min : null,
      maxTime: rows.length ? max : null,
    }));
    return;
  }

  // 4) Relational queries (Messenger-style: threads, users, messages)
  if (req.method === "GET" && url.pathname === "/api/threads") {
    const out = listThreads(RDB, {
      app: url.searchParams.get("app") || null,
      limit: Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 2000),
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ count: out.length, threads: out }));
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/threads/")) {
    const id = parseInt(url.pathname.split("/").pop(), 10);
    const t = getThread(RDB, id, { limit: parseInt(url.searchParams.get("limit") || "500", 10) });
    res.writeHead(t ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(t || { error: "not found" }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/users") {
    const out = listUsers(RDB, { limit: parseInt(url.searchParams.get("limit") || "200", 10) });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ count: out.length, users: out }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/relations") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(statsSummary(RDB)));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/relations/rebuild") {
    const r = rebuildRelations();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  // Graph (GenesisBlock) — vector+graph layer over the SQLite relations
  if (req.method === "POST" && url.pathname === "/api/graph/rebuild") {
    rebuildGraph(RDB).then(
      (r) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r)); },
      (e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String(e) })); }
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/graph/status") {
    graphStatus().then(
      (s) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(s)); },
      (e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String(e) })); }
    );
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/graph/neighbors/")) {
    const seed = decodeURIComponent(url.pathname.replace("/api/graph/neighbors/", ""));
    graphNeighbors(seed, {
      depth: parseInt(url.searchParams.get("depth") || "1", 10),
      rel: url.searchParams.get("rel") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "50", 10),
    }).then(
      (out) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ seed, count: out.length, neighbors: out })); },
      (e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String(e) })); }
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/graph/embed-all") {
    embedMessages(RDB, {
      onProgress: ({ done, failed, total }) => {
        if (done % 50 === 0) console.error(`[embed] ${done}/${total} (${failed} failed)`);
      },
    }).then(
      (r) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r)); },
      (e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String(e) })); }
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/graph/search") {
    const q = url.searchParams.get("q") || "";
    const k = parseInt(url.searchParams.get("k") || "20", 10);
    if (!q.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "q is required" })); return;
    }
    searchSemantic(q, { k }).then(
      (r) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ q, count: r.length, hits: r })); },
      (e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String(e) })); }
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/graph/hql") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const q = (() => { try { return JSON.parse(body).query; } catch { return body; } })();
      graphHql(q).then(
        (r) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ query: q, result: r })); },
        (e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String(e) })); }
      );
    });
    return;
  }

  // 5) Pairing info for the QR code shown on the dashboard
  if (req.method === "GET" && url.pathname === "/api/pair") {
    const ip = getLanIp();
    const endpoint = `http://${ip}:${PORT}/ingest`;
    const updateUrl = "https://github.com/Freshair129/notikeeper/releases/latest/download/version.json";
    const payload = {
      type: "notikeeper-pair",
      v: 1,
      endpoint,
      ip,
      port: PORT,
      token: TOKEN || "",
      updateUrl,
    };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
    return;
  }

  // Pre-rendered QR code as PNG so the dashboard works without any CDN.
  if (req.method === "GET" && url.pathname === "/api/pair-qr") {
    const ip = getLanIp();
    const endpoint = `http://${ip}:${PORT}/ingest`;
    const updateUrl = "https://github.com/Freshair129/notikeeper/releases/latest/download/version.json";
    const payload = JSON.stringify({
      type: "notikeeper-pair", v: 1,
      endpoint, token: TOKEN || "", updateUrl,
    });
    QRCode.toBuffer(payload, {
      width: 320, margin: 2,
      color: { dark: "#0F1B2D", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }).then((png) => {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Length": png.length,
      });
      res.end(png);
    }).catch((e) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("qr error: " + e.message);
    });
    return;
  }

  // 5) Server-Sent Events stream — pushes live updates when /ingest fires
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: hello\ndata: {"total":${rows.length}}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
    req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  res.writeHead(404); res.end("not found");
});

httpServer.listen(PORT, () =>
  console.error(`[notikeeper-mcp] HTTP on http://0.0.0.0:${PORT}  (dashboard /, ingest /ingest, events /events)`)
);

// ---------- MCP tools (same data, also exposed to Claude) ----------
const mcp = new McpServer({ name: "notikeeper", version: "1.1.0" });

mcp.tool(
  "search_messages",
  { query: z.string(), limit: z.number().optional() },
  async ({ query, limit = 50 }) => {
    const hits = filterRows({ query }).sort(byNewest).slice(0, limit);
    return { content: [{ type: "text", text: hits.length ? hits.map(fmt).join("\n") : "no matches" }] };
  }
);

mcp.tool(
  "recent_messages",
  { limit: z.number().optional(), app: z.string().optional() },
  async ({ limit = 50, app }) => {
    const out = filterRows({ app }).sort(byNewest).slice(0, limit);
    return { content: [{ type: "text", text: out.length ? out.map(fmt).join("\n") : "no data" }] };
  }
);

mcp.tool("list_apps", {}, async () => {
  const counts = {};
  for (const r of rows) counts[r.app] = (counts[r.app] || 0) + 1;
  const lines = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([a, c]) => `${a}: ${c}`);
  return { content: [{ type: "text", text: lines.join("\n") || "no data" }] };
});

mcp.tool("stats", {}, async () => {
  const bySource = {};
  let min = Infinity, max = -Infinity;
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
    if (r.time < min) min = r.time;
    if (r.time > max) max = r.time;
  }
  const text = [
    `total rows: ${rows.length}`,
    `by source: ${JSON.stringify(bySource)}`,
    rows.length ? `range: ${new Date(min).toLocaleString()} -> ${new Date(max).toLocaleString()}` : "range: -",
    `dashboard: http://localhost:${PORT}/`,
    `data file: ${DATA_FILE}`,
  ].join("\n");
  return { content: [{ type: "text", text }] };
});

await mcp.connect(new StdioServerTransport());
console.error("[notikeeper-mcp] MCP server ready (stdio)");
