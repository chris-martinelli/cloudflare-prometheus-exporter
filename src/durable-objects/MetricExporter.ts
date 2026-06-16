import { DurableObject } from "cloudflare:workers";
import {
	getCloudflareMetricsClient,
	isAccountLevelQuery,
	isZoneLevelQuery,
} from "../cloudflare/client";
import { isPaidTierGraphQLQuery } from "../cloudflare/queries";
import { parseCommaSeparated, partitionZonesByTier } from "../lib/filters";
import { createLogger, type Logger } from "../lib/logger";
import type { MetricDefinition, MetricType } from "../lib/metrics";
import { getConfig, type ResolvedConfig } from "../lib/runtime-config";
import { metricKey } from "../lib/time";
import {
	MetricExporterIdSchema,
	type MetricExporterIdString,
	type TimeRange,
	type Zone,
} from "../lib/types";

const STATE_KEY = "state";

/**
 * Maximum allowed hostnames in HOST_METRICS_ALLOWLIST.
 * Limits GraphQL variable size and prevents cardinality explosion.
 */
const MAX_HOSTNAME_ALLOWLIST_SIZE = 50;

/**
 * Slim persistent state for the MetricExporter DO.
 *
 * Metric data (counters + gauges) is NOT kept here — it lives in dedicated
 * SQLite tables (see ensureTables) so no single stored value can exceed the
 * per-value storage limit (SQLITE_TOOBIG). Account fetch context
 * (zones/firewallRules) is also not persisted; the AccountMetricCoordinator
 * pushes it on every refresh cycle.
 */
type MetricExporterState = {
	// Core identity
	scopeType: "account" | "zone";
	scopeId: string;
	queryName: string;

	// Refresh state
	lastRefresh: number;
	lastError: string | null;

	// SSL cert cache (zone-scoped only)
	lastSslFetch: number;

	// Context for fetching (zone-scoped only; small)
	zoneMetadata: Zone | null;
};

/** Row shape for the counters table when read back for export. */
type SnapshotRow = {
	name: string;
	type: string;
	help: string;
	labels_json: string;
	value: number;
};

/**
 * Account-level fetch context, supplied by the coordinator on each refresh.
 * Not persisted — passed in per call so the stored state stays small.
 */
type AccountContext = {
	accountId: string;
	accountName: string;
	zones: Zone[];
	firewallRules: Record<string, string>;
};

/**
 * Durable Object that fetches and exports Prometheus metrics for a specific query scope.
 *
 * Storage model:
 * - `counters` SQLite table: one row per (name, labels) series, holding the
 *   monotonic accumulated total. Survives DO eviction and deploys.
 * - `gauges` SQLite table: current-window gauge values, rebuilt each refresh.
 * - `state` KV value: small identity + refresh metadata only.
 *
 * Account-scoped exporters are driven by the AccountMetricCoordinator (which
 * pushes zone context every cycle via refreshAccountScoped). Zone-scoped
 * exporters (SSL certs, LB weights) self-schedule via alarms.
 */
export class MetricExporter extends DurableObject<Env> {
	private state: MetricExporterState | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ensureTables();
			const stored = await ctx.storage.get<Record<string, unknown>>(STATE_KEY);
			if (stored === undefined) {
				return;
			}
			// Migrate pre-SQLite blobs (which embedded counters/metrics/zones/
			// firewallRules) to the slim shape. Legacy counter accumulators are
			// discarded — they cannot be reliably reconstructed from the composite
			// key strings, and a one-time counter reset at deploy is harmless to
			// rate()/increase(). This also drops the oversized value that caused
			// SQLITE_TOOBIG.
			if ("counters" in stored || "metrics" in stored) {
				await this.migrateLegacyState(stored);
			} else {
				this.state = stored as MetricExporterState;
			}
		});
	}

	/**
	 * Create the SQLite tables used for metric storage if they don't exist.
	 */
	private ensureTables(): void {
		const sql = this.ctx.storage.sql;
		sql.exec(
			`CREATE TABLE IF NOT EXISTS counters (
				metric_key TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				type TEXT NOT NULL,
				help TEXT NOT NULL,
				labels_json TEXT NOT NULL,
				accumulated REAL NOT NULL,
				last_seen INTEGER NOT NULL
			)`,
		);
		sql.exec(
			`CREATE INDEX IF NOT EXISTS idx_counters_last_seen ON counters(last_seen)`,
		);
		sql.exec(
			`CREATE TABLE IF NOT EXISTS gauges (
				name TEXT NOT NULL,
				type TEXT NOT NULL,
				help TEXT NOT NULL,
				labels_json TEXT NOT NULL,
				value REAL NOT NULL
			)`,
		);
	}

	/**
	 * Migrate a legacy (pre-SQLite) state blob to the slim shape and persist it,
	 * dropping the embedded counters/metrics/zones/firewallRules.
	 *
	 * @param legacy Raw legacy state object read from storage.
	 */
	private async migrateLegacyState(
		legacy: Record<string, unknown>,
	): Promise<void> {
		const scopeType = legacy.scopeType === "zone" ? "zone" : "account";
		this.state = {
			scopeType,
			scopeId: typeof legacy.scopeId === "string" ? legacy.scopeId : "",
			queryName: typeof legacy.queryName === "string" ? legacy.queryName : "",
			lastRefresh: 0,
			lastError: null,
			// Reset so zone-scoped exporters re-fetch SSL/LB data on the next
			// alarm — the gauges table starts empty after migration.
			lastSslFetch: 0,
			zoneMetadata: (legacy.zoneMetadata as Zone | null) ?? null,
		};
		await this.ctx.storage.put(STATE_KEY, this.state);
	}

	/**
	 * Create a logger instance with context from the exporter's state.
	 *
	 * @param config Resolved runtime configuration.
	 * @returns Logger instance with scope type, scope ID, and query name context.
	 */
	private createLogger(config: ResolvedConfig): Logger {
		const state = this.getState();
		return createLogger("metric_exporter", {
			format: config.logFormat,
			level: config.logLevel,
		})
			.child(state.scopeType)
			.child(state.scopeId)
			.child(state.queryName);
	}

	/**
	 * Get the current state or throw if not initialized.
	 *
	 * @returns Current state.
	 * @throws {Error} When state is undefined.
	 */
	private getState(): MetricExporterState {
		if (this.state === undefined) {
			console.error(
				"State not initialized - initialize() must be called first",
			);
			throw new Error("State not initialized");
		}
		return this.state;
	}

	/**
	 * Get or create a MetricExporter instance by ID, ensuring it's initialized.
	 *
	 * @param id Composite ID in format "scopeType:scopeId:queryName".
	 * @param env Worker environment bindings.
	 * @returns Initialized MetricExporter stub.
	 */
	static async get(id: MetricExporterIdString, env: Env) {
		const stub = env.MetricExporter.getByName(id);
		await stub.initialize(id);
		return stub;
	}

	/**
	 * Initialize the exporter state from a composite ID.
	 * Idempotent - skips if already initialized.
	 *
	 * @param id Composite ID string to parse into scope type, scope ID, and query name.
	 * @throws {ZodError} When ID format is invalid.
	 */
	async initialize(id: string): Promise<void> {
		if (this.state !== undefined) {
			return;
		}

		const parsed = MetricExporterIdSchema.parse(id);

		this.state = {
			scopeType: parsed.scopeType,
			scopeId: parsed.scopeId,
			queryName: parsed.queryName,
			lastRefresh: 0,
			lastError: null,
			lastSslFetch: 0,
			zoneMetadata: null,
		};

		await this.ctx.storage.put(STATE_KEY, this.state);
	}

	/**
	 * Refresh account-scoped metrics using context supplied by the coordinator.
	 *
	 * This is the sole driver for account-scoped exporters: the
	 * AccountMetricCoordinator calls it every refresh cycle with the current
	 * zone list and firewall rules. Nothing about the context is persisted.
	 *
	 * @param accountId Cloudflare account ID.
	 * @param accountName Account display name.
	 * @param zones List of zones in the account.
	 * @param firewallRules Map of firewall rule IDs to descriptions.
	 * @param timeRange Shared time range for metrics queries.
	 */
	async refreshAccountScoped(
		accountId: string,
		accountName: string,
		zones: Zone[],
		firewallRules: Record<string, string>,
		timeRange: TimeRange,
	): Promise<void> {
		const config = await getConfig(this.env);
		const logger = this.createLogger(config);
		const state = this.getState();

		if (state.scopeType !== "account") {
			logger.warn("refreshAccountScoped called on non-account exporter");
			return;
		}

		if (zones.length === 0) {
			logger.info("Skipping refresh - no zones in context");
			return;
		}

		const client = getCloudflareMetricsClient(this.env);

		try {
			const metrics = await this.fetchAccountScopedMetrics(
				client,
				{ accountId, accountName, zones, firewallRules },
				timeRange,
				config,
				logger,
			);

			const now = Date.now();
			this.applyMetrics(metrics, now, config.counterTtlSeconds);
			this.state = { ...state, lastRefresh: now, lastError: null };
			await this.ctx.storage.put(STATE_KEY, this.state);

			logger.info("Refresh complete", { metric_count: metrics.length });
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			logger.error("Refresh failed", { error: msg });
			this.state = { ...state, lastError: msg };
			await this.ctx.storage.put(STATE_KEY, this.state);
		}
	}

	/**
	 * Initialize zone-scoped exporter with zone metadata.
	 * Called by AccountMetricCoordinator when ensuring zone exporters exist.
	 * Triggers immediate fetch on first initialization, then self-schedules.
	 *
	 * @param zone Zone metadata including ID, name, and plan.
	 * @param accountId Cloudflare account ID that owns the zone.
	 * @param accountName Account display name.
	 * @param timeRange Shared time range (unused for zone-scoped REST queries).
	 */
	async initializeZone(
		zone: Zone,
		_accountId: string,
		_accountName: string,
		_timeRange: TimeRange,
	): Promise<void> {
		const config = await getConfig(this.env);
		const logger = this.createLogger(config);
		const state = this.getState();

		if (state.scopeType !== "zone") {
			logger.warn("initializeZone called on non-zone exporter");
			return;
		}

		const isFirstInit = state.zoneMetadata === null && state.lastRefresh === 0;

		this.state = { ...state, zoneMetadata: zone };
		await this.ctx.storage.put(STATE_KEY, this.state);

		logger.info("Zone metadata set", { zone: zone.name });

		// On first init, fetch immediately then schedule recurring alarm
		if (isFirstInit) {
			await this.refreshZoneScoped(config, logger);
		} else if ((await this.ctx.storage.getAlarm()) === null) {
			// Ensure the self-refresh loop stays alive (e.g. after a migration that
			// reset state) even though the coordinator re-initializes us each cycle.
			await this.scheduleNextAlarm(config);
		}
	}

	/**
	 * Durable Object alarm handler.
	 *
	 * Only zone-scoped exporters self-schedule alarms. Account-scoped exporters
	 * are coordinator-driven and never set an alarm; if a legacy alarm fires for
	 * one, it is ignored (and not rescheduled) so the loop dies out.
	 */
	override async alarm(): Promise<void> {
		const config = await getConfig(this.env);
		const logger = this.createLogger(config);
		const state = this.getState();

		if (state.scopeType !== "zone") {
			logger.debug("Ignoring alarm on coordinator-driven account exporter");
			return;
		}

		logger.info("Alarm fired, refreshing");
		await this.refreshZoneScoped(config, logger);
	}

	/**
	 * Refresh zone-scoped metrics (SSL certs / LB weights) and reschedule alarm.
	 *
	 * @param config Resolved runtime configuration.
	 * @param logger Logger instance.
	 */
	private async refreshZoneScoped(
		config: ResolvedConfig,
		logger: Logger,
	): Promise<void> {
		const state = this.getState();

		if (state.zoneMetadata === null) {
			logger.info("Skipping refresh - no zone metadata yet");
			await this.scheduleNextAlarm(config);
			return;
		}

		// SSL cert cache TTL check
		const cacheAgeMs = Date.now() - state.lastSslFetch;
		const cacheTtlMs = config.sslCertsCacheTtlSeconds * 1000;
		if (state.lastSslFetch > 0 && cacheAgeMs < cacheTtlMs) {
			logger.debug("SSL cert cache fresh, skipping fetch", {
				age_seconds: Math.floor(cacheAgeMs / 1000),
				ttl_seconds: config.sslCertsCacheTtlSeconds,
			});
			await this.scheduleNextAlarm(config);
			return;
		}

		const client = getCloudflareMetricsClient(this.env);

		try {
			const metrics = await this.fetchZoneScopedMetrics(
				client,
				state.zoneMetadata,
				state.queryName,
			);

			const now = Date.now();
			this.applyMetrics(metrics, now, config.counterTtlSeconds);
			this.state = {
				...state,
				lastRefresh: now,
				lastSslFetch: now,
				lastError: null,
			};
			await this.ctx.storage.put(STATE_KEY, this.state);

			logger.info("Refresh complete", { metric_count: metrics.length });
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			logger.error("Refresh failed", { error: msg });
			this.state = { ...state, lastError: msg };
			await this.ctx.storage.put(STATE_KEY, this.state);
		}

		await this.scheduleNextAlarm(config);
	}

	/**
	 * Apply a freshly-fetched metric set to SQLite storage.
	 *
	 * Counters are accumulated (Cloudflare returns window totals, so we sum into
	 * the running accumulated value per series) and stamped with `now`. Gauges
	 * are replaced wholesale. Optionally prunes counter series not seen within
	 * the configured TTL. All writes run in a single transaction so a failure
	 * leaves the previous snapshot intact.
	 *
	 * @param metrics Metrics from the Cloudflare API for this window.
	 * @param now Timestamp (ms) to stamp this refresh with.
	 * @param ttlSeconds Counter retention in seconds; 0 disables pruning.
	 */
	private applyMetrics(
		metrics: MetricDefinition[],
		now: number,
		ttlSeconds: number,
	): void {
		const sql = this.ctx.storage.sql;
		this.ctx.storage.transactionSync(() => {
			sql.exec("DELETE FROM gauges");

			for (const metric of metrics) {
				if (metric.type === "counter") {
					for (const v of metric.values) {
						const key = metricKey(metric.name, v.labels);
						sql.exec(
							`INSERT INTO counters
								(metric_key, name, type, help, labels_json, accumulated, last_seen)
							VALUES (?, ?, ?, ?, ?, ?, ?)
							ON CONFLICT(metric_key) DO UPDATE SET
								accumulated = accumulated + excluded.accumulated,
								last_seen = excluded.last_seen,
								help = excluded.help`,
							key,
							metric.name,
							metric.type,
							metric.help,
							JSON.stringify(v.labels),
							v.value,
							now,
						);
					}
				} else {
					for (const v of metric.values) {
						sql.exec(
							`INSERT INTO gauges (name, type, help, labels_json, value)
							VALUES (?, ?, ?, ?, ?)`,
							metric.name,
							metric.type,
							metric.help,
							JSON.stringify(v.labels),
							v.value,
						);
					}
				}
			}

			// Prune counter series idle longer than the TTL. Disabled when 0.
			// Series active within the TTL keep a continuous monotonic counter;
			// only those silent for longer reset if they ever return.
			if (ttlSeconds > 0) {
				sql.exec(
					"DELETE FROM counters WHERE last_seen < ?",
					now - ttlSeconds * 1000,
				);
			}
		});
	}

	/**
	 * Fetch account-scoped metrics from Cloudflare API.
	 * Handles both account-level and zone-batched queries.
	 *
	 * @param client Cloudflare metrics client.
	 * @param context Account fetch context (account id/name, zones, firewall rules).
	 * @param timeRange Time range for metrics queries.
	 * @param config Resolved runtime configuration.
	 * @param logger Logger instance.
	 * @returns Array of metric definitions.
	 */
	private async fetchAccountScopedMetrics(
		client: ReturnType<typeof getCloudflareMetricsClient>,
		context: AccountContext,
		timeRange: TimeRange,
		config: ResolvedConfig,
		logger: Logger,
	): Promise<MetricDefinition[]> {
		const { queryName } = this.getState();
		const { accountId, accountName, zones, firewallRules } = context;

		// Account-level queries (worker-totals, logpush-account, magic-transit)
		if (isAccountLevelQuery(queryName)) {
			return client.getAccountMetrics(
				queryName,
				accountId,
				accountName,
				timeRange,
			);
		}

		// Zone-batched queries - fetch all zones in one GraphQL call
		if (isZoneLevelQuery(queryName)) {
			// Hostname metrics guardrails: parse allowlist once for both guard + query
			let hostMetricsAllowlist: ReadonlySet<string> | undefined;
			let hostMetricsDelaySeconds: number | undefined;
			if (queryName === "hostname-http-metrics") {
				const parsed = parseCommaSeparated(config.hostMetricsAllowlist);
				// Normalize to lowercase per spec
				const normalized = new Set([...parsed].map((h) => h.toLowerCase()));
				if (normalized.size === 0) {
					logger.debug("Hostname metrics disabled: empty allowlist");
					return [];
				}
				if (normalized.size > MAX_HOSTNAME_ALLOWLIST_SIZE) {
					logger.error("Hostname allowlist exceeds maximum size", {
						size: normalized.size,
						max: MAX_HOSTNAME_ALLOWLIST_SIZE,
					});
					return [];
				}
				// excludeHost strips host labels from all metrics in prometheus.ts,
				// which would collapse distinct hostnames into duplicate gauge series
				// (max-dedup keeps only the highest value, losing per-host granularity).
				if (config.excludeHost) {
					logger.warn(
						"Hostname metrics disabled: excludeHost=true strips host labels",
					);
					return [];
				}
				hostMetricsAllowlist = normalized;
				hostMetricsDelaySeconds = config.hostMetricsDelaySeconds;
			}

			// Filter out free tier zones for paid-tier GraphQL queries
			let zonesToQuery = zones;
			if (isPaidTierGraphQLQuery(queryName)) {
				const { paid, free } = partitionZonesByTier(zones);

				if (free.length > 0) {
					logger.info("Skipping free tier zones for paid-tier query", {
						skipped_zones: free.map((z) => z.name),
						processing_zones: paid.length,
					});
				}

				zonesToQuery = paid;

				if (zonesToQuery.length === 0) {
					logger.info("No paid tier zones to query");
					return [];
				}
			}

			// Cloudflare GraphQL API limits queries to 10 zones (zonesHardLimit).
			// Chunk zones and merge results to support accounts with >10 zones.
			const ZONES_PER_CHUNK = 10;

			if (zonesToQuery.length <= ZONES_PER_CHUNK) {
				const zoneIds = zonesToQuery.map((z) => z.id);
				return client.getZoneMetrics(
					queryName,
					zoneIds,
					zonesToQuery,
					firewallRules,
					timeRange,
					hostMetricsAllowlist,
					hostMetricsDelaySeconds,
				);
			}

			const chunkResults: MetricDefinition[][] = [];
			for (let i = 0; i < zonesToQuery.length; i += ZONES_PER_CHUNK) {
				const chunkZones = zonesToQuery.slice(i, i + ZONES_PER_CHUNK);
				const chunkIds = chunkZones.map((z) => z.id);

				try {
					const metrics = await client.getZoneMetrics(
						queryName,
						chunkIds,
						chunkZones,
						firewallRules,
						timeRange,
						hostMetricsAllowlist,
						hostMetricsDelaySeconds,
					);
					chunkResults.push(metrics);
				} catch (error) {
					// Log and continue — partial results from other chunks are still valuable.
					// Missing zones don't increment their counters this cycle;
					// counters accumulate per (name, labels) key so existing
					// counter values are preserved. Next cycle retries all chunks.
					logger.error("Zone chunk query failed", {
						query: queryName,
						chunk_index: Math.floor(i / ZONES_PER_CHUNK),
						chunk_size: chunkZones.length,
						total_zones: zonesToQuery.length,
						failed_zones: chunkZones.map((z) => z.name),
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}

			return chunkResults.flat();
		}

		// Unknown query - should not happen if IDs are constructed correctly
		console.error("Unknown query type", { queryName });
		return [];
	}

	/**
	 * Fetch zone-scoped metrics from Cloudflare API.
	 * Handles SSL certificates and load balancer weight metrics.
	 *
	 * @param client Cloudflare metrics client.
	 * @param zoneMetadata Zone metadata for the query.
	 * @param queryName Query name to dispatch.
	 * @returns Array of metric definitions.
	 */
	private async fetchZoneScopedMetrics(
		client: ReturnType<typeof getCloudflareMetricsClient>,
		zoneMetadata: Zone,
		queryName: string,
	): Promise<MetricDefinition[]> {
		switch (queryName) {
			case "ssl-certificates":
				return client.getSSLCertificateMetricsForZone(zoneMetadata);
			case "lb-weight-metrics":
				return client.getLbWeightMetricsForZone(zoneMetadata);
			default:
				console.error("Unknown zone-scoped query", { queryName });
				return [];
		}
	}

	/**
	 * Schedule the next alarm with jitter for time range alignment.
	 *
	 * @param config Resolved runtime configuration.
	 */
	private async scheduleNextAlarm(config: ResolvedConfig): Promise<void> {
		const intervalMs = config.metricRefreshIntervalSeconds * 1000;

		// Get the start of the current minute interval
		const now = Date.now();
		const startOfInterval = Math.floor(now / intervalMs) * intervalMs;

		// Add the jitter (1-5s) to the NEXT interval start
		// This ensures we always fire at ":01-05" of every interval
		const jitter = 1000 + Math.random() * 4000;
		const nextAlarm = startOfInterval + intervalMs + jitter;

		await this.ctx.storage.setAlarm(nextAlarm);
	}

	/**
	 * Return the cached accumulated metrics for the most recent refresh window.
	 *
	 * Reconstructed from the SQLite tables: counter series seen in the latest
	 * refresh (with their accumulated totals) plus the current-window gauges.
	 * Counter series not seen in the latest window are intentionally omitted
	 * (their accumulators persist for when the series returns).
	 *
	 * @returns Current snapshot of metrics with accumulated counter values.
	 */
	async export(): Promise<MetricDefinition[]> {
		const state = this.getState();
		const sql = this.ctx.storage.sql;

		const counterRows = sql
			.exec<SnapshotRow>(
				`SELECT name, type, help, labels_json, accumulated AS value
				FROM counters WHERE last_seen = ?`,
				state.lastRefresh,
			)
			.toArray();
		const gaugeRows = sql
			.exec<SnapshotRow>(
				`SELECT name, type, help, labels_json, value FROM gauges`,
			)
			.toArray();

		const byName = new Map<string, MetricDefinition>();
		for (const row of [...counterRows, ...gaugeRows]) {
			const labels = JSON.parse(row.labels_json) as Record<string, string>;
			const existing = byName.get(row.name);
			if (existing) {
				existing.values.push({ labels, value: row.value });
			} else {
				byName.set(row.name, {
					name: row.name,
					type: row.type as MetricType,
					help: row.help,
					values: [{ labels, value: row.value }],
				});
			}
		}

		return [...byName.values()];
	}
}
