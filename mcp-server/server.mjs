#!/usr/bin/env node
/**
 * NotiKeeper MCP server.
 *
 * Two jobs in one process:
 *  1) HTTP POST /ingest  — receives uploads from the NotiKeeper app
 *     (point the app's "Upload API" endpoint here). Stores rows in a local
 *     JSONL file (deduplicated).
 *  2) MCP (stdio)        — exposes tools so Claude can search the archive.
 *
 * All logs go to STDERR; STDOUT is reserved for the MCP protocol.
 *
 * Env:
 *   NOTIKEEPER_PORT   ingest port (default 8765)
 *   NOTIKEEPER_TOKEN  optional bearer token the app must send
 *   NOTIKEEPER_DATA   path to the JSONL store (default ./data.jsonl)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.NOTIKEEPER_DATA || path.join(__dirname, "data.jsonl");
const PORT = parseInt(process.env.NOTIKEEPER_PORT || "8765", 10);
const TOKEN = process.env.NOTIKEEPER_TOKEN || "";

const rows = [];
const seen = new Set();
const keyOf = (r) => `${r.id}-${r.time}`;

function load() {
  if (!fs.existsSync(DATA_FILE)) return;
  for (const line of fs.readFileSync(DATA_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      const k = keyOf(r);
      if (!seen.has(k)) { seen.add(k); rows.push(r); }
    } catch { /* skip bad line */ }
  }
}

function ingest(arr) {
  const fresh = [];
  for (const r of arr) {
    if (r == null || r.id == null) continue;
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k); rows.push(r); fresh.push(JSON.stringify(r));
  }
  if (fresh.length) fs.appendFileSync(DATA_FILE, fresh.join("\n") + "\n");
  return fresh.length;
}

load();
console.error(`[notikeeper-mcp] loaded ${rows.length} rows from ${DATA_FILE}`);

// --- 1) HTTP ingest endpoint (the app uploads here) ---
http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/ingest") {
      if (TOKEN && req.headers["authorization"] !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return;
      }
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 50_000_000) req.destroy();
      });
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
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(PORT, () => console.error(`[notikeeper-mcp] ingest listening on http://0.0.0.0:${PORT}/ingest`));

// --- helpers ---
const fmt = (r) =>
  `[${new Date(r.time).toLocaleString()}] ${r.app}` +
  `${r.title ? " · " + r.title : ""}` +
  `${r.side ? " (" + r.side + ")" : ""}: ${r.text}`;
const byNewest = (a, b) => b.time - a.time;

// --- 2) MCP tools ---
const server = new McpServer({ name: "notikeeper", version: "1.0.0" });

server.tool(
  "search_messages",
  { query: z.string().describe("text to find in app name, sender, or message body"), limit: z.number().optional() },
  async ({ query, limit = 50 }) => {
    const q = query.toLowerCase();
    const hits = rows
      .filter(
        (r) =>
          (r.text || "").toLowerCase().includes(q) ||
          (r.title || "").toLowerCase().includes(q) ||
          (r.app || "").toLowerCase().includes(q)
      )
      .sort(byNewest)
      .slice(0, limit);
    return { content: [{ type: "text", text: hits.length ? hits.map(fmt).join("\n") : "no matches" }] };
  }
);

server.tool(
  "recent_messages",
  { limit: z.number().optional(), app: z.string().optional().describe("filter by app name substring") },
  async ({ limit = 50, app }) => {
    let r = rows;
    if (app) {
      const a = app.toLowerCase();
      r = r.filter((x) => (x.app || "").toLowerCase().includes(a));
    }
    const out = [...r].sort(byNewest).slice(0, limit);
    return { content: [{ type: "text", text: out.length ? out.map(fmt).join("\n") : "no data" }] };
  }
);

server.tool("list_apps", {}, async () => {
  const counts = {};
  for (const r of rows) counts[r.app] = (counts[r.app] || 0) + 1;
  const lines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([a, c]) => `${a}: ${c}`);
  return { content: [{ type: "text", text: lines.join("\n") || "no data" }] };
});

server.tool("stats", {}, async () => {
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
    `data file: ${DATA_FILE}`,
    `ingest port: ${PORT}`,
  ].join("\n");
  return { content: [{ type: "text", text }] };
});

await server.connect(new StdioServerTransport());
console.error("[notikeeper-mcp] MCP server ready (stdio)");
