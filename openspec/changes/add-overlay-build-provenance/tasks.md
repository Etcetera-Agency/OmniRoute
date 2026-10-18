# Implementation Tasks

1. [x] Define the selected full-source identity and stamped-prebuilt contract
       in proposal, design, and spec delta.
2. [x] Add focused CLI regression tests first for empty, short, malformed,
       full-length, no-write, and selected-server stamp cases.
3. [x] Extend the existing BUILD_SHA writer with validate-only and
       verify-selected-server modes; preserve its current regular build writer.
4. [x] Pass the full source SHA through the workflow and both Docker stages;
       stamp builder output and fail closed for unstamped or mismatched prebuilt
       exports before final image creation.
5. [x] Verify the final image's overlay stamp with a bounded, read-only,
       network-isolated one-shot container before candidate startup.
6. [x] Update focused writer and verifier tests for exact equality and
       fail-closed behavior.
7. [x] Run the independent source review and record any correction in
       `completion.review`.
8. [ ] After root coordinates the local official builder, record the measured
       Linux ARM64 source SHA, server BUILD_SHA, route hash, OCI revision, and
       image digest. Do not claim an artifact tuple before those values are read
       from the actual image.
9. [ ] Keep A5 public-response acceptance pending until the reviewed image is
       available; record a sanitized response without request secrets or body.
