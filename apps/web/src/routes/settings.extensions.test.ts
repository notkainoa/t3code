import { describe, expect, it } from "vitest";

import { Route } from "./settings.extensions";

describe("/settings/extensions redirect", () => {
  it("redirects the bare extensions route to plugins", async () => {
    const beforeLoad = Route.options.beforeLoad;
    expect(beforeLoad).toBeDefined();

    await expect(
      beforeLoad?.({
        location: { pathname: "/settings/extensions" },
      } as never),
    ).rejects.toMatchObject({
      status: 307,
      options: {
        to: "/settings/extensions/plugins",
        replace: true,
      },
    });
  });

  it("does not redirect child extensions routes", async () => {
    const beforeLoad = Route.options.beforeLoad;
    expect(beforeLoad).toBeDefined();

    await expect(
      beforeLoad?.({
        location: { pathname: "/settings/extensions/plugins" },
      } as never),
    ).resolves.toBeUndefined();

    await expect(
      beforeLoad?.({
        location: { pathname: "/settings/extensions/skills" },
      } as never),
    ).resolves.toBeUndefined();
  });
});
