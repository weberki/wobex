import { memo, useMemo, useState } from "react";
import { getVscodeIconUrlForEntry } from "../../vscode-icons";
import { FileIcon, FolderClosedIcon, FolderOpenIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export const VscodeEntryIcon = memo(function VscodeEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  expanded?: boolean;
  root?: boolean;
  className?: string;
}) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = useMemo(() => {
    const options: { expanded?: boolean; root?: boolean } = {};
    if (props.expanded !== undefined) {
      options.expanded = props.expanded;
    }
    if (props.root !== undefined) {
      options.root = props.root;
    }
    return getVscodeIconUrlForEntry(props.pathValue, props.kind, props.theme, options);
  }, [props.expanded, props.kind, props.pathValue, props.root, props.theme]);
  const failed = failedIconUrl === iconUrl;

  if (failed) {
    return props.kind === "directory" ? (
      props.expanded ? (
        <FolderOpenIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
      ) : (
        <FolderClosedIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
      )
    ) : (
      <FileIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", props.className)}
      loading="lazy"
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
});
