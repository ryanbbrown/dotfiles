import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly as scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

const scan = scanPublicSdkOnly(dirname(fileURLToPath(import.meta.url)), {
  allow: [
    /^@testing-library\/react$/u,
    /^better-sqlite3$/u,
    /^react$/u,
    /^sonner$/u,
    /^vitest\/config$/u,
  ],
});

describe("Firstmate Queue public SDK boundary", () => {
  it("uses only public SDK and package-local imports", () => {
    expect(scan.violations).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });
});
