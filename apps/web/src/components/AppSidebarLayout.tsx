import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { ProjectTabs } from "./ProjectTabs";
import { SidebarProvider } from "./ui/sidebar";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowKeyUp = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowBlur = () => {
      clearShortcutModifierState();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider
      className="h-dvh! min-h-0! flex-col overflow-hidden bg-muted/55 px-2 pb-2 pt-1 text-foreground sm:px-3 sm:pb-3 sm:pt-2"
      defaultOpen
    >
      <ProjectTabs />
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-[0_18px_48px_-32px_color-mix(in_srgb,var(--foreground)_34%,transparent)]">
        {children}
      </div>
    </SidebarProvider>
  );
}
