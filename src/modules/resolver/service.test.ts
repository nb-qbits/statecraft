import { describe, it, expect } from "vitest";
import { extractSubsectionRef } from "./service.js";

describe("extractSubsectionRef", () => {
  it("extracts 'under subsection (a)' → '(a)'", () => {
    const text = "the date on which the head of an agency submits the report required under subsection (a)";
    expect(extractSubsectionRef(text)).toBe("(a)");
  });

  it("extracts 'under subsection (b)(2)' → '(b)(2)'", () => {
    const text = "the date on which the head of an agency provides notice to Congress under subsection (b)(2)";
    expect(extractSubsectionRef(text)).toBe("(b)(2)");
  });

  it("extracts 'pursuant to subsection (b)(2)' → '(b)(2)'", () => {
    const text = "the date on which the second report is submitted pursuant to subsection (b)(2)";
    expect(extractSubsectionRef(text)).toBe("(b)(2)");
  });

  it("extracts ref from hyphenated text 'sub- mitted pursuant to subsection (b)(2)' → '(b)(2)'", () => {
    const text = "the date on which the second report is sub- mitted pursuant to subsection (b)(2)";
    expect(extractSubsectionRef(text)).toBe("(b)(2)");
  });

  it("extracts 'described in subsection (a)(1)' → '(a)(1)'", () => {
    const text = "the calendar year described in subsection (a)(1)";
    expect(extractSubsectionRef(text)).toBe("(a)(1)");
  });

  it("extracts 'required under paragraph (1)' → '(1)'", () => {
    const text = "all of the notices required pursuant to paragraph (1) have been provided";
    expect(extractSubsectionRef(text)).toBe("(1)");
  });

  it("returns null when no subsection reference", () => {
    const text = "the date of enactment of this Act";
    expect(extractSubsectionRef(text)).toBeNull();
  });

  it("returns null for bare parenthetical without keyword", () => {
    const text = "the head of an agency (as defined in section 3502)";
    expect(extractSubsectionRef(text)).toBeNull();
  });
});
