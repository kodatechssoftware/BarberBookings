/** One UPDATE per field, preserving the ordered, single-pass legacy repair.
 * Identifiers must already have passed db.ts's quoteIdentifier validation.
 * No schema objects/functions are created by this query.
 */
export function buildTextEncodingRepairQuery(
  table: string,
  column: string,
  repairs: readonly (readonly [string, string])[],
) {
  const values = repairs.flatMap(([from, to]) => [from, to]);
  const predicates = repairs.map((_, i) => `position($${2 * i + 1} in ${column}) > 0`);
  const steps = repairs.map((_, i) => {
    const previous = i === 0 ? "candidate" : `step${i}`;
    const from = `$${2 * i + 1}`, to = `$${2 * i + 2}`;
    // OFFSET 0 prevents flattening/re-evaluating the growing expression for
    // every later value/count. Each step consumes the previous step's value.
    return `CROSS JOIN LATERAL (
      SELECT replace(${previous}.value, ${from}, ${to}) AS value,
        ${previous}.hits + CASE WHEN position(${from} in ${previous}.value) > 0 THEN 1 ELSE 0 END AS hits
      OFFSET 0
    ) step${i + 1}`;
  });
  return {
    text: `WITH candidates AS MATERIALIZED (
      SELECT id, ${column} AS value, 0 AS hits
      FROM ${table}
      WHERE ${predicates.join(" OR ")}
      FOR NO KEY UPDATE
    ), repaired AS (
      UPDATE ${table} AS target
      SET ${column} = step${repairs.length}.value
      FROM candidates AS candidate
      ${steps.join("\n")}
      WHERE target.id = candidate.id
      RETURNING step${repairs.length}.hits
    ) SELECT COALESCE(sum(hits), 0)::text AS repaired_rows FROM repaired`,
    values,
  };
}
