// Regression guard: Anthropic retires model aliases on a published schedule
// (see https://docs.claude.com/en/docs/about-claude/model-deprecations).
// This test reads the Edge Function sources directly and asserts that none
// of them ship with a retired alias as the default `ANTHROPIC_MODEL` value.
// Loop 7 (2026-04-30) caught this in production: parse-prescription defaulted
// to `claude-3-5-sonnet-latest`, retired 2025-10-28.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RETIRED_ALIASES = [
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-7-sonnet-20250219",
  "claude-2.0",
  "claude-2.1",
];

const FUNCTIONS_WITH_MODEL_DEFAULT = [
  "supabase/functions/parse-prescription/index.ts",
  "supabase/functions/verify-pill/index.ts",
];

describe("Edge Function model defaults", () => {
  for (const relativePath of FUNCTIONS_WITH_MODEL_DEFAULT) {
    it(`${relativePath} does not default to a retired Anthropic alias`, () => {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      const match = source.match(
        /ANTHROPIC_MODEL\s*=\s*Deno\.env\.get\("ANTHROPIC_MODEL"\)\s*\?\?\s*"([^"]+)"/,
      );
      expect(match, `expected to find ANTHROPIC_MODEL default in ${relativePath}`).not.toBeNull();
      const defaultModel = match![1];
      expect(RETIRED_ALIASES, `${relativePath} default "${defaultModel}" is a retired alias`).not
        .toContain(defaultModel);
    });
  }
});
