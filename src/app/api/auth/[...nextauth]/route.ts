import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// On Vercel, NEXTAUTH_URL is often forgotten. NextAuth uses it to build
// OAuth callback URLs. Fall back to the Vercel-provided host if needed.
// Note: VERCEL_URL does not include protocol.
if (!process.env.NEXTAUTH_URL && process.env.VERCEL_URL) {
  process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL}`;
}

// Ensure this route is always handled dynamically on the Node.js runtime.
// This avoids surprises with static rendering / caching in some deployments.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NEXTAUTH_URL must be the *base* URL (no /api/auth/...):
// - Local: http://localhost:3000
// - Prod:  https://budget-ai-ashy.vercel.app (or your custom domain)

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
