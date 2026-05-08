import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@wobex/contracts";
import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon } from "lucide-react";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  const hasProviderStatus = Boolean(
    status && status.status !== "ready" && status.status !== "disabled",
  );
  if (!hasProviderStatus) {
    return null;
  }

  const providerLabel = status
    ? (PROVIDER_DISPLAY_NAMES[status.provider] ?? status.provider)
    : null;
  const defaultMessage =
    status?.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = `${providerLabel} provider status`;
  const variant = status?.status === "error" ? "error" : "warning";

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={variant}>
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="space-y-1.5">
          {hasProviderStatus ? (
            <p className="line-clamp-3" title={status?.message ?? defaultMessage}>
              {status?.message ?? defaultMessage}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
});
