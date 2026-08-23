// Test-account auth. Deliberately small: email + password, a signed token in a
// cookie, and a separate admin token gated by ADMIN_PASSWORD. There are no real
// customers on a preprod gateway, so anything more would be theatre.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { config, isProd } from "./config.js";
import { users } from "./db.js";
import { GatewayError } from "./errors.js";
import { newId } from "./ids.js";

const SESSION_DAYS = 7;
export const COOKIE_NAME = "wfit_gateway_session";

export interface Session {
  sub: string;      // user id, or "admin"
  role: "user" | "admin";
  email: string;
  exp: number;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

export function issueToken(session: Omit<Session, "exp">): string {
  const full: Session = { ...session, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined): Session | null {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: SESSION_DAYS * 86_400_000,
  });
}

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
  }
}

export function loadSession(req: Request, _res: Response, next: NextFunction): void {
  req.session = readToken(req.cookies?.[COOKIE_NAME]) ?? undefined;
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session) throw new GatewayError("Sign in to continue.", 401, "unauthenticated");
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.session?.role !== "admin") throw new GatewayError("Admin sign-in required.", 403, "forbidden");
  next();
}

export async function registerUser(email: string, password: string) {
  const normalised = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) throw new GatewayError("Enter a valid email address.", 400, "bad_email");
  if (password.length < 8) throw new GatewayError("Use a password of at least 8 characters.", 400, "weak_password");

  const user = {
    _id: newId(),
    email: normalised,
    passwordHash: hashPassword(password),
    isAdmin: false,
    createdAt: Date.now(),
  };
  try {
    await users().insertOne(user);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new GatewayError("That email is already registered.", 409, "email_taken");
    throw err;
  }
  return user;
}

export async function authenticate(email: string, password: string) {
  const user = await users().findOne({ email: email.trim().toLowerCase() });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new GatewayError("Email or password is incorrect.", 401, "bad_credentials");
  }
  return user;
}

export function authenticateAdmin(password: string): void {
  const expected = Buffer.from(config.adminPassword);
  const given = Buffer.from(password ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new GatewayError("Incorrect admin password.", 401, "bad_credentials");
  }
}
