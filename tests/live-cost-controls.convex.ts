import { afterEach, expect, it, vi } from "vitest";
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../src/api", () => ({ api: apiMock }));
vi.mock("../src/convex", () => ({ cloudEnabled: true }));
import { LiveSession } from "../src/live";
import { delegationFallback } from "../shared/cost-controls";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  apiMock.mockReset();
});
function session() {
  vi.stubGlobal(
    "Audio",
    class {
      autoplay = false;
    },
  );
  const live = new LiveSession({} as never);
  // Exercise actual provider-event routing without a microphone or paid call.
  const wire = live as unknown as {
    record: { id: string };
    channel: { readyState: string; send: ReturnType<typeof vi.fn> };
    event: (event: object) => void;
    disposed: boolean;
  };
  wire.record = { id: "session_test" };
  wire.channel = { readyState: "open", send: vi.fn() };
  return wire;
}
const event = (id: string) => ({
  type: "session.delegation.created",
  delegation: { id, target: "client" },
});
it("deduplicates client delegation events and suppresses superseded and disposed replies", async () => {
  const wire = session();
  const resolve: Array<(value: string) => void> = [];
  apiMock.mockImplementation(() => new Promise<string>((r) => resolve.push(r)));
  wire.event(event("first"));
  wire.event(event("first"));
  await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
  wire.event(event("second"));
  await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
  resolve[0]("Stale question");
  resolve[1]("Current question?");
  await vi.waitFor(() => expect(wire.channel.send).toHaveBeenCalledTimes(1));
  expect(JSON.parse(wire.channel.send.mock.calls[0][0])).toMatchObject({
    type: "session.commentary.append",
    delegation_id: "second",
    content: "Current question?",
  });
  wire.event(event("third"));
  await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
  wire.disposed = true;
  resolve[2]("Too late");
  await new Promise((r) => setTimeout(r, 0));
  expect(wire.channel.send).toHaveBeenCalledTimes(1);
});
it("keeps backend-limit instructions out of speech when the server declines further reasoning", async () => {
  const wire = session();
  apiMock.mockRejectedValue(new Error("Processing limit"));
  wire.event(event("budget"));
  await vi.waitFor(() => expect(wire.channel.send).toHaveBeenCalledTimes(1));
  expect(JSON.parse(wire.channel.send.mock.calls[0][0])).toMatchObject({
    type: "session.thinking.append",
    delegation_id: "budget",
    content: delegationFallback,
  });
});
