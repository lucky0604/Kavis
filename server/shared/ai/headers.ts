/**
 * Browser-mimicking headers for upstream LLM API requests.
 *
 * Some corporate AI gateways (e.g. ipsapro.isoftstone.com/thor/v1) inspect the
 * User-Agent and other browser-fingerprint headers and silently sever the TCP
 * connection mid-stream when they detect a non-browser client. The OpenAI SDK's
 * default User-Agent (`OpenAI/JS x.y.z`) is one of those tells, which surfaces
 * to users as `ERR_STREAM_PREMATURE_CLOSE` from node:http — wrapped by
 * `UpstreamStreamError` as "Upstream stream broken: Premature close ...".
 *
 * Inject these headers via `defaultHeaders` on the OpenAI client (or directly
 * on `fetch()` for non-SDK probes) so the gateway sees a normal browser.
 */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/event-stream, application/json, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};
