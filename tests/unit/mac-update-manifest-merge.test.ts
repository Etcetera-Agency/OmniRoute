import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error — plain .mjs release script has no declaration file.
import {
  hasArchSuffix,
  mergeManifests,
  parseManifest,
  renderManifest,
} from "../../scripts/release/merge-mac-update-manifest.mjs";

const INTEL = `version: 3.8.49
files:
  - url: OmniRoute-3.8.49.dmg
    sha512: intel-hash
    size: 392717602
path: OmniRoute-3.8.49.dmg
sha512: intel-hash
releaseDate: '2026-07-30T01:07:13.268Z'
`;
const ARM = `version: 3.8.49
files:
  - url: OmniRoute-3.8.49-arm64.dmg
    sha512: arm-hash
    size: 390627465
path: OmniRoute-3.8.49-arm64.dmg
sha512: arm-hash
releaseDate: '2026-07-30T01:22:47.282Z'
`;

test("parses electron-builder manifest", () => {
  const manifest = parseManifest(INTEL);
  assert.equal(manifest.version, "3.8.49");
  assert.equal(manifest.files[0].url, "OmniRoute-3.8.49.dmg");
});

test("unsuffixed Intel entry is first regardless of arrival order", () => {
  const merged = mergeManifests([parseManifest(ARM), parseManifest(INTEL)]);
  assert.deepEqual(
    merged.files.map((file) => file.url),
    ["OmniRoute-3.8.49.dmg", "OmniRoute-3.8.49-arm64.dmg"]
  );
});

test("legacy fields follow first file and duplicates collapse", () => {
  const merged = mergeManifests([parseManifest(INTEL), parseManifest(INTEL)]);
  assert.equal(merged.files.length, 1);
  assert.equal(merged.path, merged.files[0].url);
  assert.equal(merged.sha512, merged.files[0].sha512);
});

test("mixed versions are surfaced as conflict", () => {
  const merged = mergeManifests([
    parseManifest(INTEL),
    parseManifest(ARM.replaceAll("3.8.49", "3.8.48")),
  ]);
  assert.deepEqual(merged.versionConflict.sort(), ["3.8.48", "3.8.49"]);
});

test("empty inputs return null and rendered output round-trips", () => {
  assert.equal(mergeManifests([]), null);
  const merged = mergeManifests([parseManifest(ARM), parseManifest(INTEL)]);
  const reparsed = parseManifest(renderManifest(merged));
  assert.equal(reparsed.files[0].url, "OmniRoute-3.8.49.dmg");
});

test("architecture suffix detection is segment-aware", () => {
  assert.equal(hasArchSuffix("OmniRoute-3.8.49-arm64.dmg"), true);
  assert.equal(hasArchSuffix("OmniRoute-3.8.49.dmg"), false);
  assert.equal(hasArchSuffix("OmniRoute-arm64beta-3.8.49.dmg"), false);
});
