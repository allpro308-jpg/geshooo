import { db, nowIso } from "@/db/database";
import { createId } from "@/shared/ids/id";

export function recordAudit(
  event: string,
  actorUserId: string | null,
  metadata: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, event, actor_user_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(createId("aud"), event, actorUserId, JSON.stringify(metadata), nowIso());
}
