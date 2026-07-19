export const PORT = parseInt(process.env.NOTIKEEPER_PORT || "8765", 10);
export const LOCALHOST = "localhost";
export const LOOPBACK_HOST = "127.0.0.1";
export const BIND_HOST = "0.0.0.0";
export const OLLAMA_URL = process.env.OLLAMA_URL || `http://${LOCALHOST}:11434`;
export const DEFAULT_INGEST_URL = `http://${LOCALHOST}:${PORT}/ingest`;
