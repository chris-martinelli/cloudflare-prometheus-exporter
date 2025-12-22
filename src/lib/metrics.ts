import z from "zod";

/**
 * Prometheus metric type discriminator.
 */
export type MetricType = z.infer<typeof MetricTypeSchema>;

/**
 * Zod schema validating Prometheus metric types (counter or gauge).
 */
export const MetricTypeSchema = z.union([
	z.literal("counter"),
	z.literal("gauge"),
]);

/**
 * Single metric observation with labels and numeric value.
 */
export type MetricValue = z.infer<typeof MetricValueSchema>;

/**
 * Zod schema validating metric observations with label key-value pairs and numeric values.
 */
export const MetricValueSchema = z.object({
	labels: z.record(z.string(), z.string()),
	value: z.number(),
});

/**
 * Complete metric definition with metadata and observations for Prometheus export.
 */
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;

/**
 * Zod schema validating complete metric definitions including name, help text, type, and observations.
 */
export const MetricDefinitionSchema = z.object({
	name: z.string(),
	help: z.string(),
	type: MetricTypeSchema,
	values: z.array(MetricValueSchema),
});
