#!/usr/bin/env node
/**
 * Prove clean-install and upgrade-over-previous boot paths before npm publish.
 *
 * AICODE-NOTE: schema convergence is intentionally asymmetric. Tables present only on a clean
 * install are a release-blocking migration gap; upgrade-only residue is allowlisted and reported.
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const BOOT_DEADLINE_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;
const ALLOWLIST_PATH = "config/quality/install-upgrade-allowlist.json";

function log(msg) {
  console.log(`[install-upgrade] ${msg}`);
}

function warn(msg) {
  console.log(`[install-upgrade] ⚠️  ${msg}`);
}

function pickTarball(packJson) {
  const filename = JSON.parse(packJson)?.[0]?.filename;
  if (!filename) throw new Error("npm pack --json returned no filename");
  return filename;
}

function pickPort(offset) {
  return 21000 + offset + (process.pid % 500);
}

function loadAllowlist(root) {
  const file = path.join(root, ALLOWLIST_PATH);
  if (!fs.existsSync(file)) return { residualTables: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Pure, testable schema convergence verdict. */
export function evaluateConvergence({ freshTables, upgradedTables, residualAllowlist = {} }) {
  const fresh = freshTables instanceof Set ? freshTables : new Set(freshTables ?? []);
  const upgraded = upgradedTables instanceof Set ? upgradedTables : new Set(upgradedTables ?? []);
  const onlyFresh = [...fresh].filter((table) => !upgraded.has(table)).sort();
  const onlyUpgraded = [...upgraded].filter((table) => !fresh.has(table)).sort();
  const unknownResidue = onlyUpgraded.filter(
    (table) => !Object.prototype.hasOwnProperty.call(residualAllowlist, table)
  );
  const failures = [];
  if (onlyFresh.length) {
    failures.push(
      `schema divergence — tables a CLEAN install creates but an UPGRADE does not: ` +
        `${onlyFresh.join(", ")}. ` +
        "Every existing user would be missing these; add the migration."
    );
  }
  if (unknownResidue.length) {
    failures.push(
      `NEW residual table(s) not in ${ALLOWLIST_PATH}: ${unknownResidue.join(", ")}. ` +
        "Either drop them in a migration or record them with a justification."
    );
  }
  return { ok: failures.length === 0, failures, onlyFresh, onlyUpgraded, unknownResidue };
}

/** A previous release must boot before its data can be used for an upgrade proof. */
export function evaluatePreviousBoot({ previous, result }) {
  if (result?.ok) return { ok: true, failures: [] };
  return {
    ok: false,
    failures: [
      `previous version ${previous} did not boot cleanly — upgrade path unverified`,
      ...(result?.failures ?? []),
    ],
  };
}

function readTables(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    return new Set(rows.map((row) => row.name));
  } finally {
    db.close();
  }
}

function findDb(dataDir) {
  const candidates = ["storage.sqlite", "omniroute.sqlite", "data.sqlite"];
  for (const name of candidates) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) return file;
  }
  const found = fs.readdirSync(dataDir).find((file) => file.endsWith(".sqlite"));
  return found ? path.join(dataDir, found) : null;
}

async function bootAndProbe({ prefix, dataDir, port, expectVersion, label }) {
  const binPath = path.join(prefix, "bin", "omniroute");
  if (!fs.existsSync(binPath)) {
    return { ok: false, failures: [`${label}: bin not found at ${binPath}`], tail: [] };
  }
  const child = spawn(binPath, ["serve", "--port", String(port)], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      JWT_SECRET: "install-upgrade-gate-secret-with-sufficient-length",
      API_KEY_SECRET: "install-upgrade-gate-api-key-secret-long",
      DISABLE_SQLITE_AUTO_BACKUP: "true",
      OMNIROUTE_SKIP_SYSTEM_TRUST: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const tail = [];
  function keepTail(chunk) {
    tail.push(String(chunk));
    while (tail.length > 80) tail.shift();
  }
  child.stdout.on("data", keepTail);
  child.stderr.on("data", keepTail);
  let childExit = null;
  child.on("exit", (code) => {
    childExit = code ?? -1;
  });

  const deadline = Date.now() + BOOT_DEADLINE_MS;
  let result = { ok: false, failures: [`${label}: never became healthy`], tail };
  while (Date.now() < deadline) {
    if (childExit !== null) {
      result = {
        ok: false,
        failures: [`${label}: exited with code ${childExit} before serving`],
        tail,
      };
      break;
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/monitoring/health`);
      const body = await response.json().catch(() => null);
      if (response.status === 200 && body && typeof body === "object") {
        const failures = [];
        if (expectVersion && body.version !== expectVersion) {
          failures.push(
            `${label}: health reports version ${body.version}, expected ${expectVersion}`
          );
        }
        result = { ok: failures.length === 0, version: body.version, failures, tail };
        break;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  try {
    if (childExit === null) process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  return result;
}

function npmInstallInto(prefix, spec) {
  execFileSync("npm", ["install", "-g", "--prefix", prefix, "--no-audit", "--no-fund", spec], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

function resolvePreviousVersion(current, explicit) {
  if (explicit) return explicit;
  const latest = execFileSync("npm", ["view", "omniroute", "dist-tags.latest"], {
    encoding: "utf8",
  }).trim();
  if (!latest) throw new Error("could not resolve omniroute@latest from npm");
  if (latest === current) {
    const all = JSON.parse(
      execFileSync("npm", ["view", "omniroute", "versions", "--json"], { encoding: "utf8" })
    );
    const stable = all.filter(
      (version) => !/-(rc|alpha|beta|pre|next)/.test(version) && version !== current
    );
    return stable[stable.length - 1];
  }
  return latest;
}

async function main() {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf("--from");
  const explicitFrom = fromIndex >= 0 ? args[fromIndex + 1] : null;
  const skipUpgrade = args.includes("--skip-upgrade");

  if (!fs.existsSync(path.join(root, "dist", "server.js"))) {
    console.error("[install-upgrade] dist/server.js missing — run `npm run build:cli` first");
    process.exit(2);
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const allowlist = loadAllowlist(root);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-install-upgrade-"));
  const failures = [];
  const warnings = [];

  try {
    log(`packing v${version}…`);
    const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    const tarball = path.join(tmp, pickTarball(packOutput));

    log("PHASE A — clean install of the packed tarball");
    const cleanPrefix = path.join(tmp, "clean-prefix");
    const cleanData = path.join(tmp, "clean-data");
    fs.mkdirSync(cleanData, { recursive: true });
    npmInstallInto(cleanPrefix, tarball);
    const clean = await bootAndProbe({
      prefix: cleanPrefix,
      dataDir: cleanData,
      port: pickPort(0),
      expectVersion: version,
      label: "clean",
    });
    failures.push(...clean.failures);
    if (clean.ok) log(`clean install healthy on v${clean.version}`);
    const cleanDb = findDb(cleanData);
    const freshTables = cleanDb ? readTables(cleanDb) : null;
    if (!freshTables) failures.push("clean: no SQLite database was created");
    else log(`clean install schema: ${freshTables.size} tables`);

    let upgradedTables = null;
    if (skipUpgrade) {
      warn("PHASE B skipped (--skip-upgrade)");
    } else {
      const previous = resolvePreviousVersion(version, explicitFrom);
      log(`PHASE B — upgrade path: omniroute@${previous} → v${version}`);
      const upgradePrefix = path.join(tmp, "upgrade-prefix");
      const upgradeData = path.join(tmp, "upgrade-data");
      fs.mkdirSync(upgradeData, { recursive: true });
      npmInstallInto(upgradePrefix, `omniroute@${previous}`);
      const before = await bootAndProbe({
        prefix: upgradePrefix,
        dataDir: upgradeData,
        port: pickPort(1),
        expectVersion: previous,
        label: `previous(${previous})`,
      });
      const previousVerdict = evaluatePreviousBoot({ previous, result: before });
      if (!previousVerdict.ok) {
        failures.push(...previousVerdict.failures);
        for (const failure of previousVerdict.failures) warn(failure);
      } else {
        const beforeDb = findDb(upgradeData);
        const beforeTables = beforeDb ? readTables(beforeDb) : new Set();
        log(`previous(${previous}) schema: ${beforeTables.size} tables — upgrading in place`);
        npmInstallInto(upgradePrefix, tarball);
        const after = await bootAndProbe({
          prefix: upgradePrefix,
          dataDir: upgradeData,
          port: pickPort(2),
          expectVersion: version,
          label: "upgraded",
        });
        failures.push(...after.failures);
        if (after.ok) log(`upgrade healthy on v${after.version}`);
        const afterDb = findDb(upgradeData);
        upgradedTables = afterDb ? readTables(afterDb) : null;
        if (!upgradedTables) {
          failures.push("upgraded: database disappeared after the upgrade");
        } else {
          log(`upgraded schema: ${upgradedTables.size} tables`);
          const dropped = [...beforeTables].filter((table) => !upgradedTables.has(table));
          if (dropped.length) {
            failures.push(`upgrade DROPPED tables that existed before: ${dropped.join(", ")}`);
          }
        }
      }
    }

    if (freshTables && upgradedTables) {
      const verdict = evaluateConvergence({
        freshTables,
        upgradedTables,
        residualAllowlist: allowlist.residualTables ?? {},
      });
      if (verdict.onlyUpgraded.length) {
        warn(`residual tables present only after upgrade: ${verdict.onlyUpgraded.join(", ")}`);
      }
      failures.push(...verdict.failures);
      if (verdict.ok) log("schema convergence OK (no new divergence)");
    }

    if (warnings.length) for (const warning of warnings) warn(warning);
    if (failures.length) {
      console.error(`[install-upgrade] FAIL — ${failures.length} problem(s):`);
      for (const failure of failures) console.error(`  ✗ ${failure}`);
      process.exit(1);
    }
    log("PASS — clean install and upgrade path both boot; schema converges.");
    process.exit(0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error) => {
    console.error(`[install-upgrade] crashed: ${error?.message ?? error}`);
    process.exit(1);
  });
}
