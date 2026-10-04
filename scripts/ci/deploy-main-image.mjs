import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getCurrentMainSha } from "./check-main-image-current.mjs";

const EXPECTED_REPOSITORY = "Etcetera-Agency/OmniRoute";
const DEPLOY_TARGET = "omniroute-deploy@130.162.40.87";
const DEPLOY_COMMAND = "deploy-main";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PRIVATE_KEY_MAX_BYTES = 32 * 1024;
const KNOWN_HOSTS_MAX_BYTES = 16 * 1024;
const SSH_OUTPUT_MAX_BYTES = 1024;

const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const RUN_ATTEMPT_PATTERN = /^[1-9][0-9]{0,9}$/;
const SAFE_STATUS_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;
const PINNED_HOST_LINE_PATTERN = /^130\.162\.40\.87 ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/;

// AICODE-NOTE: Validate the full request before the current-main call or any temporary credential file. The server receives only the immutable digest and provenance tuple.
export function validateDeployRequest({ imageDigest, sourceSha, githubSha, runId, runAttempt }) {
  if (
    typeof imageDigest !== "string" ||
    !IMAGE_DIGEST_PATTERN.test(imageDigest) ||
    typeof sourceSha !== "string" ||
    !FULL_SHA_PATTERN.test(sourceSha) ||
    typeof githubSha !== "string" ||
    !FULL_SHA_PATTERN.test(githubSha) ||
    typeof runId !== "string" ||
    !RUN_ID_PATTERN.test(runId) ||
    typeof runAttempt !== "string" ||
    !RUN_ATTEMPT_PATTERN.test(runAttempt)
  ) {
    throw new Error("Invalid deployment request");
  }

  return {
    imageDigest,
    sourceSha,
    githubSha,
    runId,
    runAttempt,
    transactionId: `${runId}-${runAttempt}`,
    record: `${imageDigest} ${sourceSha} ${runId} ${runAttempt}`,
  };
}

export function parseDeployStatus(output, expectedTransactionId) {
  if (
    typeof output !== "string" ||
    output.length > SSH_OUTPUT_MAX_BYTES ||
    typeof expectedTransactionId !== "string" ||
    !/^([1-9][0-9]{0,19})-([1-9][0-9]{0,9})$/.test(expectedTransactionId)
  ) {
    throw new Error("Invalid deployment status");
  }

  const statusLine = output.endsWith("\n") ? output.slice(0, -1) : output;
  if (statusLine.includes("\n") || statusLine.includes("\r")) {
    throw new Error("Invalid deployment status");
  }

  if (statusLine === `SUCCEEDED ${expectedTransactionId}`) {
    return { status: "SUCCEEDED", transactionId: expectedTransactionId };
  }
  if (statusLine === `SKIPPED_STALE ${expectedTransactionId}`) {
    return { status: "SKIPPED_STALE", transactionId: expectedTransactionId };
  }

  const failedPrefix = `FAILED ${expectedTransactionId} `;
  if (statusLine.startsWith(failedPrefix)) {
    const code = statusLine.slice(failedPrefix.length);
    if (SAFE_STATUS_CODE_PATTERN.test(code)) {
      return { status: "FAILED", transactionId: expectedTransactionId, code };
    }
  }

  throw new Error("Invalid deployment status");
}

// AICODE-NOTE: Runtime paths and the validated wire record enter this fixed Bash program only through its environment. The unquoted heredoc expands one validated record; SSH command remains literal.
export const DEPLOY_SSH_SCRIPT = [
  "set -euo pipefail",
  "private_key_path=${OMNI_DEPLOY_PRIVATE_KEY_PATH:?}",
  "known_hosts_path=${OMNI_DEPLOY_KNOWN_HOSTS_PATH:?}",
  "request_record=${OMNI_DEPLOY_REQUEST_RECORD:?}",
  "unset OMNI_DEPLOY_PRIVATE_KEY_PATH OMNI_DEPLOY_KNOWN_HOSTS_PATH OMNI_DEPLOY_REQUEST_RECORD",
  "exec /usr/bin/ssh \\",
  "  -F /dev/null \\",
  "  -T \\",
  '  -i "$private_key_path" \\',
  "  -o BatchMode=yes \\",
  "  -o IdentitiesOnly=yes \\",
  "  -o StrictHostKeyChecking=yes \\",
  "  -o GlobalKnownHostsFile=/dev/null \\",
  "  -o ForwardAgent=no \\",
  "  -o ClearAllForwardings=yes \\",
  "  -o RequestTTY=no \\",
  "  -o PermitLocalCommand=no \\",
  "  -o ControlMaster=no \\",
  "  -o ControlPath=none \\",
  "  -o ProxyCommand=none \\",
  "  -o ProxyJump=none \\",
  "  -o ConnectTimeout=20 \\",
  "  -o ServerAliveInterval=30 \\",
  "  -o ServerAliveCountMax=10 \\",
  '  -o "UserKnownHostsFile=$known_hosts_path" \\',
  `  ${DEPLOY_TARGET} ${DEPLOY_COMMAND} <<EOF`,
  "$request_record",
  "EOF",
].join("\n");

function requireEnvironmentString(env, name, maximumBytes) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximumBytes) {
    throw new Error("Invalid deployment environment");
  }
  return value;
}

function requirePinnedKnownHosts(value) {
  const line = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (line.includes("\n") || line.includes("\r") || !PINNED_HOST_LINE_PATTERN.test(line)) {
    throw new Error("Invalid pinned production host key");
  }
  return `${line}\n`;
}

async function writePrivateFile(filePath, contents) {
  const handle = await fs.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

function sshEnvironment({ privateKeyPath, knownHostsPath, requestRecord, home }) {
  return {
    HOME: home,
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    OMNI_DEPLOY_PRIVATE_KEY_PATH: privateKeyPath,
    OMNI_DEPLOY_KNOWN_HOSTS_PATH: knownHostsPath,
    OMNI_DEPLOY_REQUEST_RECORD: requestRecord,
  };
}

function readServerResult(result, transactionId) {
  if (!result || result.error || result.signal || result.status === null) {
    return { status: "FAILED", transactionId, code: "SSH_TRANSPORT" };
  }

  let serverStatus;
  try {
    serverStatus = parseDeployStatus(result.stdout ?? "", transactionId);
  } catch {
    return { status: "FAILED", transactionId, code: "SSH_TRANSPORT" };
  }

  if (serverStatus.status === "FAILED") return serverStatus;
  if (result.status !== 0) {
    return { status: "FAILED", transactionId, code: "SSH_TRANSPORT" };
  }
  return serverStatus;
}

export async function deployMainImage({
  env = process.env,
  getCurrentMainShaImpl = getCurrentMainSha,
  spawnSyncImpl = spawnSync,
} = {}) {
  const request = validateDeployRequest({
    imageDigest: env.IMAGE_DIGEST,
    sourceSha: env.SOURCE_SHA,
    githubSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
  });

  if (env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Deployment is restricted to canonical main");
  }

  const token = requireEnvironmentString(env, "GITHUB_TOKEN", 16 * 1024);
  const privateKey = requireEnvironmentString(
    env,
    "OMNI_DEPLOY_SSH_PRIVATE_KEY",
    PRIVATE_KEY_MAX_BYTES
  );
  const knownHosts = requirePinnedKnownHosts(
    requireEnvironmentString(env, "OMNI_DEPLOY_SSH_KNOWN_HOSTS", KNOWN_HOSTS_MAX_BYTES)
  );
  const runnerTemp = requireEnvironmentString(env, "RUNNER_TEMP", 4096);
  if (!path.isAbsolute(runnerTemp)) throw new Error("Invalid runner temporary directory");

  const currentMainSha = await getCurrentMainShaImpl({
    apiUrl: env.GITHUB_API_URL,
    repository: env.GITHUB_REPOSITORY,
    token,
  });
  if (currentMainSha !== request.sourceSha || currentMainSha !== request.githubSha) {
    return { status: "SKIPPED_STALE", transactionId: request.transactionId };
  }

  let temporaryDirectory;
  try {
    temporaryDirectory = await fs.mkdtemp(path.join(runnerTemp, "omni-deploy-"));
    await fs.chmod(temporaryDirectory, 0o700);
    const privateKeyPath = path.join(temporaryDirectory, "deploy_key");
    const knownHostsPath = path.join(temporaryDirectory, "known_hosts");
    await writePrivateFile(privateKeyPath, privateKey);
    await writePrivateFile(knownHostsPath, knownHosts);

    try {
      const result = spawnSyncImpl(
        "/bin/bash",
        ["--noprofile", "--norc", "-e", "-u", "-o", "pipefail", "-c", DEPLOY_SSH_SCRIPT],
        {
          encoding: "utf8",
          cwd: temporaryDirectory,
          maxBuffer: SSH_OUTPUT_MAX_BYTES,
          env: sshEnvironment({
            privateKeyPath,
            knownHostsPath,
            requestRecord: request.record,
            home: temporaryDirectory,
          }),
        }
      );
      return readServerResult(result, request.transactionId);
    } catch {
      return { status: "FAILED", transactionId: request.transactionId, code: "SSH_TRANSPORT" };
    }
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function writeActionOutputs(outputPath, result) {
  if (!outputPath) return;
  const values = [`status=${result.status}`];
  if (result.transactionId) values.push(`transaction_id=${result.transactionId}`);
  if (result.code) values.push(`failure_code=${result.code}`);
  await fs.appendFile(outputPath, `${values.join("\n")}\n`, "utf8");
}

async function main() {
  let result;
  try {
    result = await deployMainImage({ env: process.env });
  } catch {
    result = { status: "FAILED", code: "DEPLOYMENT_SETUP" };
  }

  try {
    await writeActionOutputs(process.env.GITHUB_OUTPUT, result);
  } catch {
    process.stderr.write("Could not record the sanitized deployment status.\n");
    process.exitCode = 1;
    return;
  }

  const transaction = result.transactionId ? ` ${result.transactionId}` : "";
  const failure = result.code ? ` ${result.code}` : "";
  process.stdout.write(`Production deployment ${result.status}${transaction}${failure}.\n`);
  if (result.status === "FAILED") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main();
}
