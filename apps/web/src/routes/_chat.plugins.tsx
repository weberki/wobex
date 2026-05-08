import { createFileRoute } from "@tanstack/react-router";

import { PluginLibrary } from "../components/PluginLibrary";
import { usePrimaryEnvironmentId } from "../environments/primary";

function PluginLibraryRouteView() {
  const environmentId = usePrimaryEnvironmentId();
  return <PluginLibrary environmentId={environmentId} />;
}

export const Route = createFileRoute("/_chat/plugins")({
  component: PluginLibraryRouteView,
});
