import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// Ensure this route is always handled dynamically on the Node.js runtime.
// This avoids surprises with static rendering / caching in some deployments.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NEXTAUTH_URL must be the *base* URL (no /api/auth/...):
// - Local: http://localhost:3000
// - Prod:  https://budget-ai-ashy.vercel.app (or your custom domain)

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
