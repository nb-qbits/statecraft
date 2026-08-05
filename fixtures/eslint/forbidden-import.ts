// Fixture: this file lives under src/modules/ conceptually (path overridden in test).
// It should trigger the no-framework-in-modules rule.
import Fastify from "fastify";
import { drizzle } from "drizzle-orm/node-postgres";

export const app = Fastify();
export const db = drizzle;
