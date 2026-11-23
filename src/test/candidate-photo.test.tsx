import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";

const createSignedUrl = vi.hoisted(() =>
  vi.fn(async () => ({ data: { signedUrl: "https://example.test/photo.jpg" } })),
);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl,
      }),
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  createSignedUrl.mockClear();
});
const mount = (path: string | null, deferUntilVisible = false) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CandidatePhoto
        path={path}
        name="TEST CANDIDATE"
        size={36}
        deferUntilVisible={deferUntilVisible}
      />
    </QueryClientProvider>,
  );
describe("Candidate photos", () => {
  it("only signs a deferred photo once it nears the viewport", async () => {
    let enterViewport: () => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          enterViewport = () =>
            callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
        }
        observe() {}
        disconnect() {}
      },
    );
    mount("candidate-drafts/id/photo.jpg", true);
    expect(screen.getByText("TC")).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
    act(enterViewport);
    expect(await screen.findByAltText("TEST CANDIDATE")).toBeInTheDocument();
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps initials at the enlarged minimum size without a photo", () => {
    mount(null);
    expect(screen.getByText("TC").parentElement).toHaveStyle({ width: "64px", height: "64px" });
  });
  it("opens a large photo with keyboard activation", async () => {
    mount("candidate-drafts/id/agent-profile.jpg");
    const trigger = await screen.findByRole("button", { name: "TEST CANDIDATE" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getAllByAltText("TEST CANDIDATE")).toHaveLength(2);
  });
});
