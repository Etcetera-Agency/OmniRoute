#!/usr/bin/env node
// Merge per-architecture latest-mac.yml manifests into one deterministic updater manifest.
// AICODE-NOTE: unsuffixed Intel entry must remain first; electron-updater falls back to files[0].

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseManifest(text) {
  const source = String(text ?? "");
  const result = { version: "", files: [], path: "", sha512: "", releaseDate: "" };
  const top = /^(version|path|sha512|releaseDate):\s*'?([^'\n]*)'?\s*$/gm;
  for (const match of source.matchAll(top)) result[match[1]] = match[2].trim();
  const blocks = source.split(/^\s*-\s+url:\s*/m).slice(1);
  for (const block of blocks) {
    const url = block.split("\n")[0].trim();
    if (!url) continue;
    function grab(key) {
      const match = new RegExp(`^\\s+${key}:\\s*(.+)$`, "m").exec(block);
      return match ? match[1].trim() : "";
    }
    const entry = { url, sha512: grab("sha512"), size: grab("size") };
    const blockMapSize = grab("blockMapSize");
    if (blockMapSize) entry.blockMapSize = blockMapSize;
    result.files.push(entry);
  }
  return result;
}

export function hasArchSuffix(url) {
  return /-(arm64|x64|universal)\./.test(String(url ?? ""));
}

export function mergeManifests(manifests) {
  const usable = (manifests ?? []).filter(
    (manifest) => manifest && Array.isArray(manifest.files) && manifest.files.length > 0
  );
  if (!usable.length) return null;
  const seen = new Set();
  const files = [];
  for (const manifest of usable) {
    for (const file of manifest.files) {
      if (!file.url || seen.has(file.url)) continue;
      seen.add(file.url);
      files.push(file);
    }
  }
  if (!files.length) return null;
  files.sort((a, b) => Number(hasArchSuffix(a.url)) - Number(hasArchSuffix(b.url)));
  const primary = files[0];
  const versions = [...new Set(usable.map((manifest) => manifest.version).filter(Boolean))];
  return {
    version: versions[0] ?? "",
    versionConflict: versions.length > 1 ? versions : null,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate:
      usable
        .map((manifest) => manifest.releaseDate)
        .filter(Boolean)
        .sort()
        .pop() ?? "",
  };
}

export function renderManifest(merged) {
  const lines = [`version: ${merged.version}`, "files:"];
  for (const file of merged.files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    lines.push(`    size: ${file.size}`);
    if (file.blockMapSize) lines.push(`    blockMapSize: ${file.blockMapSize}`);
  }
  lines.push(`path: ${merged.path}`);
  lines.push(`sha512: ${merged.sha512}`);
  lines.push(`releaseDate: '${merged.releaseDate}'`);
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const [inputDir, outputDir] = argv;
  if (!inputDir || !outputDir) {
    process.stderr.write("usage: merge-mac-update-manifest.mjs <in-dir> <out-dir>\n");
    return 1;
  }
  if (!fs.existsSync(inputDir)) return 0;
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === "latest-mac.yml") found.push(file);
    }
  }
  walk(inputDir);
  if (!found.length) return 0;
  const merged = mergeManifests(found.map((file) => parseManifest(fs.readFileSync(file, "utf8"))));
  if (!merged) {
    process.stderr.write("found manifests but none listed files; refusing empty output\n");
    return 1;
  }
  if (merged.versionConflict) {
    process.stderr.write(`manifest versions disagree: ${merged.versionConflict.join(", ")}\n`);
    return 1;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "latest-mac.yml"), renderManifest(merged));
  return 0;
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main(process.argv.slice(2)));
}
