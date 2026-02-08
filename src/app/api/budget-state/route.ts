import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Purge soft-deleted objects older than this TTL when saving a snapshot.
// Keeps deletions around long enough for other devices to sync.
const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

function purgeDeleted(value: any, purgeBefore: number): any {
  if (Array.isArray(value)) {
    return value
      .filter((x) => {
        // Permanently remove objects that were soft-deleted long ago
        if (x && typeof x === "object" && (x as any)._deleted === true) {
          const deletedAt = (x as any).deletedAt;
          if (typeof deletedAt === "number" && deletedAt < purgeBefore) return false;
        }
        return true;
      })
      .map((x) => purgeDeleted(x, purgeBefore));
  }

  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = purgeDeleted(v, purgeBefore);
    return out;
  }

  return value;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const prisma = getPrisma();
    const row = await prisma.budgetState.findUnique({ where: { userId } });

    return NextResponse.json({ data: row?.dataJson ?? null });
  } catch (err: any) {
    console.error("[GET /api/budget-state]", err);
    return NextResponse.json(
      { error: "Internal error", name: err?.name, message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { data?: unknown };

    if (!body || typeof body !== "object" || !("data" in body)) {
      return NextResponse.json({ error: "Missing body.data" }, { status: 400 });
    }

    const purgeBefore = Date.now() - TTL_MS;
    const cleanedData = purgeDeleted((body as any).data, purgeBefore);

    const prisma = getPrisma();
    await prisma.budgetState.upsert({
      where: { userId },
      update: { dataJson: cleanedData },
      create: { userId, dataJson: cleanedData },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[POST /api/budget-state]", err);
    return NextResponse.json(
      {
        error: "Internal error",
        name: err?.name,
        message: err?.message ?? String(err),
        code: err?.code,
        meta: err?.meta,
      },
      { status: 500 }
    );
  }
}
