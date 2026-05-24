import { Router } from "express";

import { requireAuth } from "@/modules/auth/auth-middleware";
import { getPersonalGroupId, listMyGroups } from "@/modules/groups/group-service";

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get("/groups", (req, res) => {
  getPersonalGroupId(req.user!.id);
  res.json({ groups: listMyGroups(req.user!.id) });
});
