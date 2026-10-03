import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const compose = yaml.load(fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8"));
const releaseGuide = fs.readFileSync(
  path.join(root, "docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md"),
  "utf8"
);

test("fork release Compose targets the main GHCR image with an operator-overridable digest", () => {
  const service = compose.services["omniroute-base"];
  const image = service?.image ?? "";
  assert.match(image, /ghcr\.io\/etcetera-agency\/omniroute/);
  assert.match(image, /:main/);
  assert.match(image, /OMNIROUTE_IMAGE/);
  assert.equal(
    service.build,
    undefined,
    "the server Compose service must not build source locally"
  );
});

test("fork release guide verifies digest and starts without source builds", () => {
  assert.ok(
    /ghcr\.io\/etcetera-agency\/omniroute:main/.test(releaseGuide),
    "guide must name the production image"
  );
  assert.ok(/sha256:/.test(releaseGuide), "guide must verify a manifest digest");
  assert.ok(
    /docker compose --profile base pull/.test(releaseGuide),
    "guide must pull from the registry"
  );
  assert.ok(
    /docker compose --profile base up -d --no-build/.test(releaseGuide),
    "guide must start without source builds"
  );
  assert.ok(
    /rollback[\s\S]{0,500}(?:previous|prior)[\s\S]{0,500}digest/i.test(releaseGuide),
    "guide must retain a prior digest for rollback"
  );
  assert.match(releaseGuide, /Routine tests and static checks run only when/);
  assert.match(releaseGuide, /The image workflow is the only automatic\s+workflow/);
  assert.match(releaseGuide, /manual-dispatch-only/);
  assert.match(releaseGuide, /do not run unit or static test gates/);
});
