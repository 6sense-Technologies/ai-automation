import { describe, expect, it } from "vitest";
import { bugfixBranchName, bugfixBranchPattern, slugify } from "../src/pipeline/naming.js";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumerics with dashes", () => {
    expect(slugify("NullPointer in OrderService#submit()")).toBe("nullpointer-in-orderservice-submit");
  });

  it("strips accents", () => {
    expect(slugify("Café crashes on naïve input")).toBe("cafe-crashes-on-naive-input");
  });

  it("truncates at a word boundary around 40 chars", () => {
    const slug = slugify("this is a very long bug summary that keeps going and going and going");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("this-is-a-very-long-bug-summary-that");
  });

  it("falls back when the summary has no usable characters", () => {
    expect(slugify("!!! ???")).toBe("fix");
  });
});

describe("bugfixBranchName", () => {
  it("follows the bugfix/<TICKET-ID>-<slug> convention", () => {
    expect(bugfixBranchName("PROJ-123", "Login fails with 500 on empty password")).toBe(
      "bugfix/PROJ-123-login-fails-with-500-on-empty-password",
    );
  });
});

describe("bugfixBranchPattern", () => {
  it("matches any bugfix branch for the ticket", () => {
    expect(bugfixBranchPattern("PROJ-123")).toBe("refs/heads/bugfix/PROJ-123-*");
  });
});
