import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = parseInt(process.env.NOTIKEEPER_PORT || "8765", 10);
export const LOCALHOST = "localhost";
export const LOOPBACK_HOST = "127.0.0.1";
// Loopback by default. This process serves the whole message archive over HTTP
// and the read APIs are only gated when NOTIKEEPER_TOKEN is set, so binding to
// every interface exposes private conversations to the LAN. Widening the bind
// (NOTIKEEPER_BIND=0.0.0.0) is what the phone needs to upload over Wi-Fi — it is
// an explicit opt-in, not the default.
export const BIND_HOST = process.env.NOTIKEEPER_BIND || LOOPBACK_HOST;
export const IS_LOOPBACK_ONLY =
  BIND_HOST === LOOPBACK_HOST || BIND_HOST === "localhost" || BIND_HOST === "::1";
export const OLLAMA_URL = process.env.OLLAMA_URL || `http://${LOCALHOST}:11434`;
export const DEFAULT_INGEST_URL = `http://${LOCALHOST}:${PORT}/ingest`;

// The shared local API token, generated on first launch by load-token.cmd (or the
// control panel) and kept in a gitignored file. The server reads it from the
// environment; the scrapers run standalone from a shell that has no such
// environment, so they fall back to the file instead of silently posting
// unauthenticated and getting a 401.
export const TOKEN_FILE = path.join(__dirname, ".notikeeper-token");

export function readLocalToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

/** Token the ingest clients (scrapers, importers) should present. */
export const INGEST_TOKEN =
  process.env.INGEST_TOKEN || process.env.NOTIKEEPER_TOKEN || readLocalToken();
