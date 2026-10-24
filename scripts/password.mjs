import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
let silent = false;
const sink = new Writable({
  write(chunk, _encoding, next) {
    if (!silent) process.stdout.write(chunk);
    next();
  },
});
const input = createInterface({
  input: process.stdin,
  output: sink,
  terminal: true,
});
process.stdout.write("New admin password (hidden): ");
silent = true;
const password = await input.question("");
silent = false;
input.close();
if (password.length < 16)
  throw new Error("Use a unique password of at least 16 characters");
const salt = randomBytes(16).toString("hex");
const start = performance.now();
const hash = pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("hex");
console.log(
  `\nADMIN_PASSWORD_HASH (store as Worker secret):\npbkdf2-sha256$600000$${salt}$${hash}`,
);
console.log(
  `Local KDF wall time: ${(performance.now() - start).toFixed(1)}ms. Benchmark Worker CPU before setting AUTH_CPU_VERIFIED=true.`,
);
