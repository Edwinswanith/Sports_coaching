import type { NextApiRequest, NextApiResponse } from "next";
import { createApp } from "../../../server/src/app";
import { connectMongo } from "../../../server/src/db/mongoose";

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
};

const app = createApp();
let mongoConnection: Promise<void> | null = null;

function ensureMongo(): Promise<void> {
  mongoConnection ??= connectMongo();
  return mongoConnection;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  await ensureMongo();
  app(req, res);
}
