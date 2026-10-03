## Purpose

Define how the fork adds backend API routes to the verified official OmniRoute
image while retaining its compiled dashboard and runtime output.

## Requirements

### Requirement: Official dashboard preservation

The image build SHALL retain the official dashboard routes, page bundles,
static assets, and build ID WHEN the fork image is built on the verified
official OmniRoute image.

#### Scenario: Dashboard remains served by official output

GIVEN the official image contains its complete dashboard output
WHEN the backend overlay image is assembled
THEN dashboard route entries continue to point into the official dist tree
AND the official static assets and build ID remain unchanged
AND backend-only stub pages are not selected for UI requests

### Requirement: Isolated backend route loading

The runtime SHALL load an API route's compiled module and relative server
chunks from the isolated backend server subtree WHEN that fork API route is
selected.

#### Scenario: Existing API route uses fork backend

GIVEN an API route key exists in both the official and backend app-path
manifests
WHEN Next.js resolves the route through the merged official app-path manifest
THEN the route resolves to its absolute bundle path in the backend overlay
AND every relative chunk import resolves within that overlay subtree

#### Scenario: Fork adds SystemOne route

GIVEN the backend build contains `/api/v1/systemone/route`
AND the official route manifest contains `/v1/:path*` to `/api/v1/:path*`
WHEN a caller requests `/v1/systemone`
THEN Next.js rewrites the request to `/api/v1/systemone`
AND loads the SystemOne handler from the backend overlay

#### Scenario: Missing backend route blocks image assembly

GIVEN an API route key exists in the official manifest but is absent from the
backend manifest or its bundle file is missing
WHEN the manifest merge runs
THEN the merge fails with the missing route identified
AND no image is produced with a partial backend route set

### Requirement: API runtime configuration merge

The image build SHALL merge backend API function settings and route rewrites
while preserving official UI and non-API configuration.

#### Scenario: API function configuration is updated

GIVEN the official and overlay functions-config manifests contain API routes
AND the official manifest contains UI or non-API entries
WHEN the overlay manifests are merged
THEN overlay API settings take precedence for matching API route keys
AND additional overlay API settings are added
AND official UI and non-API entries remain unchanged

#### Scenario: Rewrite rules are merged once

GIVEN official and overlay route manifests contain the same `/v1/:path*`
rewrite
WHEN the overlay route manifest is merged
THEN the rule appears once
AND unique official and overlay rewrite rules remain available

### Requirement: Overlay manifest integrity

The build SHALL reject malformed route mappings and paths outside the
isolated backend server tree when merging the backend overlay manifest.

#### Scenario: Overlay route path escapes its tree

GIVEN an API manifest value is absolute or traverses outside `server/app/api`
WHEN the merge validates the route bundle
THEN the merge fails with the route key identified
AND the official manifest is not rewritten with that path
