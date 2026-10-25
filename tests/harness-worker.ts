// Test-only entrypoint. Never referenced by production Wrangler configuration.
import control from "../apps/control-worker/src/index";
import { Coordinator } from "../apps/control-worker/src/coordinator";
export { PreviewAccess } from "../apps/control-worker/src/index";
export class TestCoordinator extends Coordinator {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/tick") {
      await this.alarm();
      return new Response("ok");
    }
    if (url.pathname === "/expire") {
      const id = url.searchParams.get("id");
      const row = this.ctx.storage.sql
        .exec<{ json: string }>(
          "SELECT json FROM records WHERE kind='preview' AND id=?",
          id,
        )
        .toArray()[0];
      if (!row) return new Response(null, { status: 404 });
      const p = JSON.parse(row.json);
      p.expiresAt = Date.now() - 1;
      this.ctx.storage.sql.exec(
        "UPDATE records SET json=?,expires=? WHERE kind='preview' AND id=?",
        JSON.stringify(p),
        p.expiresAt,
        id,
      );
      return new Response("expired");
    }
    return new Response(null, { status: 404 });
  }
}
export default {
  async fetch(request: Request, env: Parameters<typeof control.fetch>[1]) {
    const response = await control.fetch(request, env);
    if (new URL(request.url).pathname === "/api/settings" && response.ok) {
      const body = (await response.json()) as { data: Record<string, unknown> };
      body.data.localFixture = true;
      return Response.json(body);
    }
    return response;
  },
};
