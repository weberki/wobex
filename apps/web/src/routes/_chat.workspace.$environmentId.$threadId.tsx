import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { WorkspaceView } from "../components/WorkspaceView";
import { resolveThreadRouteRefFromKey, resolveThreadRouteRefKey } from "../threadRoutes";

function WorkspaceRouteView() {
  const threadRefKey = Route.useParams({
    select: (params) => resolveThreadRouteRefKey(params),
  });
  const threadRef = useMemo(() => resolveThreadRouteRefFromKey(threadRefKey), [threadRefKey]);
  if (!threadRef) {
    return null;
  }

  return <WorkspaceView environmentId={threadRef.environmentId} threadId={threadRef.threadId} />;
}

export const Route = createFileRoute("/_chat/workspace/$environmentId/$threadId")({
  component: WorkspaceRouteView,
});
