import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { Route } from "@/routes/_authenticated/candidates.index";

const { candidates } = vi.hoisted(() => ({
  candidates: Array.from({ length: 30 }, (_, index) => ({
    id: String(index + 1),
    name: `Candidate ${index + 1}`,
  })),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: string) => ({ data: options === "candidates" ? candidates : [] }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: ReactNode }) => <a href="/candidates/detail">{children}</a>,
}));
vi.mock("@/lib/data", () => ({
  candidatesQ: "candidates",
  examsQ: "exams",
  occQ: "occupations",
  ttcQ: "centres",
  lookup: () => () => undefined,
  bn: String,
  todayStr: () => "2026-11-23",
  RESULTS: [],
}));
vi.mock("@/components/app/CandidatePhoto", () => ({ CandidatePhoto: () => null }));
vi.mock("@/components/app/DateSelect", () => ({ DateSelect: () => null }));
vi.mock("@/components/app/forms", () => ({ CandidateDialog: () => <div>Candidate form</div> }));
vi.mock("@/components/app/ResultListShare", () => ({ ResultShareActions: () => null }));
vi.mock("@/components/app/ui-bits", () => ({
  PageHeader: ({ actions }: { actions: ReactNode }) => <header>{actions}</header>,
  NativeSelect: ({ children }: { children: ReactNode }) => <select>{children}</select>,
  Empty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResultBadge: () => null,
}));

it("renders one page at a time, searches across pages, and waits to mount the form", () => {
  const CandidatesPage = Route.options.component!;
  render(<CandidatesPage />);
  expect(screen.getAllByRole("link")).toHaveLength(24);
  expect(screen.queryByText("Candidate 30")).not.toBeInTheDocument();
  expect(screen.queryByText("Candidate form")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "পরের পৃষ্ঠা" }));
  expect(screen.getAllByRole("link")).toHaveLength(6);
  expect(screen.getByText("Candidate 30")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Candidate 1" } });
  expect(screen.getByText("Candidate 1")).toBeInTheDocument();
  expect(screen.queryByText("Candidate 30")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "নতুন পরীক্ষার্থী" }));
  expect(screen.getByText("Candidate form")).toBeInTheDocument();
});
