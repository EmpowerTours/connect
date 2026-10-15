"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyReportDecision } from "@/lib/opportunities";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function revalidateAll(oppId: string) {
  revalidatePath("/admin");
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${oppId}`);
  revalidatePath("/");
}

/** Hide the reported post or dismiss the reports; either way all open reports on that post are closed. */
export async function adminDecideReportAction(fd: FormData) {
  const admin = await requireAdmin();
  const report = await prisma.report.findUniqueOrThrow({ where: { id: str(fd, "reportId") } });
  const decision = str(fd, "decision") === "hide" ? "hide" : "dismiss";
  const r = applyReportDecision(report.status, decision);
  if (!r.ok) return;
  // A decision covers every open report on the same post.
  const closeOpen = prisma.report.updateMany({
    where: { targetType: report.targetType, targetId: report.targetId, status: "open" },
    data: { status: r.status, decidedAt: new Date(), decidedBy: admin.walletAddress },
  });
  if (decision === "hide" && report.targetType === "opportunity") {
    await prisma.$transaction([prisma.opportunity.update({ where: { id: report.targetId }, data: { hidden: true } }), closeOpen]);
  } else {
    await closeOpen;
  }
  revalidateAll(report.targetId);
}

/** Admin hide/unhide straight from a post (no report needed). */
export async function adminSetOpportunityHiddenAction(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  const hidden = str(fd, "hidden") === "1";
  await prisma.opportunity.update({ where: { id }, data: { hidden } });
  revalidateAll(id);
}
