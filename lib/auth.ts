import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * Central place for NextAuth configuration.
 *
 * IMPORTANT: Do NOT export `authOptions` from a route handler file
 * (e.g. app/api/auth/[...nextauth]/route.ts). Next.js expects route modules
 * to only export HTTP method handlers (GET/POST/...) and a small set of
 * special route options.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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
