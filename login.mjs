import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const SESSION_COOKIE = "expert_trader_session";
const USER_STORE = "expert-trader-users";
const SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 hours

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function getCookieOptions(maxAge) {
  return [
    `${SESSION_COOKIE}=`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

function createSession(username) {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is not configured.");
  }

  const expires = Date.now() + SESSION_DURATION;

  const encodedUsername = encodeURIComponent(username);

  const payload = `${encodedUsername}.${expires}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) {
    return false;
  }

  const parts = String(storedHash).split(":");

  if (parts.length !== 3) {
    return false;
  }

  const [algorithm, salt, storedHex] = parts;

  if (algorithm !== "scrypt") {
    return false;
  }

  try {
    const storedBuffer = Buffer.from(storedHex, "hex");

    const derivedBuffer = crypto.scryptSync(
      password,
      salt,
      storedBuffer.length,
      {
        N: 16384,
        r: 8,
        p: 1
      }
    );

    if (storedBuffer.length !== derivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      storedBuffer,
      derivedBuffer
    );
  } catch (error) {
    console.error("Password verification error:", error);
    return false;
  }
}

async function getCreatedUser(username) {
  const store = getStore(USER_STORE);

  return await store.get(
    `user:${username}`,
    {
      type: "json"
    }
  );
}

async function getLegacyUser(username) {
  const raw = process.env.USERS_JSON;

  if (!raw) {
    return null;
  }

  try {
    const users = JSON.parse(raw);

    if (Array.isArray(users)) {
      const user = users.find(
        item =>
          String(item.username || "")
            .trim()
            .toLowerCase() === username
      );

      return user || null;
    }

    if (users && typeof users === "object") {
      const user = users[username];

      if (!user) {
        return null;
      }

      if (typeof user === "string") {
        return {
          username,
          passwordHash: user,
          active: true
        };
      }

      return user;
    }

    return null;
  } catch (error) {
    console.error("USERS_JSON parsing error:", error);
    return null;
  }
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json(
      {
        success: false,
        error: "Method not allowed."
      },
      405
    );
  }

  try {
    const body = await request.json();

    const username = String(
      body.username || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      body.password || ""
    );

    if (!username || !password) {
      return json(
        {
          success: false,
          error: "Username and password are required."
        },
        400
      );
    }

    let passwordHash = null;
    let accountActive = true;

    /*
     * 1. Check the administrator account.
     */
    const adminUsername = String(
      process.env.ADMIN_USERNAME || ""
    )
      .trim()
      .toLowerCase();

    if (
      adminUsername &&
      username === adminUsername
    ) {
      passwordHash =
        process.env.ADMIN_PASSWORD_HASH;

      accountActive = true;
    }

    /*
     * 2. Check users created from the admin panel.
     */
    if (!passwordHash) {
      const storedUser =
        await getCreatedUser(username);

      if (storedUser) {
        passwordHash =
          storedUser.passwordHash;

        accountActive =
          storedUser.active !== false;
      }
    }

    /*
     * 3. Optional backwards compatibility
     * with your old USERS_JSON accounts.
     */
    if (!passwordHash) {
      const legacyUser =
        await getLegacyUser(username);

      if (legacyUser) {
        passwordHash =
          legacyUser.passwordHash ||
          legacyUser.password_hash;

        accountActive =
          legacyUser.active !== false;
      }
    }

    /*
     * Never reveal whether the username exists.
     */
    if (!passwordHash || !accountActive) {
      return json(
        {
          success: false,
          error: "Invalid username or password."
        },
        401
      );
    }

    const passwordCorrect =
      verifyPassword(
        password,
        passwordHash
      );

    if (!passwordCorrect) {
      return json(
        {
          success: false,
          error: "Invalid username or password."
        },
        401
      );
    }

    const session =
      createSession(username);

    const response = json({
      success: true,
      authenticated: true,
      username
    });

    response.headers.set(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(session)}; Max-Age=${Math.floor(
        SESSION_DURATION / 1000
      )}; Path=/; HttpOnly; Secure; SameSite=Lax`
    );

    return response;

  } catch (error) {
    console.error("Login error:", error);

    return json(
      {
        success: false,
        error: "Unable to process login."
      },
      500
    );
  }
}
