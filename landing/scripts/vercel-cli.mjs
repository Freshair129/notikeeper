import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

async function canAccess(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveVercelCli() {
  const candidates = [];

  if (process.env.VERCEL_CLI_JS) {
    candidates.push(process.env.VERCEL_CLI_JS);
  }

  candidates.push(
    path.join(path.dirname(process.execPath), "node_modules", "vercel", "dist", "vc.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "vercel", "dist", "vc.js")
  );

  for (const candidate of candidates) {
    if (await canAccess(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Unable to locate "vercel/dist/vc.js". Set VERCEL_CLI_JS or install the Vercel CLI in the current Node toolchain.'
  );
}

function createSanitizedEnv(input) {
  const output = {};

  for (const [key, value] of Object.entries(input)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "path" || lowerKey === "comspec") {
      continue;
    }
    output[key] = value;
  }

  const pathValue = input.PATH || input.Path || "";
  const systemRoot = input.SystemRoot || input.WINDIR || "C:\\Windows";

  output.PATH = pathValue;
  output.ComSpec = input.ComSpec || input.comspec || path.join(systemRoot, "System32", "cmd.exe");
  output.SystemRoot = systemRoot;
  output.WINDIR = input.WINDIR || systemRoot;

  return output;
}

const cliPath = await resolveVercelCli();
const args = process.argv.slice(2);
const env = createSanitizedEnv(process.env);

const child = spawn(process.execPath, [cliPath, ...args], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});
