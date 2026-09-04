import { pool } from "./db";
import type { LocationInput, LocationUpdate, ShopLocation } from "@shared/locations";

const useMemoryStorage = process.env.USE_MEMORY_STORAGE === "true";
const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

const locationsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("locations")}`;

function toSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "localizacao";
}

function mapLocation(row: any): ShopLocation {
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    address: row.address,
    mapUrl: row.map_url ?? null,
    mapEmbedUrl: row.map_embed_url ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    timezone: row.timezone,
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let memoryLocations: ShopLocation[] = [{
  id: 1,
  name: process.env.SHOP_NAME?.trim() || "Barbearia",
  slug: "principal",
  address: process.env.SHOP_ADDRESS?.trim() || "Morada principal",
  mapUrl: process.env.SHOP_MAP_URL?.trim() || process.env.VITE_SHOP_MAP_URL?.trim() || null,
  mapEmbedUrl: process.env.SHOP_MAP_EMBED_URL?.trim() || process.env.VITE_SHOP_MAP_EMBED_URL?.trim() || null,
  phone: null,
  email: null,
  timezone: process.env.SHOP_TIME_ZONE?.trim() || "Europe/Lisbon",
  isActive: true,
  isDefault: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}];

export async function listLocations(includeInactive = false) {
  if (useMemoryStorage) {
    return memoryLocations
      .filter((location) => includeInactive || location.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  const result = await pool.query(`
    SELECT * FROM ${locationsTable}
    ${includeInactive ? "" : "WHERE is_active = true"}
    ORDER BY is_default DESC, sort_order ASC, id ASC
  `);
  return result.rows.map(mapLocation);
}

async function uniqueSlug(name: string, existingId?: number) {
  const baseSlug = toSlug(name);
  const locations = await listLocations(true);
  const usedSlugs = new Set(
    locations.filter((location) => location.id !== existingId).map((location) => location.slug),
  );
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) suffix += 1;
  return `${baseSlug}-${suffix}`;
}

export async function createLocation(input: LocationInput, maxLocations: number) {
  if (useMemoryStorage) {
    if (memoryLocations.length >= maxLocations) throw new Error("LOCATION_LIMIT_REACHED");
    const now = new Date();
    const created: ShopLocation = {
      id: Math.max(...memoryLocations.map((location) => location.id), 0) + 1,
      name: input.name,
      slug: await uniqueSlug(input.name),
      address: input.address,
      mapUrl: input.mapUrl || null,
      mapEmbedUrl: input.mapEmbedUrl || null,
      phone: input.phone || null,
      email: input.email || null,
      timezone: input.timezone,
      isActive: false,
      isDefault: false,
      sortOrder: memoryLocations.length,
      createdAt: now,
      updatedAt: now,
    };
    memoryLocations.push(created);
    return created;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(424242, 1101)");
    const count = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${locationsTable}`);
    if (count.rows[0].count >= maxLocations) throw new Error("LOCATION_LIMIT_REACHED");
    const slug = await uniqueSlug(input.name);
    const inserted = await client.query(`
      INSERT INTO ${locationsTable} (
        name, slug, address, map_url, map_embed_url, phone, email, timezone,
        is_active, is_default, sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false, $9)
      RETURNING *
    `, [
      input.name,
      slug,
      input.address,
      input.mapUrl || null,
      input.mapEmbedUrl || null,
      input.phone || null,
      input.email || null,
      input.timezone,
      count.rows[0].count,
    ]);
    await client.query("COMMIT");
    return mapLocation(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateLocation(id: number, input: LocationUpdate) {
  if (useMemoryStorage) {
    const index = memoryLocations.findIndex((location) => location.id === id);
    if (index < 0) return undefined;
    if (memoryLocations[index].isDefault && input.isActive === false) {
      throw new Error("DEFAULT_LOCATION_CANNOT_BE_DEACTIVATED");
    }
    memoryLocations[index] = {
      ...memoryLocations[index],
      ...input,
      slug: input.name ? await uniqueSlug(input.name, id) : memoryLocations[index].slug,
      mapUrl: input.mapUrl === undefined ? memoryLocations[index].mapUrl : input.mapUrl || null,
      mapEmbedUrl: input.mapEmbedUrl === undefined ? memoryLocations[index].mapEmbedUrl : input.mapEmbedUrl || null,
      phone: input.phone === undefined ? memoryLocations[index].phone : input.phone || null,
      email: input.email === undefined ? memoryLocations[index].email : input.email || null,
      updatedAt: new Date(),
    };
    return memoryLocations[index];
  }

  const currentResult = await pool.query(`SELECT * FROM ${locationsTable} WHERE id = $1`, [id]);
  if (!currentResult.rowCount) return undefined;
  const current = mapLocation(currentResult.rows[0]);
  if (current.isDefault && input.isActive === false) {
    throw new Error("DEFAULT_LOCATION_CANNOT_BE_DEACTIVATED");
  }
  const slug = input.name ? await uniqueSlug(input.name, id) : current.slug;
  const updated = await pool.query(`
    UPDATE ${locationsTable}
    SET
      name = $2,
      slug = $3,
      address = $4,
      map_url = $5,
      map_embed_url = $6,
      phone = $7,
      email = $8,
      timezone = $9,
      is_active = $10,
      updated_at = now()
    WHERE id = $1
    RETURNING *
  `, [
    id,
    input.name ?? current.name,
    slug,
    input.address ?? current.address,
    input.mapUrl === undefined ? current.mapUrl : input.mapUrl || null,
    input.mapEmbedUrl === undefined ? current.mapEmbedUrl : input.mapEmbedUrl || null,
    input.phone === undefined ? current.phone : input.phone || null,
    input.email === undefined ? current.email : input.email || null,
    input.timezone ?? current.timezone,
    input.isActive ?? current.isActive,
  ]);
  return mapLocation(updated.rows[0]);
}

