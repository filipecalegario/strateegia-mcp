// Generated manually. The Worker has no bindings since the move to the stateless
// MCP handler (no Durable Object); its only configuration is the vars in wrangler.jsonc.
interface Env {
	/** Root of the Strateegia API, e.g. https://api.strateegia.digital (see wrangler.jsonc). */
	STRATEEGIA_API_URL: string;
}

// `import { env } from "cloudflare:workers"` is typed as Cloudflare.Env.
declare namespace Cloudflare {
	interface Env extends globalThis.Env {}
}
