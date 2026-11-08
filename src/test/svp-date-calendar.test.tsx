import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SvpDateCalendar } from "@/components/app/SvpDateCalendar";

afterEach(cleanup);

const options = [
  { date: "2026-11-05", seats: 7 },
  { date: "2026-11-09", seats: 1 },
  { date: "2026-12-02", seats: null },
];

describe("SVP date calendar", () => {
  it("loads another month inside the same calendar and keeps date selection closed afterwards", () => {
    const onMonthChange = vi.fn();
    const onSelect = vi.fn();
    const props = {
      month: "2026-11",
      monthOptions: [
        { value: "2026-11", label: "November 2026" },
        { value: "2026-12", label: "December 2026" },
      ],
      onMonthChange,
      onSelect,
      value: "",
    };
    const { rerender } = render(<SvpDateCalendar {...props} options={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "পরীক্ষার তারিখ" }));
    fireEvent.change(screen.getByLabelText("মাস"), { target: { value: "2026-12" } });
    expect(onMonthChange).toHaveBeenCalledWith("2026-12");
    rerender(
      <SvpDateCalendar {...props} month="2026-12" options={[{ date: "2026-12-02", seats: 3 }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /2 Dec 2026/ }));
    expect(onSelect).toHaveBeenCalledWith("2026-12-02");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays closed until clicked, then shows available dates with seats", () => {
    render(<SvpDateCalendar options={options} value="" onSelect={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("তারিখ বাছুন")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "পরীক্ষার তারিখ" }));

    const dialog = screen.getByRole("dialog", { name: "খালি তারিখ" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /5 Nov 2026/ })).toBeInTheDocument();
    expect(screen.getByText("7 আসন")).toBeInTheDocument();
    expect(screen.getByText("1 আসন")).toBeInTheDocument();
    // Month groups
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    expect(screen.getByText("December 2026")).toBeInTheDocument();
  });

  it("closes after a date is chosen and reopens on the next click", () => {
    const onSelect = vi.fn();
    render(<SvpDateCalendar options={options} value="" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "পরীক্ষার তারিখ" }));
    fireEvent.click(screen.getByRole("button", { name: /5 Nov 2026/ }));

    expect(onSelect).toHaveBeenCalledWith("2026-11-05");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "পরীক্ষার তারিখ" }));
    expect(screen.getByRole("dialog", { name: "খালি তারিখ" })).toBeInTheDocument();
  });

  it("shows the chosen date in the field and highlights it in the calendar", () => {
    render(<SvpDateCalendar options={options} value="2026-11-09" onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "পরীক্ষার তারিখ" })).toHaveTextContent("9 Nov 2026");
    fireEvent.click(screen.getByRole("button", { name: "পরীক্ষার তারিখ" }));
    expect(screen.getByRole("button", { name: /9 Nov 2026/ })).toHaveClass("bg-primary");
  });

  it("explains when no dates are available and closes on outside click", () => {
    render(<SvpDateCalendar options={[]} value="" onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "পরীক্ষার তারিখ" }));
    expect(screen.getByText(/এখন কোনো খালি তারিখ নেই/)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
