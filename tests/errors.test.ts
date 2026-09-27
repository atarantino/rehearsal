import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeError } from "../src/errors";
test("decodes structured plan-limit errors, string data, and bare client messages", () => {
  const limit = Object.assign(
    new Error(
      "[CONVEX M(x)] Server Error Uncaught ConvexError: {} Called by client",
    ),
    {
      data: { code: "PLAN_LIMIT", message: "Allowance used up." },
    },
  );
  assert.deepEqual(decodeError(limit), {
    message: "Allowance used up.",
    planLimit: true,
  });
  assert.deepEqual(
    decodeError(Object.assign(new Error("x"), { data: "Use a public URL." })),
    {
      message: "Use a public URL.",
      planLimit: false,
    },
  );
  assert.deepEqual(
    decodeError(
      new Error(
        "[CONVEX M(preparation:create)] [Request ID: r] Server Error Uncaught Error: Boom Called by client",
      ),
    ),
    { message: "Boom", planLimit: false },
  );
  assert.deepEqual(decodeError("plain"), {
    message: "plain",
    planLimit: false,
  });
  assert.equal(
    decodeError(undefined).message,
    "The request failed. Please retry.",
  );
  assert.equal(
    decodeError(
      Object.assign(new Error(""), { data: { code: "OTHER", message: "m" } }),
    ).planLimit,
    false,
  );
});
