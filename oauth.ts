callbacks: {
  async signIn({ user, account }) {
    // If this is an Azure AD login, link or create a user in the database:
    if (account?.provider === "azure-ad") {
      const email = user.email!;
      let localUser = await getUser(email);
      if (!localUser) {
        // Create a new user in your DB for first-time Azure AD login (no password needed)
        localUser = await createUser({ email, name: user.name });
      }
      user.id = localUser.id;  // attach DB user ID to NextAuth user object
    }
    return true;
  },
  async jwt({ token, user }) {
    if (user) {
      token.uid = user.id;  // persist user ID (for Azure AD, this is set above)
    }
    return token;
  },
  async session({ session, token }) {
    if (token?.uid) {
      session.user.id = token.uid as string;
    }
    return session;
  }
}


---------
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
