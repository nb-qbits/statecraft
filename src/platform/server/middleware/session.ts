import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { UserRepository } from "../../db/user-repository.js";
import type { Logger } from "../../logger/logger.js";

const COOKIE_NAME = "pa_session";
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60; // 1 year

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

function sign(userId: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

function verify(cookie: string, secret: string): string | null {
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const userId = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);
  const expected = createHmac("sha256", secret).update(userId).digest("hex");
  if (sig.length !== expected.length) return null;
  let match = true;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] !== expected[i]) match = false;
  }
  return match ? userId : null;
}

export function registerSessionMiddleware(
  app: FastifyInstance,
  userRepository: UserRepository,
  cookieSecret: string,
  logger: Logger,
): void {
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health" || req.url === "/ready") return;

    const raw = req.cookies?.[COOKIE_NAME];

    if (raw) {
      const userId = verify(raw, cookieSecret);
      if (userId) {
        const user = await userRepository.getUser(userId);
        if (user) {
          req.userId = userId;
          return;
        }
      }
    }

    const { userId } = await userRepository.createUser();
    req.userId = userId;
    logger.info({ userId }, "created new session user");

    void reply.setCookie(COOKIE_NAME, sign(userId, cookieSecret), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_S,
      secure: false,
    });
  });
}
