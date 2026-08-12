import { describe, it, expect } from "vitest";
import { deriveProvisionLabel } from "./provision-label.js";

describe("deriveProvisionLabel", () => {
  it("renders Virginia code-style section", () => {
    expect(deriveProvisionLabel("/body/section[2.2-3704]/p[0]")).toBe("§ 2.2-3704");
  });

  it("renders numbered section", () => {
    expect(deriveProvisionLabel("/body/section[1]/p[0]")).toBe("§ 1");
  });

  it("renders chapter + section", () => {
    expect(deriveProvisionLabel("/body/chapter[1]/section[2]/p[3]")).toBe("Chapter 1, § 2");
  });

  it("renders flat paragraph when no section", () => {
    expect(deriveProvisionLabel("/body/p[0]")).toBe("Paragraph 1");
    expect(deriveProvisionLabel("/body/p[4]")).toBe("Paragraph 5");
  });

  it("renders article + section", () => {
    expect(deriveProvisionLabel("/body/article[3]/section[1]/p[0]")).toBe("Article 3, § 1");
  });

  it("renders part + chapter + section", () => {
    expect(deriveProvisionLabel("/body/part[2]/chapter[1]/section[5]/p[0]")).toBe("Part 2, Chapter 1, § 5");
  });

  it("renders DOCX heading paths", () => {
    expect(deriveProvisionLabel("/body/heading1[0]/p[0]")).toBe("Section 1");
    expect(deriveProvisionLabel("/body/heading1[2]/heading2[1]/p[0]")).toBe("Section 3, Section 2");
  });

  it("renders empty or body-only path as Document", () => {
    expect(deriveProvisionLabel("")).toBe("Document");
    expect(deriveProvisionLabel("/body")).toBe("Document");
    expect(deriveProvisionLabel("/body/")).toBe("Document");
  });

  it("renders complex Virginia code section with subsection path", () => {
    expect(deriveProvisionLabel("/body/section[53.1-39.2]/p[4]")).toBe("§ 53.1-39.2");
  });

  it("renders federal-style title + section", () => {
    expect(deriveProvisionLabel("/body/title[2]/section[301]/p[0]")).toBe("Title 2, § 301");
  });
});
