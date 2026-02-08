import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const prisma = getPrisma();
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.budgetState.findUnique({ where: { userId } });
  return NextResponse.json({ data: row?.dataJson ?? null });
}

export async function POST(req: Request) {
  const prisma = getPrisma();
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { data?: unknown };
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return NextResponse.json({ error: "Missing body.data" }, { status: 400 });
  }

  await prisma.budgetState.upsert({
    where: { userId },
    update: { dataJson: body.data },
    create: { userId, dataJson: body.data },
  });

  return NextResponse.json({ ok: true });
}
