import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Throw a clear error so Vercel logs make the fix obvious.
    throw new Error(
      `[auth] Missing environment variable: ${name}. ` +
        `Set it in your deployment environment (e.g. Vercel → Project → Settings → Environment Variables).`
    );
  }
  return value;
}

/**
 * Central place for NextAuth configuration.
 *
 * IMPORTANT: Do NOT export `authOptions` from a route handler file
 * (e.g. app/api/auth/[...nextauth]/route.ts). Next.js expects route modules
 * to only export HTTP method handlers (GET/POST/...) and a small set of
 * special route options.
 */
export const authOptions: NextAuthOptions = {
  // Required for JWT/session signing in production.
  // (NextAuth will warn/error if it's missing.)
  secret: process.env.NEXTAUTH_SECRET,

  providers: [
    GoogleProvider({
      clientId: requiredEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    async jwt({ token }) {
      // Simple stable user id (good enough to start): email
      if (token?.email) (token as any).uid = token.email;
      return token;
    },
    async session({ session, token }) {
      (session.user as any).id = (token as any).uid ?? token.sub ?? token.email;
      return session;
    },
  },
};
