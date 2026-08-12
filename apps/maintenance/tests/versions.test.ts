import { describe, expect, it } from "vitest";
import {
  extractFixPackage,
  extractFixVersion,
  normalizePackageName,
  selectVersions,
  updateType,
} from "../src/remediation/versions.js";

describe("generic remediator version selection", () => {
  it("normalizes TeamPulse aggregate package names", () => {
    expect(normalizePackageName("npm-@angular-devkit/core-aggregate")).toBe("@angular-devkit/core");
    expect(normalizePackageName("@babel/core")).toBe("@babel/core");
  });

  it("extracts fix package and version from npm audit fixAvailable", () => {
    const vuln = {
      packageName: "ajv",
      installedVersion: "6.12.0",
      fixAvailable: { name: "webpack", version: "5.94.0", isSemVerMajor: false },
    };
    expect(extractFixPackage(vuln)).toBe("webpack");
    expect(extractFixVersion(vuln)).toBe("5.94.0");
  });

  it("classifies semver bumps", () => {
    expect(updateType("1.2.3", "1.2.4")).toBe("patch");
    expect(updateType("1.2.3", "1.3.0")).toBe("minor");
    expect(updateType("1.2.3", "2.0.0")).toBe("major");
  });

  it("skips major bumps when not allowed", () => {
    const selected = selectVersions(
      [
        {
          packageName: "lodash",
          installedVersion: "3.10.1",
          recommendedVersion: "4.17.21",
          title: "Prototype pollution",
          severity: "High",
        },
      ],
      { allowMajorUpdates: false },
    );
    expect(selected.candidates).toHaveLength(0);
    expect(selected.skipped[0]?.packageName).toBe("lodash");
  });

  it("selects patch/minor fixes", () => {
    const selected = selectVersions(
      [
        {
          packageName: "@babel/core",
          installedVersion: "7.23.0",
          recommendedVersion: "7.26.10",
          severity: "Low",
          title: "Arbitrary File Read",
        },
      ],
      { allowMajorUpdates: false },
    );
    expect(selected.candidates).toEqual([
      expect.objectContaining({
        packageName: "@babel/core",
        toVersion: "7.26.10",
        updateType: "minor",
      }),
    ]);
  });
});
