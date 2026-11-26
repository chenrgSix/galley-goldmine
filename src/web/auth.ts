import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const sessionSeconds = 8 * 60 * 60;
const loginWindowMs = 60_000;
const loginLimit = 6;
const maxSessions = 64;

interface Session {
  id: string;
  csrf: string;
  expiresAt: number;
}

function token() {
  return randomBytes(32).toString("base64url");
}

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function createAdminAuth(password: string, secure: boolean) {
  if (password.trim().length < 12 || password.length > 256) {
    throw new Error("Set GOLDMINE_ADMIN_PASSWORD to a password of 12 to 256 characters.");
  }
  const salt = randomBytes(16);
  const expected = await deriveKey(password, salt);
  const sessions = new Map<string, Session>();
  const cookieName = secure ? "__Host-goldmine_session" : "goldmine_session";
  let windowEndsAt = 0;
  let loginAttempts = 0;
  let verifying = false;

  function setCookie(response: ServerResponse, value: string, maxAge: number) {
    const tls = secure ? "; Secure" : "";
    response.setHeader("Set-Cookie", `${cookieName}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${tls}`);
  }

  function session(request: IncomingMessage) {
    const prefix = `${cookieName}=`;
    const id = request.headers.cookie?.split(";").map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
    const active = id && sessions.get(id);
    if (!active) return undefined;
    if (active.expiresAt > Date.now()) return active;
    sessions.delete(active.id);
    return undefined;
  }

  return {
    session,
    async login(request: IncomingMessage, response: ServerResponse, username: string, supplied: string) {
      const now = Date.now();
      if (now >= windowEndsAt) {
        windowEndsAt = now + loginWindowMs;
        loginAttempts = 0;
      }
      if (loginAttempts >= loginLimit || verifying) {
        response.setHeader("Retry-After", verifying ? "1" : String(Math.ceil((windowEndsAt - now) / 1000)));
        return "limited";
      }
      loginAttempts += 1;
      verifying = true;
      let digest: Buffer;
      try {
        digest = await deriveKey(supplied, salt);
      } finally {
        verifying = false;
      }
      if (!timingSafeEqual(expected, digest) || username !== "admin") return "denied";
      loginAttempts = 0;
      const previous = session(request);
      if (previous) sessions.delete(previous.id);
      for (const [id, active] of sessions) {
        if (active.expiresAt <= now) sessions.delete(id);
      }
      if (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value!);
      const next = { id: token(), csrf: token(), expiresAt: Date.now() + sessionSeconds * 1000 };
      sessions.set(next.id, next);
      setCookie(response, next.id, sessionSeconds);
      return "ok";
    },
    logout(response: ServerResponse, active: Session) {
      sessions.delete(active.id);
      setCookie(response, "", 0);
    },
  };
}
