import { Outlet, createFileRoute } from "@tanstack/react-router";

function ProjectBoardRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_chat/$environmentId/board/$projectId")({
  component: ProjectBoardRouteLayout,
});
