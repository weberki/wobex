import { expect, it } from "@effect/vitest";

import { requiredCapabilityForWsOrchestrationCommand } from "./wsAuthorization";

it("maps mobile-safe orchestration commands to chat write", () => {
  expect(requiredCapabilityForWsOrchestrationCommand({ type: "thread.turn.start" })).toBe(
    "chat:write",
  );
  expect(requiredCapabilityForWsOrchestrationCommand({ type: "thread.session.stop" })).toBe(
    "chat:write",
  );
});

it("maps approval and user-input responses to approval capability", () => {
  expect(requiredCapabilityForWsOrchestrationCommand({ type: "thread.approval.respond" })).toBe(
    "approvals:respond",
  );
  expect(requiredCapabilityForWsOrchestrationCommand({ type: "thread.user-input.respond" })).toBe(
    "approvals:respond",
  );
});

it("keeps admin and file mutation commands behind elevated capabilities", () => {
  expect(requiredCapabilityForWsOrchestrationCommand({ type: "project.create" })).toBe(
    "settings:admin",
  );
  expect(requiredCapabilityForWsOrchestrationCommand({ type: "thread.checkpoint.revert" })).toBe(
    "files:write",
  );
});
