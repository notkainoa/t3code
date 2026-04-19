import { createFileRoute } from "@tanstack/react-router";

import { ProjectExtensionsSettingsPage } from "../components/settings/ExtensionManager";

function SettingsProjectRouteView() {
  const params = Route.useParams();
  return (
    <ProjectExtensionsSettingsPage
      environmentId={params.environmentId}
      projectId={params.projectId}
    />
  );
}

export const Route = createFileRoute("/settings/projects/$environmentId/$projectId")({
  component: SettingsProjectRouteView,
});
