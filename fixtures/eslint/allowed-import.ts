// Fixture: this file lives under src/modules/ conceptually (path overridden in test).
// It should NOT trigger the no-framework-in-modules rule.
import { z } from "zod";
import { randomUUID } from "node:crypto";

export const schema = z.string();
export const id = randomUUID();
