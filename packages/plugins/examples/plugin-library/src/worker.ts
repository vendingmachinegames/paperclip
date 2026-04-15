import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

/**
 * Library plugin has no server-side logic. The UI calls the host's
 * /api/companies/:id/library endpoint directly over same-origin fetch.
 */
const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("library plugin setup complete");
  },
  async onHealth() {
    return { status: "ok", message: "library plugin ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
