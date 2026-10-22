/** Opt-in gateway; body logging, caching and SDK retries are disabled for private proofreading. */
export function gatewayOptions(value: string | undefined) {
  if (!value) return {};
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "gateway.ai.cloudflare.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/v1\/[^/]+\/[^/]+\/anthropic\/?$/.test(url.pathname)
  ) {
    throw new Error("AI_GATEWAY_URL must be the HTTPS Cloudflare Anthropic gateway endpoint");
  }
  return {
    baseURL: value.replace(/\/$/, ""),
    defaultHeaders: { "cf-aig-collect-log": "false", "cf-aig-skip-cache": "true" },
  };
}
