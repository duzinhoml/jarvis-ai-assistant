import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deferred,
  FakeAPIError,
  FakeConnectionError,
  FakeTimeoutError,
  localReply,
  requestHarness,
  waitForAbort,
} from "./helpers/request-harness.js";

type Harness = ReturnType<typeof requestHarness>;
type Message = { role: "user" | "assistant" | "system"; content: string };
const stages = ["classification", "conversation"] as const;
type Stage = typeof stages[number];

function run(stage: Stage, harness: Harness, signal?: AbortSignal, history: Message[] = []) {
  return stage === "classification"
    ? harness.classifyIntent("What time is it?", null, [], signal)
    : harness.processMessage("Explain closures", history, () => true, () => true, [], signal);
}

function assertCancelled(stage: Stage, result: unknown) {
  if (stage === "classification") {
    assert.equal((result as { status: string }).status, "CANCELLED");
  } else assert.equal(result, null);
}

for (const stage of stages) {
  test(`${stage}: pre-aborted requests do not contact either provider`, async () => {
    const harness = requestHarness();
    const controller = new AbortController();
    controller.abort();
    const result = stage === "classification"
      ? await harness.classifyIntent("What do you remember about me?", null, [], controller.signal)
      : await run(stage, harness, controller.signal);

    assertCancelled(stage, result);
    assert.deepEqual(harness.calls, { primary: 0, fallback: 0, speech: 0 });
    assert.equal(harness.errors.length + harness.warnings.length, 0);
  });

  test(`${stage}: cancellation during OpenAI does not start fallback or speech`, async () => {
    const started = deferred<void>();
    const harness = requestHarness({ primary: async ({ signal }) => {
      started.resolve();
      return waitForAbort(signal);
    } });
    const controller = new AbortController();
    const history: Message[] = [];
    const pending = run(stage, harness, controller.signal, history);
    await started.promise;
    controller.abort();

    assertCancelled(stage, await pending);
    assert.deepEqual(harness.calls, { primary: 1, fallback: 0, speech: 0 });
    assert.equal(harness.errors.length + harness.warnings.length, 0);
    assert.deepEqual(history, []);
  });

  test(`${stage}: cancellation wins over a late successful OpenAI response`, async () => {
    const controller = new AbortController();
    const harness = requestHarness({ primary: async () => {
      controller.abort();
      return { status: "completed", output_text: "GET_TIME" };
    } });
    assertCancelled(stage, await run(stage, harness, controller.signal));
    assert.equal(harness.calls.fallback + harness.calls.speech, 0);
    assert.equal(harness.errors.length, 0);
  });

  for (const duringBody of [false, true]) {
    test(`${stage}: cancels local fallback during ${duringBody ? "body reading" : "fetch"}`, async () => {
      const started = deferred<void>();
      const controller = new AbortController();
      let fallbackSignal: AbortSignal | null | undefined;
      const harness = requestHarness({
        primary: async () => { throw new FakeConnectionError(); },
        fallback: async ({ signal }) => {
          fallbackSignal = signal;
          if (duringBody) return { ok: true, status: 200, json: async () => {
            started.resolve();
            return waitForAbort(signal);
          } };
          started.resolve();
          return waitForAbort(signal);
        },
      });
      const history: Message[] = [];
      const pending = run(stage, harness, controller.signal, history);
      await started.promise;
      const warningCount = harness.warnings.length;
      controller.abort();

      assertCancelled(stage, await pending);
      assert.equal(fallbackSignal?.aborted, true);
      assert.equal(harness.calls.fallback, 1);
      assert.equal(harness.calls.speech, 0);
      assert.equal(harness.errors.length, 0);
      assert.equal(harness.warnings.length, warningCount);
      assert.deepEqual(history, []);
    });
  }

  test(`${stage}: cancellation wins over a late successful fallback response`, async () => {
    const controller = new AbortController();
    const harness = requestHarness({
      primary: async () => { throw new FakeConnectionError(); },
      fallback: async () => ({ ok: true, status: 200, json: async () => {
        controller.abort();
        return { response: "GET_TIME", message: { content: "Late answer" } };
      } }),
    });
    assertCancelled(stage, await run(stage, harness, controller.signal));
    assert.equal(harness.calls.speech, 0);
    assert.equal(harness.errors.length, 0);
  });

  test(`${stage}: a provider timeout still permits local recovery`, async () => {
    const controller = new AbortController();
    const harness = requestHarness({
      primary: async () => { throw new FakeTimeoutError(); },
      fallback: async () => localReply(),
    });
    const result = await run(stage, harness, controller.signal);
    assert.equal(controller.signal.aborted, false);
    assert.equal(harness.calls.fallback, 1);
    assert.equal(harness.warnings.length, 1);
    if (stage === "classification") {
      assert.equal((result as { status: string }).status, "COMMAND");
    } else {
      assert.equal((result as { aiResponse: string }).aiResponse, "A simulated answer.");
      assert.equal(harness.calls.speech, 1);
    }
  });

  test(`${stage}: local timeout remains an error, and the next request can succeed`, async () => {
    const started = deferred<void>();
    let attempts = 0;
    const controller = new AbortController();
    const harness = requestHarness({
      primary: async () => {
        if (attempts++ === 0) throw new FakeConnectionError();
        return { status: "completed", output_text: "GET_TIME" };
      },
      fallback: async ({ signal }) => {
        started.resolve();
        return waitForAbort(signal);
      },
    });
    const pending = run(stage, harness, controller.signal);
    // Attach rejection handling before manually triggering the simulated deadline.
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await started.promise;
    const timeout = harness.timeouts[0];
    assert.ok(timeout);
    assert.equal(timeout.milliseconds, 30000);
    timeout.controller.abort(new DOMException("Simulated timeout", "TimeoutError"));
    const result = await outcome;

    assert.equal(controller.signal.aborted, false);
    assert.equal(harness.calls.speech, 0);
    if (stage === "classification") {
      assert.ok("value" in result);
      assert.equal((result.value as { status: string }).status, "ERROR");
    } else {
      assert.ok("error" in result);
      assert.equal(result.error.message, "Local conversation fallback failed or timed out.");
    }
    const next = await run(stage, harness, new AbortController().signal);
    if (stage === "classification") assert.equal((next as { status: string }).status, "COMMAND");
    else assert.ok(next);
    assert.equal(harness.calls.primary, 2);
  });

  test(`${stage}: API access errors are not silently sent to fallback`, async () => {
    const harness = requestHarness({ primary: async () => { throw new FakeAPIError(401); } });
    if (stage === "classification") {
      const result = await run(stage, harness);
      assert.equal((result as { status: string }).status, "ERROR");
    } else {
      await assert.rejects(run(stage, harness), /Check API access and request configuration/);
    }
    assert.equal(harness.calls.fallback + harness.calls.speech, 0);
  });
}

test("classification: cancellation wins over a late fallback HTTP failure", async () => {
  const controller = new AbortController();
  const harness = requestHarness({
    primary: async () => { throw new FakeConnectionError(); },
    fallback: async () => {
      controller.abort();
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });

  assertCancelled("classification", await run("classification", harness, controller.signal));
  assert.equal(harness.errors.length, 0);
});

test("classification: cancellation wins over late invalid fallback data", async () => {
  const controller = new AbortController();
  const harness = requestHarness({
    primary: async () => { throw new FakeConnectionError(); },
    fallback: async () => ({ ok: true, status: 200, json: async () => {
      controller.abort();
      return { response: null };
    } }),
  });

  assertCancelled("classification", await run("classification", harness, controller.signal));
  assert.equal(harness.errors.length, 0);
});

test("conversation: cancellation during speech prevents saving the exchange", async () => {
  const controller = new AbortController();
  const history: Message[] = [{ role: "system", content: "Synthetic system prompt" }];
  const before = structuredClone(history);
  const harness = requestHarness({ speak: async () => {
    controller.abort();
    return true;
  } });

  assert.equal(await run("conversation", harness, controller.signal, history), null);
  assert.equal(harness.calls.speech, 1);
  assert.deepEqual(history, before);
});
