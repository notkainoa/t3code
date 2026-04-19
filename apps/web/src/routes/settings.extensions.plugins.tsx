import { createFileRoute } from "@tanstack/react-router";

import { PluginsDiscoverSettingsPage } from "../components/settings/ExtensionManager";

export const Route = createFileRoute("/settings/extensions/plugins")({
  component: PluginsDiscoverSettingsPage,
});
