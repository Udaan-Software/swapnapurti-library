import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Empty } from "./ui";
describe("Empty", () => { it("renders accessible empty-state copy", () => { render(<Empty title="No books" message="Add the first title."/>); expect(screen.getByText("No books")).toBeInTheDocument(); expect(screen.getByText("Add the first title.")).toBeInTheDocument(); }); });
