import { pool } from "./db";
import {
  isBeautyV2FeatureName,
  type BeautyV2FeatureName,
  type BeautyV2FeatureSetting,
} from "@shared/business/v2-features";

const useMemoryStorage = process.env.USE_MEMORY_STORAGE === "true";
const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

const featureSettingsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("business_feature_settings")}`;
const memorySettings = new Map<string, BeautyV2FeatureSetting>();

function settingKey(featureName: BeautyV2FeatureName, locationId: number | null) {
  return `${featureName}:${locationId ?? "global"}`;
}

function mapRow(row: { feature_name: string; location_id: number | null; enabled: boolean }): BeautyV2FeatureSetting {
  if (!isBeautyV2FeatureName(row.feature_name)) {
    throw new Error(`Unsupported persisted Beauty v2 feature: ${row.feature_name}.`);
  }
  return {
    featureName: row.feature_name,
    locationId: row.location_id === null ? null : Number(row.location_id),
    enabled: Boolean(row.enabled),
  };
}

export async function listBeautyV2FeatureSettings(): Promise<BeautyV2FeatureSetting[]> {
  if (useMemoryStorage) return Array.from(memorySettings.values());
  const result = await pool.query(`
    SELECT feature_name, location_id, enabled
    FROM ${featureSettingsTable}
    ORDER BY feature_name, location_id NULLS FIRST
  `);
  return result.rows.map(mapRow);
}

export async function setBeautyV2FeatureSetting(input: BeautyV2FeatureSetting) {
  if (useMemoryStorage) {
    memorySettings.set(settingKey(input.featureName, input.locationId), { ...input });
    return { ...input };
  }

  const conflictTarget = input.locationId === null
    ? "(feature_name) WHERE location_id IS NULL"
    : "(feature_name, location_id) WHERE location_id IS NOT NULL";
  const result = await pool.query(`
    INSERT INTO ${featureSettingsTable} (feature_name, location_id, enabled)
    VALUES ($1, $2, $3)
    ON CONFLICT ${conflictTarget}
    DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
    RETURNING feature_name, location_id, enabled
  `, [input.featureName, input.locationId, input.enabled]);
  return mapRow(result.rows[0]);
}
