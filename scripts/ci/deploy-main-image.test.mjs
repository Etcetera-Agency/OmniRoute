import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEPLOY_SSH_SCRIPT,
  deployMainImage,
  parseDeployStatus,
  validateDeployRequest,
} from "./deploy-main-image.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const sha = "1234567890abcdef1234567890abcdef12345678";
const runId = "12345678901234567890";
const runAttempt = "10";
const transactionId = `${runId}-${runAttempt}`;

function validRequest(overrides = {}) {
  return {
    imageDigest: digest,
    sourceSha: sha,
    githubSha: sha,
    runId,
    runAttempt,
    ...overrides,
  };
}

function validEnvironment(runnerTemp, overrides = {}) {
  return {
    IMAGE_DIGEST: digest,
    SOURCE_SHA: sha,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: runAttempt,
    GITHUB_REPOSITORY: "Etcetera-Agency/OmniRoute",
    GITHUB_REF: "refs/heads/main",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_TOKEN: "test-github-token",
    RUNNER_TEMP: runnerTemp,
    OMNI_DEPLOY_SSH_PRIVATE_KEY: "PRIVATE KEY CONTENT FOR TEST ONLY",
    OMNI_DEPLOY_SSH_KNOWN_HOSTS: "130.162.40.87 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly",
    ...overrides,
  };
}

test("deployment request accepts only bounded digest, source SHA, run ID, and attempt", () => {
  assert.deepEqual(validateDeployRequest(validRequest()), {
    imageDigest: digest,
    sourceSha: sha,
    githubSha: sha,
    runId,
    runAttempt,
    transactionId,
    record: `${digest} ${sha} ${runId} ${runAttempt}`,
  });
  assert.notEqual(
    validateDeployRequest(validRequest({ runAttempt: "11" })).transactionId,
    transactionId,
    "a rerun attempt must get a distinct server transaction key"
  );

  for (const invalid of [
    validRequest({ imageDigest: "sha256:short" }),
    validRequest({ imageDigest: `sha256:${"A".repeat(64)}` }),
    validRequest({ sourceSha: "not-a-full-sha" }),
    validRequest({ githubSha: "g".repeat(40) }),
    validRequest({ runId: "0" }),
    validRequest({ runId: "1".repeat(21) }),
    validRequest({ runAttempt: "0" }),
    validRequest({ runAttempt: "1".repeat(11) }),
    validRequest({ imageDigest: `${digest};touch /tmp/pwned` }),
    validRequest({ sourceSha: `${sha}\nwhoami` }),
    validRequest({ runId: "1$(touch /tmp/pwned)" }),
    validRequest({ runAttempt: "1;id" }),
  ]) {
    assert.throws(() => validateDeployRequest(invalid));
  }
});

test("server status must be one bounded line for this run attempt", () => {
  assert.deepEqual(parseDeployStatus(`SUCCEEDED ${transactionId}\n`, transactionId), {
    status: "SUCCEEDED",
    transactionId,
  });
  assert.deepEqual(parseDeployStatus(`SKIPPED_STALE ${transactionId}\n`, transactionId), {
    status: "SKIPPED_STALE",
    transactionId,
  });
  assert.deepEqual(parseDeployStatus(`FAILED ${transactionId} HEALTH_TIMEOUT\n`, transactionId), {
    status: "FAILED",
    transactionId,
    code: "HEALTH_TIMEOUT",
  });

  for (const invalid of [
    `SUCCEEDED ${transactionId}\nextra\n`,
    `FAILED ${transactionId} "; touch /tmp/pwned\n`,
    `SUCCEEDED ${runId}-9\n`,
    "private server diagnostic\n",
  ]) {
    assert.throws(() => parseDeployStatus(invalid, transactionId));
  }
});

test("current-main mismatch exits before SSH or temporary private-key creation", async () => {
  const runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "omni-deploy-stale-test-"));
  try {
    let sshCalled = false;
    const result = await deployMainImage({
      env: validEnvironment(runnerTemp),
      getCurrentMainShaImpl: async () => "f".repeat(40),
      spawnSyncImpl: () => {
        sshCalled = true;
        throw new Error("SSH must not run for stale main");
      },
    });

    assert.deepEqual(result, { status: "SKIPPED_STALE", transactionId });
    assert.equal(sshCalled, false);
    assert.deepEqual(await fs.readdir(runnerTemp), []);
  } finally {
    await fs.rm(runnerTemp, { recursive: true, force: true });
  }
});

test("fresh-main SHA must match both the request source and workflow checkout SHA", async () => {
  const runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "omni-deploy-sha-mismatch-test-"));
  try {
    let sshCalled = false;
    const result = await deployMainImage({
      env: validEnvironment(runnerTemp, { GITHUB_SHA: "f".repeat(40) }),
      getCurrentMainShaImpl: async () => sha,
      spawnSyncImpl: () => {
        sshCalled = true;
        return { status: 0, stdout: `SUCCEEDED ${transactionId}\n`, stderr: "" };
      },
    });

    assert.deepEqual(result, { status: "SKIPPED_STALE", transactionId });
    assert.equal(sshCalled, false);
    assert.deepEqual(await fs.readdir(runnerTemp), []);
  } finally {
    await fs.rm(runnerTemp, { recursive: true, force: true });
  }
});

test("SSH uses fixed heredoc command and strict options; temp credentials are private and removed", async () => {
  const runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "omni-deploy-success-test-"));
  try {
    const result = await deployMainImage({
      env: validEnvironment(runnerTemp),
      getCurrentMainShaImpl: async ({ repository, token }) => {
        assert.equal(repository, "Etcetera-Agency/OmniRoute");
        assert.equal(token, "test-github-token");
        return sha;
      },
      spawnSyncImpl: (command, args, options) => {
        const shellEnvironment = options.env;
        assert.equal(command, "/bin/bash");
        assert.equal(options.cwd, shellEnvironment.HOME);
        assert.equal(
          shellEnvironment.OMNI_DEPLOY_REQUEST_RECORD,
          `${digest} ${sha} ${runId} ${runAttempt}`
        );
        assert.equal(shellEnvironment.GITHUB_TOKEN, undefined);
        assert.equal(
          fsSync.statSync(shellEnvironment.OMNI_DEPLOY_PRIVATE_KEY_PATH).mode & 0o777,
          0o600
        );
        assert.equal(
          fsSync.statSync(shellEnvironment.OMNI_DEPLOY_KNOWN_HOSTS_PATH).mode & 0o777,
          0o600
        );
        const shell = args.at(-1);
        assert.match(shell, /<<EOF/);
        assert.match(shell, /deploy-main <<EOF\n\$request_record\nEOF$/);
        assert.match(shell, /\n  -T \\/);
        assert.match(shell, /IdentitiesOnly=yes/);
        assert.match(shell, /StrictHostKeyChecking=yes/);
        assert.match(shell, /GlobalKnownHostsFile=\/dev\/null/);
        assert.match(shell, /ForwardAgent=no/);
        assert.match(shell, /ClearAllForwardings=yes/);
        assert.match(shell, /ServerAliveInterval=/);
        assert.doesNotMatch(shell, /ssh-keyscan|\$\{digest\}|\$\{sha\}/);
        assert.doesNotMatch(JSON.stringify(options.env), /test-github-token|PRIVATE KEY CONTENT/);
        assert.deepEqual(args.slice(0, -1), [
          "--noprofile",
          "--norc",
          "-e",
          "-u",
          "-o",
          "pipefail",
          "-c",
        ]);
        return { status: 0, stdout: `SUCCEEDED ${transactionId}\n`, stderr: "" };
      },
    });

    assert.deepEqual(result, { status: "SUCCEEDED", transactionId });
    assert.match(DEPLOY_SSH_SCRIPT, /<<EOF/);
    assert.match(DEPLOY_SSH_SCRIPT, /omniroute-deploy@130\.162\.40\.87 deploy-main/);
    assert.deepEqual(await fs.readdir(runnerTemp), []);
  } finally {
    await fs.rm(runnerTemp, { recursive: true, force: true });
  }
});

test("SSH failure hides raw stderr and reports a bounded transport failure", async () => {
  const runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "omni-deploy-failure-test-"));
  try {
    const result = await deployMainImage({
      env: validEnvironment(runnerTemp),
      getCurrentMainShaImpl: async () => sha,
      spawnSyncImpl: () => ({
        status: 255,
        stdout: "",
        stderr: "PRIVATE KEY CONTENT FOR TEST ONLY and raw host diagnostics",
      }),
    });

    assert.deepEqual(result, {
      status: "FAILED",
      transactionId,
      code: "SSH_TRANSPORT",
    });
    assert.equal(JSON.stringify(result).includes("PRIVATE KEY CONTENT"), false);
    assert.equal(JSON.stringify(result).includes("raw host diagnostics"), false);
    assert.deepEqual(await fs.readdir(runnerTemp), []);
  } finally {
    await fs.rm(runnerTemp, { recursive: true, force: true });
  }
});

test("invalid request never calls current-main API, creates key files, or invokes SSH", async () => {
  const runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "omni-deploy-invalid-test-"));
  try {
    let apiCalled = false;
    let sshCalled = false;
    await assert.rejects(
      deployMainImage({
        env: validEnvironment(runnerTemp, { IMAGE_DIGEST: `${digest};id` }),
        getCurrentMainShaImpl: async () => {
          apiCalled = true;
          return sha;
        },
        spawnSyncImpl: () => {
          sshCalled = true;
          return { status: 0, stdout: `SUCCEEDED ${transactionId}\n`, stderr: "" };
        },
      })
    );
    assert.equal(apiCalled, false);
    assert.equal(sshCalled, false);
    assert.deepEqual(await fs.readdir(runnerTemp), []);
  } finally {
    await fs.rm(runnerTemp, { recursive: true, force: true });
  }
});

test("host-key input rejects duplicate pins, multiline values, and trailing text", async () => {
  const runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "omni-deploy-hostkey-test-"));
  try {
    const pin = "130.162.40.87 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly";
    const otherPin = "130.162.40.87 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISecond";
    const invalidPins = [
      `${pin}\n${otherPin}`,
      `${pin}\nother.example ssh-ed25519 AAAATEST`,
      `${pin}\r\n`,
      `${pin} trailing-input`,
      `${pin}\ntrailing-input`,
      "other.example ssh-ed25519 AAAATEST",
    ];

    for (const knownHosts of invalidPins) {
      let apiCalled = false;
      let sshCalled = false;
      await assert.rejects(
        deployMainImage({
          env: validEnvironment(runnerTemp, { OMNI_DEPLOY_SSH_KNOWN_HOSTS: knownHosts }),
          getCurrentMainShaImpl: async () => {
            apiCalled = true;
            return sha;
          },
          spawnSyncImpl: () => {
            sshCalled = true;
            return { status: 0, stdout: `SUCCEEDED ${transactionId}\n`, stderr: "" };
          },
        })
      );
      assert.equal(apiCalled, false);
      assert.equal(sshCalled, false);
      assert.deepEqual(await fs.readdir(runnerTemp), []);
    }

    const result = await deployMainImage({
      env: validEnvironment(runnerTemp, { OMNI_DEPLOY_SSH_KNOWN_HOSTS: `${pin}\n` }),
      getCurrentMainShaImpl: async () => sha,
      spawnSyncImpl: () => ({ status: 0, stdout: `SUCCEEDED ${transactionId}\n`, stderr: "" }),
    });
    assert.deepEqual(result, { status: "SUCCEEDED", transactionId });
    assert.deepEqual(await fs.readdir(runnerTemp), []);
  } finally {
    await fs.rm(runnerTemp, { recursive: true, force: true });
  }
});
