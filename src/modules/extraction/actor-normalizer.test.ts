import { describe, it, expect } from "vitest";
import { normalizeActors } from "./actor-normalizer.js";

describe("normalizeActors", () => {
  it("strips leading 'the' case-insensitively", () => {
    const result = normalizeActors(["The Bank", "the Bank"]);
    expect(result.get("The Bank")).toBe("Bank");
    expect(result.get("the Bank")).toBe("Bank");
  });

  it("strips leading 'such', 'said', 'that', 'this', 'each'", () => {
    const result = normalizeActors([
      "such Department",
      "said Board",
      "that Committee",
      "this Agency",
      "Each ex officio member",
    ]);
    expect(result.get("such Department")).toBe("Department");
    expect(result.get("said Board")).toBe("Board");
    expect(result.get("that Committee")).toBe("Committee");
    expect(result.get("this Agency")).toBe("Agency");
    expect(result.get("Each ex officio member")).toBe("ex officio member");
  });

  it("does NOT merge 'Bank' and 'Bank Advisory Board'", () => {
    const result = normalizeActors(["Bank", "Bank Advisory Board"]);
    expect(result.get("Bank")).toBe("Bank");
    expect(result.get("Bank Advisory Board")).toBe("Bank Advisory Board");
  });

  it("does NOT merge 'The Bank' and 'The Bank Advisory Board'", () => {
    const result = normalizeActors(["The Bank", "The Bank Advisory Board"]);
    expect(result.get("The Bank")).toBe("Bank");
    expect(result.get("The Bank Advisory Board")).toBe("Bank Advisory Board");
  });

  it("returns empty map for all-null input", () => {
    const result = normalizeActors([null, null]);
    expect(result.size).toBe(0);
  });

  it("skips empty strings", () => {
    const result = normalizeActors(["", "  ", null]);
    expect(result.size).toBe(0);
  });

  it("leaves names without noise prefixes unchanged", () => {
    const result = normalizeActors(["Auditor of Public Accounts"]);
    expect(result.get("Auditor of Public Accounts")).toBe("Auditor of Public Accounts");
  });

  it("is a pure function of the input — same actor always produces same canonical", () => {
    const r1 = normalizeActors(["The Bank", "the Bank", "Bank"]);
    const r2 = normalizeActors(["the Bank", "Bank", "The Bank"]);
    expect(r1.get("The Bank")).toBe(r2.get("The Bank"));
    expect(r1.get("the Bank")).toBe(r2.get("the Bank"));
    expect(r1.get("Bank")).toBe(r2.get("Bank"));
  });
});
