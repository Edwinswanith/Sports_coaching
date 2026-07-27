import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
};

type ExpressApp = import("express").Express;

let app: ExpressApp | null = null;
let mongoConnection: Promise<void> | null = null;

async function ensureApp(): Promise<ExpressApp> {
  if (app) return app;
  const { createApp } = await import("../../../server/src/app");
  app = createApp();
  return app;
}

async function ensureMongo(): Promise<void> {
  const { connectMongo } = await import("../../../server/src/db/mongoose");
  mongoConnection ??= connectMongo();
  return mongoConnection;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  let expressApp: ExpressApp;
  try {
    expressApp = await ensureApp();
    await ensureMongo();
  } catch (err) {
    console.error("[api] startup failed", err);
    res.status(500).json({ error: "api_startup_failed" });
    return;
  }
  expressApp(req, res);
}
