import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ loading: false }));
vi.mock("@tanstack/react-router", () => ({ useRouterState: () => state.loading }));
import { NavLoader } from "@/components/app/WorkerLoader";
it("hydrates CSR-only routes even when client loading differs from the server shell", async () => {
  state.loading = false;
  const markup = renderToString(<NavLoader />);
  expect(markup).toBe("");
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.appendChild(host);
  state.loading = true;
  const errors = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(host, <NavLoader />, { onRecoverableError: errors });
  });
  expect(errors).not.toHaveBeenCalled();
  expect(host.querySelector(".fixed")).toBeInTheDocument();
  await act(async () => root.unmount());
  host.remove();
});
