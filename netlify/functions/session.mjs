import crypto from "node:crypto";

const SESSION_COOKIE = "expert_trader_session";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function getCookie(request, name) {
  const cookieHeader =
    request.headers.get("cookie") || "";

  const cookies =
    cookieHeader.split(";");

  for (const cookie of cookies) {
    const separator =
      cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key =
      cookie.slice(0, separator).trim();

    const value =
      cookie.slice(separator + 1).trim();

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return null;
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  if (first.length !== second.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    first,
    second
  );
}

function verifySession(token) {
  if (!token) {
    return null;
  }

  const secret =
    process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not configured."
    );
  }

  const parts =
    token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [
    encodedUsername,
    expiresString,
    signature
  ] = parts;

  const expires =
    Number(expiresString);

  if (!Number.isFinite(expires)) {
    return null;
  }

  if (expires <= Date.now()) {
    return null;
  }

  const payload =
    `${encodedUsername}.${expiresString}`;

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(payload)
      .digest("base64url");

  if (
    !safeEqual(
      signature,
      expectedSignature
    )
  ) {
    return null;
  }

  let username;

  try {
    username =
      decodeURIComponent(
        encodedUsername
      );
  } catch {
    return null;
  }

  if (!username) {
    return null;
  }

  return {
    username,
    expires
  };
}

export default async function handler(request) {
  try {
    if (request.method !== "GET") {
      return json(
        {
          authenticated: false,
          error: "Method not allowed."
        },
        405
      );
    }

    const token =
      getCookie(
        request,
        SESSION_COOKIE
      );

    const session =
      verifySession(token);

    if (!session) {
      return json({
        authenticated: false
      });
    }

    return json({
      authenticated: true,
      username: session.username,
      expires: session.expires
    });

  } catch (error) {
    console.error(
      "Session verification error:",
      error
    );

    return json({
      authenticated: false
    });
  }
      }
