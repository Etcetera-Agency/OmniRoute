import { z } from "zod";

import type { SystemOneUpstreamName } from "./config.ts";

export const MAX_SYSTEMONE_BODY_BYTES = 1024 * 1024;
export const SYSTEMONE_ACCEPTED_MODEL_FORMS =
  "auto, systemone/auto, jev-*, laya, laya/checkpoint, typesafe/model, openrouter/model";
const SYSTEMONE_READ_BUFFER_BYTES = 16 * 1024;
// AICODE-NOTE: Keep this target suffix pattern aligned with browser_adapter.py's native question-ID check.
const BROWSER_TARGET_QUESTION_PATTERN = /(?:^|_)(click|type_text|select)_target$/i;
const nonEmptyInstructionTextSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "must be a non-empty string",
});

const browserInstructionSchema = z
  .object({
    goal: z.string(),
    operation: z.enum(["CLICK", "TYPE_TEXT", "SELECT"]).optional(),
    rules: z.union([z.string(), z.array(z.string())]),
  })
  .strict();

const questionSchema = z
  .object({
    type: z.enum(["choice", "score", "noul"]),
    instructions: z.union([nonEmptyInstructionTextSchema, browserInstructionSchema]),
  })
  .passthrough()
  .superRefine((question, context) => {
    if (
      (question.type === "choice" || question.type === "score") &&
      !Object.hasOwn(question, "criteria")
    ) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "criteria is required",
      });
    }
  });

const stateSchema = z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]);

export const systemOneRequestSchema = z
  .object({
    state: stateSchema,
    questions: z
      .record(z.string(), questionSchema)
      .refine((questions) => Object.keys(questions).length > 0),
    model: z.string().optional(),
  })
  .passthrough()
  .superRefine((request, context) => {
    for (const [name, question] of Object.entries(request.questions)) {
      if (typeof question.instructions === "string") continue;

      if (request.model !== "laya/laya-browser-v19s") {
        // AICODE-NOTE: Native Browser v19s instructions are allowed only on its exact pinned SystemOne model; all other model paths keep string instructions.
        context.addIssue({
          code: "custom",
          path: ["questions", name, "instructions"],
          message: "object instructions require model laya/laya-browser-v19s",
        });
        continue;
      }

      const targetQuestion = BROWSER_TARGET_QUESTION_PATTERN.exec(name);
      if (!targetQuestion) continue;

      if (!question.instructions.operation) {
        context.addIssue({
          code: "custom",
          path: ["questions", name, "instructions", "operation"],
          message: "operation is required for browser target questions",
        });
      } else if (question.instructions.operation !== targetQuestion[1]?.toUpperCase()) {
        context.addIssue({
          code: "custom",
          path: ["questions", name, "instructions", "operation"],
          message: "operation must match the browser target question",
        });
      }
    }
  });

export type SystemOneQuestion = z.infer<typeof questionSchema>;
export type SystemOneRequest = z.infer<typeof systemOneRequestSchema>;

export type ParsedSystemOneRequest =
  { success: true; data: SystemOneRequest } | { success: false; message: string };

export function parseSystemOneRequest(value: unknown): ParsedSystemOneRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, message: "body must be a JSON object" };
  }

  const parsed = systemOneRequestSchema.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data };

  const firstIssue = parsed.error.issues[0];
  const field = firstIssue?.path.map(String).join(".") || "body";
  return { success: false, message: `${field}: ${firstIssue?.message ?? "invalid value"}` };
}

export type SystemOneModelSelection =
  | { kind: "chain"; jevModel?: string }
  | { kind: "pinned"; upstream: SystemOneUpstreamName; model?: string }
  | { kind: "invalid" };

export function parseSystemOneModelSelection(model: string | undefined): SystemOneModelSelection {
  if (model === undefined || model === "auto" || model === "systemone/auto") {
    return { kind: "chain" };
  }
  if (model.startsWith("jev-")) return { kind: "chain", jevModel: model };

  if (model === "laya") return { kind: "pinned", upstream: "laya" };

  for (const upstream of ["laya", "typesafe", "openrouter"] as const) {
    const prefix = `${upstream}/`;
    if (model.startsWith(prefix) && model.length > prefix.length) {
      return { kind: "pinned", upstream, model: model.slice(prefix.length) };
    }
  }

  return { kind: "invalid" };
}

export type SystemOneJsonReadResult =
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; message: string };

export async function readSystemOneJsonBody(request: Request): Promise<SystemOneJsonReadResult> {
  if (!request.body) return { ok: false, status: 400, message: "Invalid JSON body" };

  let byobReader: ReadableStreamBYOBReader | null = null;
  let defaultReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    byobReader = request.body.getReader({ mode: "byob" });
  } catch {
    defaultReader = request.body.getReader();
  }

  // AICODE-NOTE: Copy each read into one capped buffer; retaining BYOB views can
  // pin a large backing buffer for every tiny upstream chunk.
  const bodyBytes = new Uint8Array(MAX_SYSTEMONE_BODY_BYTES);
  let byobBuffer = byobReader ? new Uint8Array(SYSTEMONE_READ_BUFFER_BYTES) : null;
  let totalBytes = 0;

  try {
    while (true) {
      const remainingBytes = MAX_SYSTEMONE_BODY_BYTES - totalBytes;
      const { done, value } = byobReader
        ? await byobReader.read(
            byobBuffer!.subarray(0, Math.min(remainingBytes + 1, byobBuffer!.byteLength))
          )
        : await defaultReader!.read();
      if (done) break;
      if (!value) continue;

      if (value.byteLength > remainingBytes) {
        // A single byte beyond the cap proves overflow. Do not retain that chunk
        // or pull another one; cancel the stream as soon as the limit is known.
        await (byobReader ?? defaultReader!).cancel().catch(() => undefined);
        return { ok: false, status: 413, message: "Request body exceeds 1 MiB" };
      }

      bodyBytes.set(value, totalBytes);
      totalBytes += value.byteLength;
      if (byobReader) {
        byobBuffer =
          value.buffer instanceof ArrayBuffer
            ? new Uint8Array(
                value.buffer,
                0,
                Math.min(value.buffer.byteLength, SYSTEMONE_READ_BUFFER_BYTES)
              )
            : new Uint8Array(SYSTEMONE_READ_BUFFER_BYTES);
      }
    }
  } catch {
    return { ok: false, status: 400, message: "Unable to read request body" };
  } finally {
    byobReader?.releaseLock();
    defaultReader?.releaseLock();
  }

  try {
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes.subarray(0, totalBytes))
      ),
    };
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON body" };
  }
}
