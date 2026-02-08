import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const prisma = getPrisma();

    const row = await prisma.budgetState.findUnique({
      where: { userId },
    });

    return NextResponse.json({ data: row?.dataJson ?? null });
  } catch (err: any) {
    console.error("[GET /api/budget-state]", err);
    return NextResponse.json(
      { error: "Internal error", details: String(err?.message ?? err) },
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

    const body = await req.json();
    if (!body || typeof body !== "object" || !("data" in body)) {
      return NextResponse.json({ error: "Missing body.data" }, { status: 400 });
    }

    const prisma = getPrisma();

    await prisma.budgetState.upsert({
      where: { userId },
      update: { dataJson: body.data },
      create: { userId, dataJson: body.data },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[POST /api/budget-state]", err);
    return NextResponse.json(
      { error: "Internal error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
