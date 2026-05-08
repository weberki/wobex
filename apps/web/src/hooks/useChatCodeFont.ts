import { useEffect } from "react";

import { useSettings } from "./useSettings";

export function useChatCodeFont() {
  const chatCodeFontFamily = useSettings((settings) => settings.chatCodeFontFamily);

  useEffect(() => {
    if (chatCodeFontFamily.trim()) {
      document.documentElement.style.setProperty(
        "--font-chat-code-family",
        chatCodeFontFamily.trim(),
      );
    } else {
      document.documentElement.style.removeProperty("--font-chat-code-family");
    }
  }, [chatCodeFontFamily]);
}
