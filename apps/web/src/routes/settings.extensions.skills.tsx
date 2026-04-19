import { createFileRoute } from "@tanstack/react-router";

import { SkillsDiscoverSettingsPage } from "../components/settings/ExtensionManager";

export const Route = createFileRoute("/settings/extensions/skills")({
  component: SkillsDiscoverSettingsPage,
});
