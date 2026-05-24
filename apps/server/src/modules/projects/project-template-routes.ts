import { Router } from "express";

import { requireAuth } from "@/modules/auth/auth-middleware";

import { projectTemplates } from "./project-templates";

export const projectTemplateRouter = Router();

projectTemplateRouter.use(requireAuth);

projectTemplateRouter.get("/", (_req, res) => {
  res.json({ templates: projectTemplates });
});
