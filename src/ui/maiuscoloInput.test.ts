import { describe, expect, it, vi } from "vitest";
import { maiuscoloInput } from "./maiuscoloInput";

describe("maiuscolo durante la digitazione", () => {
  it.each([
    ["RSSmRA80A01H501X", 4, 4, "none", "RSSMRA80A01H501X", 4, 4],
    ["abcDEF", 1, 4, "backward", "ABCDEF", 1, 4],
    ["rM", 1, 1, "none", "RM", 1, 1],
    ["aßcd", 2, 3, "forward", "ASSCD", 3, 4],
  ] as const)("conserva la selezione in %s", (value, start, end, direction, expected, nextStart, nextEnd) => {
    const setSelectionRange = vi.fn();
    const input = { value, selectionStart: start, selectionEnd: end, selectionDirection: direction, setSelectionRange } as unknown as HTMLInputElement;

    expect(maiuscoloInput(input)).toBe(expected);
    expect(input.value).toBe(expected);
    expect(setSelectionRange).toHaveBeenCalledWith(nextStart, nextEnd, direction);
  });

  it("non riscrive un valore già maiuscolo durante cancellazione o sostituzione", () => {
    const setSelectionRange = vi.fn();
    const input = { value: "RSSRA80A01H501X", selectionStart: 3, selectionEnd: 3, selectionDirection: "none", setSelectionRange } as unknown as HTMLInputElement;
    expect(maiuscoloInput(input)).toBe("RSSRA80A01H501X");
    expect(setSelectionRange).not.toHaveBeenCalled();
  });
});
