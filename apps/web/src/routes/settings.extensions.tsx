import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/extensions")({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/settings/extensions") {
      throw redirect({ to: "/settings/extensions/plugins", replace: true });
    }
  },
});
