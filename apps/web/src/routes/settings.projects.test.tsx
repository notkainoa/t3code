import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsProjectsPage } from "./settings.projects";

function renderProjectsRoute(pathname: string) {
  const rootRoute = createRootRoute({
    component: Outlet,
  });
  const projectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/projects",
    component: SettingsProjectsPage,
  });
  const projectDetailRoute = createRoute({
    getParentRoute: () => projectsRoute,
    path: "$environmentId/$projectId",
    component: () => <div>Project detail marker</div>,
  });

  const routeTree = rootRoute.addChildren([projectsRoute.addChildren([projectDetailRoute])]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [pathname],
    }),
  });

  return router.load().then(() => renderToStaticMarkup(<RouterProvider router={router} />));
}

describe("/settings/projects route", () => {
  it("shows the empty state for the bare projects route", async () => {
    const html = await renderProjectsRoute("/settings/projects");

    expect(html).toContain("Select a project");
    expect(html).not.toContain("Project detail marker");
  });

  it("renders child project routes through the projects layout", async () => {
    const html = await renderProjectsRoute("/settings/projects/env-1/project-1");

    expect(html).toContain("Project detail marker");
    expect(html).not.toContain("Select a project");
  });
});
