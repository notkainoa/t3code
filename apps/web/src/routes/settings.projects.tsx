import { PackageIcon } from "lucide-react";
import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";

export function SettingsProjectsEmptyState() {
  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <Empty className="mx-auto max-w-xl rounded-[28px] border border-border/70 bg-card/70 p-8">
        <EmptyMedia>
          <PackageIcon className="size-5" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>Select a project</EmptyTitle>
          <EmptyDescription>
            Choose a project from the sidebar to manage its assigned skills and plugins.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

export function SettingsProjectsPage() {
  const pathname = useLocation({ select: (location) => location.pathname });

  if (pathname === "/settings/projects") {
    return <SettingsProjectsEmptyState />;
  }

  return <Outlet />;
}

export const Route = createFileRoute("/settings/projects")({
  component: SettingsProjectsPage,
});
