import type {
  AuthSessionCapability,
  ClientOrchestrationCommand,
  OrchestrationCommand,
} from "@wobex/contracts";

type WsOrchestrationCommandType = (ClientOrchestrationCommand | OrchestrationCommand)["type"];

export function requiredCapabilityForWsOrchestrationCommand(command: {
  readonly type: WsOrchestrationCommandType;
}): AuthSessionCapability {
  switch (command.type) {
    case "thread.approval.respond":
    case "thread.user-input.respond":
      return "approvals:respond";
    case "thread.checkpoint.revert":
      return "files:write";
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return "settings:admin";
    default:
      return "chat:write";
  }
}
