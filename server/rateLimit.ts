// In-process rate limiting. One node, one gateway — a shared store would be
// pretending this is a cluster.

import type { NextFunction, Request, Response } from "express";
import { GatewayError } from "./errors.js";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(limit: number, windowMs: number) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = `${req.path}:${req.session?.sub ?? req.ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (++bucket.count > limit) {
      throw new GatewayError("Too many requests — slow down for a moment.", 429, "rate_limited");
    }
    next();
  };
}

// Keep the map from growing without bound on a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}, 60_000).unref();
