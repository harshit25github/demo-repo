// lib/getSession.ts

import { getServerSession } from "next-auth/next";
import { cookies }          from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { authOptions }      from "@/app/api/auth/[...nextauth]/route"; 
// adjust the import path to wherever your NextAuth handler lives

export interface Session {
  user: {
    id:    string;
    name:  string;
    email: string;
  };
  expires?: string;
}

/**
 * Try to load a NextAuth session first; if none, fall back to MSAL cookie.
 * Returns a session-like object or null.
 */
export async function getSession(): Promise<Session | null> {
  // 1️⃣ NextAuth credentials session
  const nextAuth = await getServerSession(authOptions);
  if (nextAuth) {
    return nextAuth as Session;
  }

  // 2️⃣ MSAL session cookie
  const token = cookies().get("msal_session")?.value;
  if (!token) {
    return null;
  }

  // 3️⃣ Verify MSAL ID token against Azure AD JWKS
  const issuer   = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`;
  const audience = process.env.AZURE_AD_CLIENT_ID!;
  const jwksUrl  = `${issuer}/discovery/v2.0/keys`;
  const JWKS     = createRemoteJWKSet(new URL(jwksUrl));

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience,
    });

    return {
      user: {
        id:    payload.sub as string,
        name:  payload.name as string,
        email: payload.preferred_username as string,
      },
      expires: "", // optional
    };
  } catch {
    return null;
  }
}

///
// lib/azureAuthConfig.ts
import { ConfidentialClientApplication } from "@azure/msal-node";

export const cca = new ConfidentialClientApplication({
  auth: {
    clientId:     process.env.AZURE_AD_CLIENT_ID!,
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
    authority:    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`, 
  },
});


----

  // app/(auth)/api/auth/login/microsoft-entra-id/route.ts
import { NextResponse } from "next/server";
import { cca } from "@/lib/azureAuthConfig";

export async function GET() {
  const authUrl = await cca.getAuthCodeUrl({
    scopes:      ["openid", "profile", "email"],
    redirectUri: `${process.env.APP_URL}/api/auth/callback/microsoft-entra-id`,
    prompt:      "select_account",
  });
  return NextResponse.redirect(authUrl);
}



---



  // app/(auth)/api/auth/callback/microsoft-entra-id/route.ts
import { NextResponse, NextRequest } from "next/server";
import { cca } from "@/lib/azureAuthConfig";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { upsertUser } from "@/lib/db/users";
import { serialize } from "cookie";

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const code   = url.searchParams.get("code");
  if (!code) return NextResponse.redirect("/login");

  // 1️⃣ Exchange the code for tokens
  const tokenRes = await cca.acquireTokenByCode({
    code,
    scopes:      ["openid", "profile", "email"],
    redirectUri: `${process.env.APP_URL}/api/auth/callback/microsoft-entra-id`,
  });
  const idToken = tokenRes.idToken!;
  
  // 2️⃣ Verify & decode the ID token using MS’s JWKS
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/discovery/v2.0/keys`)
  );
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer:   `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
    audience: process.env.AZURE_AD_CLIENT_ID!,
  });

  // 3️⃣ Upsert the user into your DB
  const { sub: azureId, name, preferred_username: email } = payload as any;
  await upsertUser({ azureId, email, name });

  // 4️⃣ Set an HTTP‑only cookie with the raw ID token
  const cookie = serialize("msal_session", idToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    path:     "/",
    maxAge:   tokenRes.expiresIn,
  });
  const res = NextResponse.redirect("/");
  res.headers.set("Set-Cookie", cookie);
  return res;
}


---


  "use client";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto mt-20 text-center">
      <h1 className="text-2xl mb-6">Sign in</h1>
      {/* — your existing credential form — */}

      <div className="mt-4">
        <Link
          href="/api/auth/login/microsoft-entra-id"
          className="px-4 py-2 border rounded hover:bg-gray-100"
        >
          Sign in with Microsoft
        </Link>
      </div>
    </div>
  );
}


----
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PUBLIC_PATHS = ["/login", "/register", "/guest", "/api/auth/guest"];
const JWKS = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/discovery/v2.0/keys`)
);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("msal_session")?.value;
  if (token) {
    try {
      await jwtVerify(token, JWKS, {
        issuer:   `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
        audience: process.env.AZURE_AD_CLIENT_ID!,
      });
      return NextResponse.next();
    } catch {
      // invalid or expired token
    }
  }

  // Not authenticated → redirect to login
  const loginUrl = new URL("/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next|static|favicon.ico).*)"],
};


----

  // lib/pkce.ts
import crypto from "crypto";

export function base64URLEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(Buffer.from(codeVerifier)));
  return { codeVerifier, codeChallenge };
}
---


  import { NextResponse } from "next/server";
import { cca } from "@/lib/azureAuthConfig";
import { generatePkcePair } from "@/lib/pkce";
import { serialize } from "cookie";

export async function GET() {
  // ① generate a fresh PKCE pair
  const { codeVerifier, codeChallenge } = generatePkcePair();

  // ② get the Azure AD authorize URL, including code_challenge
  const authUrl = await cca.getAuthCodeUrl({
    scopes:       ["openid", "profile", "email"],
    redirectUri:  `${process.env.APP_URL}/api/auth/callback/microsoft-entra-id`,
    responseMode: "form_post",             // still use form_post or query
    codeChallenge,                        // PKCE code challenge
    codeChallengeMethod: "S256",          // using SHA‑256
  });

  // ③ store the code_verifier in an HTTP‑only cookie for the callback
  const res = NextResponse.redirect(authUrl);
  res.headers.append(
    "Set-Cookie",
    serialize("msal_code_verifier", codeVerifier, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/",     // available on callback path
      maxAge:   300,     // 5 minutes is enough
    })
  );

  return res;
}

  
