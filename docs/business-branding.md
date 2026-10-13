# Business branding precedence

Public branding is resolved after `/api/runtime-config` loads the active
Business Profile. The precedence is deliberately small and deterministic:

1. `DEMO_MODE=true` keeps the isolated Powerhouse demo identity.
2. Explicit `VITE_SHOP_*` values override deploy-specific name, short name,
   address and logo.
3. The active `Business Profile` supplies safe Barber or Beauty defaults,
   including hero copy, local hero/logo assets, accessibility text, opening
   status copy and professional-image fallback behaviour.
4. A configured location remains authoritative for its own name, address,
   map and optional logo on location-aware surfaces.

The server resolves `/manifest.webmanifest` from the same active profile. The
static HTML contains only neutral bootstrap metadata; after runtime config is
loaded, the document title, metadata, favicon and Apple touch icon use the
same resolved branding as the Home and setup screens.

`BUSINESS_THEME` is the canonical runtime theme. `VITE_BRAND_THEME` remains a
temporary explicit deployment override for backwards compatibility. Beauty
falls back to `beauty-clean`; Barber falls back to `classic-gold`.

`SHOP_NAME` remains the backend fallback used by communications and migration
configuration. `VITE_SHOP_NAME` is a build-time public override. New
deployments should set both to the same approved identity until business name
itself becomes part of a persisted installation configuration.

The generic Beauty profile never falls back to Baptista, Powerhouse, a Barber
hero, legacy professional avatars or remote Barber imagery.
