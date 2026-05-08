import { createFileRoute } from "@tanstack/react-router";

import { DiagnosticsSettings } from "../components/settings/DiagnosticsSettings";

export const Route = createFileRoute("/settings/diagnostics")({
  component: DiagnosticsSettings,
});
