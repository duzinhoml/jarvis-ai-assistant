import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { isValidLocalCommand } from "../../commands/router.js";
import { buildMemoryContext, isMemoryCommand } from "../../memory/index.js";

type RequestOptions = { signal?: AbortSignal | undefined };
type ModelReply = { status: string; output_text: string };
type LocalReply = { ok: boolean; status: number; json: () => Promise<unknown> };

export class FakeAPIError extends Error {
  constructor(public status?: number) {
    super("Simulated provider failure");
  }
}
export class FakeConnectionError extends FakeAPIError {}
export class FakeTimeoutError extends FakeConnectionError {}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function waitForAbort(signal?: AbortSignal | null): Promise<never> {
  if (!signal) throw new Error("Expected a request signal");
  return new Promise((_, reject) => {
    const abort = () =>
      reject(new DOMException("Simulated cancellation", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export function localReply(
  content = "A simulated answer.",
  classification = "GET_TIME",
): LocalReply {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: classification, message: { content } }),
  };
}

type HarnessOptions = {
  primary?: (options: RequestOptions) => Promise<ModelReply>;
  fallback?: (options: RequestInit) => Promise<LocalReply>;
  speak?: () => Promise<boolean>;
};

export function requestHarness(options: HarnessOptions = {}) {
  const calls = { primary: 0, fallback: 0, speech: 0 };
  const logs: unknown[][] = [];
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  const timeouts: { milliseconds: number; controller: AbortController }[] = [];

  class FakeOpenAI {
    static APIError = FakeAPIError;
    static APIConnectionError = FakeConnectionError;
    responses = {
      create: async (_body: unknown, requestOptions: RequestOptions) => {
        calls.primary++;
        return options.primary
          ? options.primary(requestOptions)
          : { status: "completed", output_text: "GET_TIME" };
      },
    };
  }

  const imports: Record<string, unknown> = {
    openai: FakeOpenAI,
    "./router.js": { isValidLocalCommand },
    "../memory/index.js": { buildMemoryContext, isMemoryCommand },
    "./index.js": { MAX_CONTEXT_TURNS: 10, MAX_CONTEXT_CHARACTERS: 6000 },
    "../tts/index.js": {
      speak: async () => {
        calls.speech++;
        return options.speak ? options.speak() : true;
      },
    },
  };

  function load(file: URL) {
    const moduleObject = { exports: {} };
    const compiled = transformSync(readFileSync(file, "utf8"), {
      loader: "ts",
      format: "cjs",
      target: "es2022",
    }).code;
    runInNewContext(compiled, {
      module: moduleObject,
      exports: moduleObject.exports,
      require: (name: string) => {
        if (!(name in imports)) throw new Error("Unexpected test import");
        return imports[name];
      },
      process: { env: Object.create(null) },
      console: {
        log: (...args: unknown[]) => logs.push(args),
        warn: (...args: unknown[]) => warnings.push(args),
        error: (...args: unknown[]) => errors.push(args),
      },
      AbortSignal: {
        any: (signals: AbortSignal[]) => AbortSignal.any(signals),
        timeout: (milliseconds: number) => {
          const controller = new AbortController();
          timeouts.push({ milliseconds, controller });
          return controller.signal;
        },
      },
      fetch: async (_url: unknown, requestOptions: RequestInit) => {
        calls.fallback++;
        if (!options.fallback) throw new Error("Unexpected fallback request");
        return options.fallback(requestOptions);
      },
    });
    return moduleObject.exports;
  }

  const { classifyIntent } = load(
    new URL("../../commands/classifier.ts", import.meta.url),
  ) as {
    classifyIntent: typeof import("../../commands/classifier.js").classifyIntent;
  };
  const { processMessage } = load(
    new URL("../../conversation/ai.ts", import.meta.url),
  ) as {
    processMessage: typeof import("../../conversation/ai.js").processMessage;
  };

  return {
    classifyIntent,
    processMessage,
    calls,
    logs,
    warnings,
    errors,
    timeouts,
  };
}
