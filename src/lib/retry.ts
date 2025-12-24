import type { Logger } from "./logger";

export type RetryOptions = {
	/** Maximum number of retries. Default: 3 */
	retries?: number;
	/** Initial delay in milliseconds. Default: 500 */
	initialDelay?: number;
	/** Maximum delay in milliseconds. Default: 30000 */
	maxDelay?: number;
	/** Backoff factor. Default: 2 */
	backoffFactor?: number;
	/** Logger instance for observability */
	logger?: Logger;
};

const DEFAULT_OPTIONS = {
	retries: 3,
	initialDelay: 500,
	maxDelay: 30000,
	backoffFactor: 2,
};

/**
 * Creates a fetch function that retries on 429/5xx errors and network failures.
 * Implements exponential backoff with respect for Retry-After headers.
 *
 * @param baseFetch The base fetch function to wrap.
 * @param options Retry configuration options.
 * @returns A fetch function with retry logic.
 */
export function createRetryFetch(
	baseFetch: typeof globalThis.fetch,
	options: RetryOptions = {},
): typeof globalThis.fetch {
	const config = { ...DEFAULT_OPTIONS, ...options };

	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		// Normalize request to ensure we can clone it for retries if needed
		// (though we try to preserve the original input form if possible to avoid overhead)
		
		let attempt = 0;
		let delay = config.initialDelay;

		while (true) {
			try {
				// If input is a Request object and has been used, we can't retry easily without cloning upfront.
				// However, fetch(req) usually consumes it.
				// Strategy: If input is a Request, clone it for the *attempt*.
				// If input is string/URL, just pass it.
				
				let attemptInput = input;
				if (input instanceof Request) {
					attemptInput = input.clone();
				}

				const response = await baseFetch(attemptInput, init);

				// Success or non-retriable error
				// Retry on 429 (Too Many Requests) and 5xx (Server Errors)
				if (
					response.status !== 429 &&
					!(response.status >= 500 && response.status < 600)
				) {
					return response;
				}

				// Stop if max retries reached
				if (attempt >= config.retries) {
					return response;
				}

				// Determine wait time
				let waitTime = delay;
				
				// Respect Retry-After header
				const retryAfter = response.headers.get("Retry-After");
				if (retryAfter) {
					const seconds = Number.parseInt(retryAfter, 10);
					if (!Number.isNaN(seconds)) {
						waitTime = seconds * 1000;
					}
				}

				if (config.logger) {
					config.logger.warn("Request failed, retrying", {
						status: response.status,
						attempt: attempt + 1,
						max_retries: config.retries,
						delay_ms: waitTime,
						url: input instanceof Request ? input.url : input.toString(),
					});
				}

				// Check for abort before waiting
				if (init?.signal?.aborted) {
					throw new DOMException("The operation was aborted", "AbortError");
				}

				await new Promise((resolve) => setTimeout(resolve, waitTime));

				attempt++;
				delay = Math.min(delay * config.backoffFactor, config.maxDelay);
			} catch (error) {
				// Network errors (fetch throws)
				if (attempt >= config.retries) {
					throw error;
				}

				if (config.logger) {
					config.logger.warn("Network request failed, retrying", {
						error: error instanceof Error ? error.message : String(error),
						attempt: attempt + 1,
						max_retries: config.retries,
						delay_ms: delay,
						url: input instanceof Request ? input.url : input.toString(),
					});
				}

				await new Promise((resolve) => setTimeout(resolve, delay));

				attempt++;
				delay = Math.min(delay * config.backoffFactor, config.maxDelay);
			}
		}
	};
}
