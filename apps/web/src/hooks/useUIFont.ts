import { useEffect } from "react";

import { useSettings } from "./useSettings";

export function useUIFont() {
  const uiFontFamily = useSettings((settings) => settings.uiFontFamily);

  useEffect(() => {
    if (uiFontFamily.trim()) {
      document.documentElement.style.setProperty("--font-ui-family", uiFontFamily.trim());
    } else {
      document.documentElement.style.removeProperty("--font-ui-family");
    }
  }, [uiFontFamily]);
}
