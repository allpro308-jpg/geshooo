import { Router } from "express";

import { requireAuth } from "@/modules/auth/auth-middleware";

import { serviceTemplates } from "./service-templates";

export const serviceTemplateRouter = Router();

serviceTemplateRouter.use(requireAuth);

serviceTemplateRouter.get("/", (_req, res) => {
  res.json({ templates: serviceTemplates });
});
