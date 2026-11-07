import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SvpSessionOptions, type SvpSessionOption } from "@/components/app/SvpSessionOptions";

const option = (overrides: Partial<SvpSessionOption> = {}): SvpSessionOption => ({
  key: "opaque-svp-token",
  startAt: "2026-12-01T09:30:00+06:00",
  endAt: "2026-12-01T10:30:00+06:00",
  center: "Cumilla Technical Training Centre, Assessment and Skill Verification Campus",
  city: "Cumilla",
  seats: 7,
  selected: false,
  onSelect: vi.fn(),
  ...overrides,
});

afterEach(cleanup);

describe("SVP session options", () => {
  it("keeps the full name and provider-local time with the correct seats on each option", () => {
    const first = option();
    const second = option({ key: "other", center: "Second center", seats: 2 });
    render(<SvpSessionOptions views={[first, second]} />);
    const button = screen.getByRole("button", { name: /Cumilla Technical Training Centre/ });
    expect(within(button).getByText(first.center!)).toBeInTheDocument();
    expect(within(button).getByText("9:30 AM – 10:30 AM · সকাল")).toBeInTheDocument();
    expect(within(button).getByText("7")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Second center/ })).getByText("2"),
    ).toBeInTheDocument();
    fireEvent.click(button);
    expect(first.onSelect).toHaveBeenCalledOnce();
    expect(second.onSelect).not.toHaveBeenCalled();
  });

  it("leaves missing metadata unknown rather than inventing a center, midnight or seats", () => {
    render(
      <SvpSessionOptions
        views={[option({ center: null, startAt: "2026-12-01", endAt: null, seats: null })]}
      />,
    );
    expect(within(screen.getByRole("button")).getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText(/00:00|Not provided by SVP/)).not.toBeInTheDocument();
  });

  it("prevents selection of sold-out or refreshing sessions", () => {
    const soldOut = option({ seats: 0 });
    const { rerender } = render(<SvpSessionOptions views={[soldOut]} />);
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(soldOut.onSelect).not.toHaveBeenCalled();
    rerender(<SvpSessionOptions views={[option()]} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
