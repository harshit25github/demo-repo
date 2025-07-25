// pages/api/auth/redirect.ts  (or app/api/auth/redirect/route.ts)

import type { NextApiRequest, NextApiResponse } from "next";
import { ConfidentialClientApplication }  from "@azure/msal-node";
import { serialize } from "cookie";
import { jwtVerify } from "jose";
// ─ your DB helper; replace with your own
import { upsertUser } from "@/lib/db/users";  

const msalConfig = {
  auth: {
    clientId:     process.env.AZURE_AD_CLIENT_ID!,
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
    authority:    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`,
  }
};

const cca = new ConfidentialClientApplication(msalConfig);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { code } = req.query as { code?: string };
    if (!code) return res.status(400).send("Missing code");

    // 1️⃣ Exchange the code for tokens
    const tokenResponse = await cca.acquireTokenByCode({
      code,
      scopes:      ["openid", "profile", "email"],
      redirectUri: `${process.env.APP_URL}/api/auth/redirect`,
    });

    if (!tokenResponse?.idToken) {
      throw new Error("No ID token from Azure");
    }

    // 2️⃣ Verify & decode the ID token
    const { payload } = await jwtVerify(
      tokenResponse.idToken,
      Buffer.from(process.env.AZURE_AD_CLIENT_SECRET!, "utf8"),  // for prod, fetch keys from the JWKS endpoint
      {
        issuer:   `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
        audience: process.env.AZURE_AD_CLIENT_ID!,
      }
    );

    // 3️⃣ Upsert the user in your DB
    //    Extract the fields you care about:
    const { sub: azureId, email, name } = payload as any;
    await upsertUser({ azureId, email, name });

    // 4️⃣ Set a session cookie (just using the raw ID token here)
    const cookie = serialize("msal_session", tokenResponse.idToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/",
      maxAge:   tokenResponse.expiresIn,
    });
    res.setHeader("Set-Cookie", cookie);

    // 5️⃣ Redirect home
    res.redirect("/");
  } catch (err: any) {
    console.error("Auth redirect error:", err);
    res.status(500).send("Authentication error");
  }
}
------

// lib/msalClient.ts
import { PublicClientApplication } from "@azure/msal-browser";

export const msalConfig = {
  auth: {
    clientId:   process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!,
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID}`,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/redirect`,
  },
  cache: { cacheLocation: "sessionStorage" }
};

export const msalInstance = new PublicClientApplication(msalConfig);

----

"use client";

import { msalInstance } from "@/lib/msalClient";

export default function LoginButton() {
  return (
    <button onClick={() => {
      msalInstance.loginRedirect({
        scopes: ["openid","profile","email"],
      });
    }}>
      Sign in with Microsoft
    </button>
  );
}


---


// app/page.tsx (or app/dashboard/page.tsx)
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { redirect } from "next/navigation";

export default async function Home() {
  const cookieStore = cookies();
  const token = cookieStore.get("msal_session")?.value;
  if (!token) return redirect("/login");

  // Verify & decode (again) to get user info
  const { payload } = await jwtVerify(
    token,
    Buffer.from(process.env.AZURE_AD_CLIENT_SECRET!, "utf8"),
    {
      issuer:   `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      audience: process.env.AZURE_AD_CLIENT_ID!,
    }
  );

  return (
    <main>
      <h1>Welcome, {(payload as any).name}</h1>
      <p>Your email: {(payload as any).email}</p>
    </main>
  );
}

