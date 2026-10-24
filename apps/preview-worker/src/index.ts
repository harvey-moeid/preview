import {
  canonicalStaticPath,
  mimeTypes,
} from "../../../packages/build-manifest/src/index";

const headers = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Content-Security-Policy":
    "sandbox allow-scripts allow-forms allow-same-origin; object-src 'none'; base-uri 'self'; worker-src 'none'",
  "Clear-Site-Data": '"storage"',
};
export default {
  async fetch(request: Request, env: PreviewBindings): Promise<Response> {
    const deny = (status: number, message: string) =>
      new Response(message, { status, headers });
    if (!["GET", "HEAD"].includes(request.method))
      return deny(405, "Read-only preview");
    const url = new URL(request.url);
    if (url.origin === env.APP_ORIGIN)
      return deny(403, "Separate preview origin required");
    let id = "",
      path = "";
    if (env.PREVIEW_BASE_DOMAIN) {
      const suffix = "." + env.PREVIEW_BASE_DOMAIN;
      if (
        !url.hostname.endsWith(suffix) ||
        !/^p-[a-f0-9]{32}$/.test(url.hostname.slice(0, -suffix.length))
      )
        return deny(404, "Unknown preview host");
      id = url.hostname.slice(2, -suffix.length);
      path = url.pathname;
    } else {
      if (url.origin !== env.PREVIEW_ORIGIN)
        return deny(404, "Unknown preview origin");
      const match = url.pathname.match(/^\/p\/([a-f0-9]{32})(\/.*)?$/);
      if (!match) return deny(404, "Unknown preview");
      id = match[1];
      path = match[2] || "/";
      if (!match[2])
        return Response.redirect(url.origin + url.pathname + "/", 308);
    }
    // No public bucket, edge cache or cached access decision: every response checks the coordinator.
    let access: { prefix: string; spa: boolean; expiresAt: number | null };
    try {
      const r = await env.ACCESS.fetch(`https://access/${id}`);
      if (!r.ok) return deny(410, "Preview expired or deleted");
      access = await r.json();
    } catch {
      return deny(503, "Preview access temporarily unavailable");
    }
    try {
      path = decodeURIComponent(path).slice(1);
    } catch {
      return deny(400, "Invalid path");
    }
    if (!path || path.endsWith("/")) path += "index.html";
    if (!canonicalStaticPath(path)) return deny(400, "Invalid asset path");
    let object = await env.BUCKET.get(`${access.prefix}/${path}`);
    if (!object && access.spa && !path.split("/").pop()?.includes(".")) {
      path = "index.html";
      object = await env.BUCKET.get(`${access.prefix}/index.html`);
    }
    if (!object) return deny(404, "Asset not found");
    // A delete during R2 I/O must also prevent a newly returned response.
    const confirmed = await env.ACCESS.fetch(`https://access/${id}`);
    if (!confirmed.ok) return deny(410, "Preview expired or deleted");
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: {
        ...headers,
        "Content-Type":
          mimeTypes[path.split(".").pop()?.toLowerCase() || ""] ||
          "application/octet-stream",
        "Content-Length": String(object.size),
        "Content-Security-Policy": `${headers["Content-Security-Policy"]}; frame-ancestors ${env.APP_ORIGIN}`,
      },
    });
  },
} satisfies ExportedHandler<PreviewBindings>;
