import { FacilityReceiptSchema, verifyFacilityReceipt } from "@facility/core";
import { auditEvents, type FacilityDb, runs } from "@facility/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

export type ReceiptIntegrityReport = {
  ok: boolean;
  checked: number;
  invalidRunIds: string[];
  unauditedRunIds: string[];
  /** Audited run.finished digests whose run no longer carries a receipt —
   * the receipt was destroyed or the run row deleted after the fact. Every
   * terminal run writes its receipt and its audit event together, so this
   * can only be an anomaly; it is reported distinctly from "never audited"
   * so the two failure stories stay distinguishable. */
  missingReceiptRunIds: string[];
};

export async function verifyStoredReceipts(
  db: FacilityDb,
  orgId: string,
  runIds?: string[],
): Promise<ReceiptIntegrityReport> {
  if (runIds?.length === 0) {
    return {
      ok: true,
      checked: 0,
      invalidRunIds: [],
      unauditedRunIds: [],
      missingReceiptRunIds: [],
    };
  }
  const stored = await db
    .select({ id: runs.id, receipt: runs.receipt })
    .from(runs)
    .where(
      and(
        eq(runs.orgId, orgId),
        isNotNull(runs.receipt),
        ...(runIds ? [inArray(runs.id, runIds)] : []),
      ),
    );
  const audit = await db
    .select({ target: auditEvents.target, payload: auditEvents.payload })
    .from(auditEvents)
    .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.action, "run.finished")));
  const auditedDigests = new Map<string, string>();
  for (const event of audit) {
    const target = record(event.target);
    const payload = record(event.payload);
    if (typeof target.id === "string" && typeof payload.receipt_sha256 === "string") {
      auditedDigests.set(target.id, payload.receipt_sha256);
    }
  }
  const invalidRunIds: string[] = [];
  const unauditedRunIds: string[] = [];
  const storedIds = new Set(stored.map((row) => row.id));
  const scope = runIds ? new Set(runIds) : null;
  const missingReceiptRunIds = [...auditedDigests.keys()].filter(
    (id) => !storedIds.has(id) && (!scope || scope.has(id)),
  );
  for (const row of stored) {
    const parsed = FacilityReceiptSchema.safeParse(row.receipt);
    if (!parsed.success || !verifyFacilityReceipt(parsed.data)) {
      invalidRunIds.push(row.id);
      continue;
    }
    if (auditedDigests.get(row.id) !== parsed.data.integrity?.payload_sha256) {
      unauditedRunIds.push(row.id);
    }
  }
  return {
    ok:
      invalidRunIds.length === 0 &&
      unauditedRunIds.length === 0 &&
      missingReceiptRunIds.length === 0,
    checked: stored.length,
    invalidRunIds,
    unauditedRunIds,
    missingReceiptRunIds,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
