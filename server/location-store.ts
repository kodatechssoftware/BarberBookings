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
const barberLocationsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("barber_locations")}`;
const serviceLocationsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("service_locations")}`;

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
const memoryBarberLocations = new Map<number, Set<number>>();
const memoryInactiveBarberLocations = new Map<number, Set<number>>();
const memoryServiceLocations = new Map<number, Set<number>>();

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

export async function getLocation(id: number, includeInactive = false) {
  const locations = await listLocations(includeInactive);
  return locations.find((location) => location.id === id);
}

export async function getDefaultLocation() {
  const locations = await listLocations(true);
  return locations.find((location) => location.isDefault) ?? locations[0];
}

export async function getBarberIdsForLocation(locationId: number, includeInactive = false) {
  if (useMemoryStorage) {
    const assigned = memoryBarberLocations.get(locationId);
    return Array.from(new Set([
      ...Array.from(assigned ?? []),
      ...Array.from(includeInactive ? memoryInactiveBarberLocations.get(locationId) ?? [] : []),
    ]));
  }
  const result = await pool.query<{ barber_id: number }>(`
    SELECT barber_id FROM ${barberLocationsTable}
    WHERE location_id = $1 ${includeInactive ? "" : "AND is_active = true"}
    ORDER BY barber_id
  `, [locationId]);
  return result.rows.map((row) => Number(row.barber_id));
}

export async function getServiceIdsForLocation(locationId: number) {
  if (useMemoryStorage) {
    const assigned = memoryServiceLocations.get(locationId);
    return Array.from(assigned ?? []);
  }
  const result = await pool.query<{ service_id: number }>(`
    SELECT service_id FROM ${serviceLocationsTable}
    WHERE location_id = $1 AND is_active = true
    ORDER BY service_id
  `, [locationId]);
  return result.rows.map((row) => Number(row.service_id));
}

export async function getLocationIdsForBarber(barberId: number) {
  if (useMemoryStorage) {
    return Array.from(memoryBarberLocations.entries())
      .filter(([, barberIds]) => barberIds.has(barberId))
      .map(([locationId]) => locationId);
  }
  const result = await pool.query<{ location_id: number }>(`
    SELECT location_id FROM ${barberLocationsTable}
    WHERE barber_id = $1 AND is_active = true
    ORDER BY location_id
  `, [barberId]);
  return result.rows.map((row) => Number(row.location_id));
}

export async function getLocationIdsForService(serviceId: number) {
  if (useMemoryStorage) {
    return Array.from(memoryServiceLocations.entries())
      .filter(([, serviceIds]) => serviceIds.has(serviceId))
      .map(([locationId]) => locationId);
  }
  const result = await pool.query<{ location_id: number }>(`
    SELECT location_id FROM ${serviceLocationsTable}
    WHERE service_id = $1 AND is_active = true
    ORDER BY location_id
  `, [serviceId]);
  return result.rows.map((row) => Number(row.location_id));
}

export async function assignBarberToLocation(barberId: number, locationId: number) {
  if (useMemoryStorage) {
    const assigned = memoryBarberLocations.get(locationId) ?? new Set<number>();
    assigned.add(barberId);
    memoryBarberLocations.set(locationId, assigned);
    memoryInactiveBarberLocations.get(locationId)?.delete(barberId);
    return;
  }
  await pool.query(`
    INSERT INTO ${barberLocationsTable} (barber_id, location_id, is_active)
    VALUES ($1, $2, true)
    ON CONFLICT (barber_id, location_id) DO UPDATE SET is_active = true
  `, [barberId, locationId]);
}

export async function assignServiceToLocation(serviceId: number, locationId: number) {
  if (useMemoryStorage) {
    const assigned = memoryServiceLocations.get(locationId) ?? new Set<number>();
    assigned.add(serviceId);
    memoryServiceLocations.set(locationId, assigned);
    return;
  }
  await pool.query(`
    INSERT INTO ${serviceLocationsTable} (service_id, location_id, is_active)
    VALUES ($1, $2, true)
    ON CONFLICT (service_id, location_id) DO UPDATE SET is_active = true
  `, [serviceId, locationId]);
}

export async function removeBarberFromLocation(barberId: number, locationId: number) {
  if (useMemoryStorage) {
    memoryBarberLocations.get(locationId)?.delete(barberId);
    const inactive = memoryInactiveBarberLocations.get(locationId) ?? new Set<number>();
    inactive.add(barberId);
    memoryInactiveBarberLocations.set(locationId, inactive);
    return;
  }
  await pool.query(`
    UPDATE ${barberLocationsTable}
    SET is_active = false
    WHERE barber_id = $1 AND location_id = $2
  `, [barberId, locationId]);
}

export async function removeServiceFromLocation(serviceId: number, locationId: number) {
  if (useMemoryStorage) {
    memoryServiceLocations.get(locationId)?.delete(serviceId);
    return;
  }
  await pool.query(`
    UPDATE ${serviceLocationsTable}
    SET is_active = false
    WHERE service_id = $1 AND location_id = $2
  `, [serviceId, locationId]);
}

function chooseUniqueSlug(name: string, locations: Array<{ id: number; slug: string }>, existingId?: number) {
  const baseSlug = toSlug(name);
  const usedSlugs = new Set(
    locations.filter((location) => location.id !== existingId).map((location) => location.slug),
  );
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) suffix += 1;
  return `${baseSlug}-${suffix}`;
}

async function uniqueSlug(name: string, existingId?: number) {
  return chooseUniqueSlug(name, await listLocations(true), existingId);
}

export async function createLocation(input: LocationInput, maxLocations: number) {
  if (useMemoryStorage) {
    if (memoryLocations.length >= maxLocations) throw new Error("LOCATION_LIMIT_REACHED");
    const now = new Date();
    const created: ShopLocation = {
      id: Math.max(...memoryLocations.map((location) => location.id), 0) + 1,
      name: input.name,
      slug: chooseUniqueSlug(input.name, memoryLocations),
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
    // Use this transaction's connection: requesting another pool connection while
    // holding the lock can deadlock a small pool during concurrent creation.
    const existing = await client.query<{ id: number; slug: string }>(`SELECT id, slug FROM ${locationsTable}`);
    if (existing.rows.length >= maxLocations) throw new Error("LOCATION_LIMIT_REACHED");
    const slug = chooseUniqueSlug(input.name, existing.rows);
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
      existing.rows.length,
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
      slug: input.name ? chooseUniqueSlug(input.name, memoryLocations, id) : memoryLocations[index].slug,
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
