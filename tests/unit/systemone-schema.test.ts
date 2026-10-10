import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SYSTEMONE_BODY_BYTES,
  parseSystemOneModelSelection,
  parseSystemOneRequest,
  readSystemOneJsonBody,
} from "../../open-sse/services/systemOne/schema.ts";

function validBody() {
  return {
    state: "A billing issue needs help",
    questions: {
      team: {
        type: "choice",
        instructions: "Choose team",
        criteria: { billing: "Payments", technical: "Bugs" },
      },
      confidence: { type: "score", instructions: "Score confidence", criteria: null },
      urgent: { type: "noul", instructions: "Is urgent" },
    },
  };
}

test("SystemOne schema accepts choice, score, noul, and opaque criteria", () => {
  const parsed = parseSystemOneRequest(validBody());

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.questions.confidence.criteria, null);
  }
});

test("state supports string, object, and array without rewriting question instructions", () => {
  for (const state of ["page text", { title: "page title" }, ["page text"]]) {
    const body = validBody();
    body.state = state;
    body.questions.team.instructions = " Choose one ";
    const parsed = parseSystemOneRequest(body);

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.state, state);
      assert.equal(parsed.data.questions.team.instructions, " Choose one ");
    }
  }
});

test("browser instructions object is valid only for pinned Laya Browser v19s", () => {
  const instructions = {
    goal: "Find the account settings page",
    operation: "CLICK",
    rules: "Choose Books",
  };
  const body = {
    ...validBody(),
    model: "laya/laya-browser-v19s",
    questions: {
      click_target: { type: "choice", instructions, criteria: { CLICK: "Click" } },
    },
  };
  const parsed = parseSystemOneRequest(body);

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.questions.click_target.instructions, instructions);
  }

  const listRules = {
    goal: "Enter the search term",
    operation: "TYPE_TEXT",
    rules: ["Use the visible search field", "Keep exact spelling"],
  };
  const parsedList = parseSystemOneRequest({
    ...validBody(),
    model: "laya/laya-browser-v19s",
    questions: { type_text_target: { type: "choice", instructions: listRules, criteria: {} } },
  });
  assert.equal(parsedList.success, true);
  if (parsedList.success) {
    assert.deepEqual(parsedList.data.questions.type_text_target.instructions, listRules);
  }

  const selectInstructions = {
    goal: "Choose a shipping method",
    operation: "SELECT",
    rules: [],
  };
  const parsedSelect = parseSystemOneRequest({
    ...validBody(),
    model: "laya/laya-browser-v19s",
    questions: {
      select_target: { type: "choice", instructions: selectInstructions, criteria: {} },
    },
  });
  assert.equal(parsedSelect.success, true);
  if (parsedSelect.success) {
    assert.deepEqual(parsedSelect.data.questions.select_target.instructions, selectInstructions);
  }

  const nonTarget = { goal: "Choose whether page is ready", rules: "Choose Books" };
  const parsedNonTarget = parseSystemOneRequest({
    ...validBody(),
    model: "laya/laya-browser-v19s",
    questions: { operation: { type: "choice", instructions: nonTarget, criteria: {} } },
  });
  assert.equal(parsedNonTarget.success, true, "non-target instruction may omit operation");

  for (const model of [undefined, "auto", "laya/multilingual", "typesafe/jev-latest"]) {
    const rejected = parseSystemOneRequest({ ...body, model });
    assert.equal(
      rejected.success,
      false,
      `object instructions must reject for ${model ?? "omitted model"}`
    );
  }
});

test("browser instruction object requires its exact typed fields", () => {
  const malformed: unknown[] = [
    { rules: "rule" },
    { goal: "Open the account page" },
    { goal: "Open the account page", rules: 42 },
    { goal: "Open the account page", rules: ["rule", 42] },
    { goal: "Open the account page", rules: "rule", operation: "HOVER" },
    { goal: "Open the account page", rules: "rule", extra: true },
  ];

  for (const instructions of malformed) {
    const parsed = parseSystemOneRequest({
      ...validBody(),
      model: "laya/laya-browser-v19s",
      questions: { operation: { type: "choice", instructions, criteria: {} } },
    });
    assert.equal(parsed.success, false, JSON.stringify(instructions));
  }

  const targetFailures = [
    { goal: "Open the account page", rules: "rule" },
    { goal: "Open the account page", operation: "TYPE_TEXT", rules: "rule" },
  ];
  for (const instructions of targetFailures) {
    const parsed = parseSystemOneRequest({
      ...validBody(),
      model: "laya/laya-browser-v19s",
      questions: { click_target: { type: "choice", instructions, criteria: {} } },
    });
    assert.equal(parsed.success, false, JSON.stringify(instructions));
  }
});

test("SystemOne schema reports required fields and invalid question shapes", () => {
  const invalidBodies: Array<[string, unknown, string]> = [
    ["non-object body", null, "body"],
    ["missing state", { questions: { q: { type: "noul", instructions: "x" } } }, "state"],
    ["wrong state type", { ...validBody(), state: 12 }, "state"],
    ["missing questions", { state: "x" }, "questions"],
    ["empty questions", { state: "x", questions: {} }, "questions"],
    [
      "unknown question type",
      { state: "x", questions: { urgent: { type: "rank", instructions: "x" } } },
      "urgent",
    ],
    [
      "empty instructions",
      { state: "x", questions: { urgent: { type: "noul", instructions: "  " } } },
      "instructions",
    ],
    [
      "choice without criteria",
      { state: "x", questions: { team: { type: "choice", instructions: "Choose" } } },
      "criteria",
    ],
    [
      "score without criteria",
      { state: "x", questions: { score: { type: "score", instructions: "Score" } } },
      "criteria",
    ],
  ];

  for (const [label, body, expectedField] of invalidBodies) {
    const parsed = parseSystemOneRequest(body);
    assert.equal(parsed.success, false, label);
    if (!parsed.success) {
      assert.match(parsed.message, new RegExp(expectedField));
    }
  }
});

test("model selection maps automatic, Jev, and pinned forms", () => {
  assert.deepEqual(parseSystemOneModelSelection(undefined), { kind: "chain" });
  assert.deepEqual(parseSystemOneModelSelection("auto"), { kind: "chain" });
  assert.deepEqual(parseSystemOneModelSelection("systemone/auto"), { kind: "chain" });
  assert.deepEqual(parseSystemOneModelSelection("jev-1.13.0"), {
    kind: "chain",
    jevModel: "jev-1.13.0",
  });
  assert.deepEqual(parseSystemOneModelSelection("laya/multilingual"), {
    kind: "pinned",
    upstream: "laya",
    model: "multilingual",
  });
  assert.deepEqual(parseSystemOneModelSelection("typesafe/jev-latest"), {
    kind: "pinned",
    upstream: "typesafe",
    model: "jev-latest",
  });
  assert.deepEqual(parseSystemOneModelSelection("openrouter/typesafe/jev-1.13"), {
    kind: "pinned",
    upstream: "openrouter",
    model: "typesafe/jev-1.13",
  });
  assert.deepEqual(parseSystemOneModelSelection("other/model"), { kind: "invalid" });
});

test("request reader accepts exactly 1 MiB and rejects the next byte while cancelling", async () => {
  const prefix = new TextEncoder().encode('{"state":"');
  const suffix = new TextEncoder().encode(
    '","questions":{"q":{"type":"noul","instructions":"x"}}}'
  );
  const stateLength = MAX_SYSTEMONE_BODY_BYTES - prefix.byteLength - suffix.byteLength;
  const exactBody = new Uint8Array(MAX_SYSTEMONE_BODY_BYTES);
  exactBody.set(prefix, 0);
  exactBody.fill(120, prefix.byteLength, prefix.byteLength + stateLength);
  exactBody.set(suffix, prefix.byteLength + stateLength);

  const accepted = await readSystemOneJsonBody(
    new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: exactBody,
    })
  );
  assert.equal(accepted.ok, true);

  let pulled = 0;
  let cancelled = false;
  const oversizedStream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled += 1;
        if (pulled === 1) controller.enqueue(exactBody);
        else controller.enqueue(new Uint8Array([120]));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 }
  );
  const rejected = await readSystemOneJsonBody(
    new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedStream,
      // Node's Request implementation requires duplex for streamed request bodies.
      duplex: "half",
    } as RequestInit & { duplex: "half" })
  );

  assert.deepEqual(rejected, { ok: false, status: 413, message: "Request body exceeds 1 MiB" });
  assert.equal(pulled, 2, "reader must stop after the first byte over the cap");
  assert.equal(cancelled, true);
});

test("request reader asks byte streams for at most 1 MiB plus one byte", async () => {
  let requestedBytes = 0;
  let deliveredBytes = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      type: "bytes",
      pull(controller) {
        const request = controller.byobRequest;
        assert.ok(request?.view);
        requestedBytes = Math.max(requestedBytes, request.view.byteLength);
        new Uint8Array(request.view.buffer, request.view.byteOffset, request.view.byteLength).fill(
          120
        );
        deliveredBytes += request.view.byteLength;
        request.respond(request.view.byteLength);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 }
  );
  const result = await readSystemOneJsonBody(
    new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
  );

  assert.deepEqual(result, { ok: false, status: 413, message: "Request body exceeds 1 MiB" });
  assert.equal(requestedBytes, 16 * 1024);
  assert.equal(deliveredBytes, MAX_SYSTEMONE_BODY_BYTES + 1);
  assert.equal(cancelled, true);
});

test("one-byte BYOB chunks keep backing capacity bounded and preserve split UTF-8", async () => {
  const payload = new TextEncoder().encode('{"state":"雪"}');
  const readCapacities: number[] = [];
  const backingCapacities: number[] = [];
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      type: "bytes",
      pull(controller) {
        const request = controller.byobRequest;
        assert.ok(request?.view);
        readCapacities.push(request.view.byteLength);
        backingCapacities.push(request.view.buffer.byteLength);
        new Uint8Array(request.view.buffer, request.view.byteOffset, request.view.byteLength)[0] =
          payload[offset++]!;
        request.respond(1);
        if (offset === payload.length) controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  const result = await readSystemOneJsonBody(
    new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
  );

  assert.deepEqual(result, { ok: true, value: { state: "雪" } });
  assert.equal(offset, payload.length);
  assert.ok(Math.max(...readCapacities) <= 64 * 1024);
  assert.ok(Math.max(...backingCapacities) <= 64 * 1024);
  assert.equal(new Set(backingCapacities).size, 1, "tiny pulls must reuse one bounded read buffer");
});
