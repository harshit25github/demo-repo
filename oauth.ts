import NextAuth from "next-auth"
import AzureADProvider from "next-auth/providers/azure-ad"

export const authOptions = {
  providers: [
    AzureADProvider({
      clientId:    process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      tenantId:    process.env.AZURE_AD_TENANT_ID,
      authorization: { params: { scope: "openid profile email" } },
    }),
  ],
  pages: {
    signIn:  "/auth/login",
    error:   "/auth/error",   // optional
    signOut: "/auth/logout",  // optional
  },
  callbacks: {
    async session({ session, token }) {
      // make Azure AD sub available as `session.user.id`
      session.user.id = token.sub;
      return session;
    },
  },
}

export default NextAuth(authOptions)
