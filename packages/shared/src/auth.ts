import { AppError, digest } from "./index";
const encoder = new TextEncoder();
export async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function equal(a: string, b: string) {
  const ah = await digest(a),
    bh = await digest(b);
  let diff = 0;
  for (let i = 0; i < ah.length; i++)
    diff |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
  return diff === 0;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, count, salt, expected] = encoded.split("$");
  const iterations = Number(count);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 600000 ||
    iterations > 2000000 ||
    !/^[a-f0-9]{32,64}$/.test(salt || "") ||
    !/^[a-f0-9]{64}$/.test(expected || "")
  )
    throw new AppError(
      "AUTH_NOT_CONFIGURED",
      "Configure a benchmarked admin password hash",
      503,
    );
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  const actual = Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return equal(actual, expected);
}
export function requireOrigin(request: Request, origin: string) {
  if (
    request.headers.get("Origin") !== origin ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw new AppError("CSRF_ORIGIN", "Same-origin request required", 403);
}
export async function verifySignature(
  request: Request,
  body: string,
  secret: string,
  now = Date.now(),
) {
  const time = request.headers.get("X-BYGA-Time") || "";
  const nonce = request.headers.get("X-BYGA-Nonce") || "";
  const sig = request.headers.get("X-BYGA-Signature") || "";
  if (
    !secret ||
    !/^\d{13}$/.test(time) ||
    Math.abs(now - Number(time)) > 300000 ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(sig) ||
    !(await equal(sig, await hmac(secret, `${time}.${nonce}.${body}`)))
  )
    throw new AppError("INVALID_SIGNATURE", "Callback signature invalid", 401);
  return nonce;
}
