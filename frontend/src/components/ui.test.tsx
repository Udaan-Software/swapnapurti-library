import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Empty, Pagination } from "./ui";
describe("Empty", () => { it("renders accessible empty-state copy", () => { render(<Empty title="No books" message="Add the first title."/>); expect(screen.getByText("No books")).toBeInTheDocument(); expect(screen.getByText("Add the first title.")).toBeInTheDocument(); }); });
describe("Pagination",()=>{it("shows the correct range and changes page",()=>{const change=vi.fn();render(<Pagination page={2} pageSize={20} total={55} onPageChange={change}/>);expect(screen.getByText("Showing 21–40 of 55")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Next"}));expect(change).toHaveBeenCalledWith(3)})});
