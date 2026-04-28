import { describe, expect, it } from "vitest";
import { getFunctionErrorMessage, isLowConfidenceParseResult, isLowConfidenceVerificationResult } from "./edgeFunctionClient";

describe("getFunctionErrorMessage", () => {
  it("uses the structured edge-function message when present", () => {
    expect(
      getFunctionErrorMessage(
        { error: { code: "image_too_large", message: "Image exceeds the 5MB limit" } },
        "Fallback message",
      ),
    ).toBe("Image exceeds the 5MB limit");
  });

  it("falls back when the payload is not structured", () => {
    expect(getFunctionErrorMessage({ nope: true }, "Fallback message")).toBe("Fallback message");
  });
});

describe("confidence helpers", () => {
  it("flags low-confidence parse results", () => {
    expect(isLowConfidenceParseResult({ confidence: 0.49 })).toBe(true);
    expect(isLowConfidenceParseResult({ confidence: 0.82 })).toBe(false);
  });

  it("flags low-confidence verification results", () => {
    expect(isLowConfidenceVerificationResult({ confidence: 0.69, verified: false })).toBe(true);
    expect(isLowConfidenceVerificationResult({ confidence: 0.91, verified: true })).toBe(false);
  });
});
