import { expect, test } from "@playwright/test";
import { resolveLocationMapLinks } from "../../shared/location-maps";
import { locationInputSchema, locationUpdateSchema } from "../../shared/locations";

const address = "Praça do Comércio, n.º 4 & 6, 1100-148 Lisboa #entrada + sul";
const encodedAddress = encodeURIComponent(address);
const automaticMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
const automaticEmbedUrl = `https://www.google.com/maps?q=${encodedAddress}&output=embed`;

test.describe("mapas automáticos das localizações", () => {
  test("gera as duas ligações apenas com a morada, incluindo acentos e caracteres reservados", () => {
    const links = resolveLocationMapLinks({ address });

    expect(links).toEqual({ mapUrl: automaticMapUrl, mapEmbedUrl: automaticEmbedUrl });
    expect(new URL(links.mapUrl).searchParams.get("query")).toBe(address);
    expect(new URL(links.mapEmbedUrl).searchParams.get("q")).toBe(address);
    expect(new URL(links.mapEmbedUrl).searchParams.get("output")).toBe("embed");
    expect(new URL(links.mapUrl).hash).toBe("");
    expect(new URL(links.mapEmbedUrl).hash).toBe("");
  });

  test("ignora espaços exteriores e ligações opcionais em branco", () => {
    expect(resolveLocationMapLinks({ address: `  ${address}  `, mapUrl: " \t", mapEmbedUrl: "\n " }))
      .toEqual({ mapUrl: automaticMapUrl, mapEmbedUrl: automaticEmbedUrl });
  });

  test("aceita ligações nulas guardadas na base de dados", () => {
    expect(resolveLocationMapLinks({ address, mapUrl: null, mapEmbedUrl: null }))
      .toEqual({ mapUrl: automaticMapUrl, mapEmbedUrl: automaticEmbedUrl });
  });

  test("não gera mapas sem uma morada", () => {
    expect(resolveLocationMapLinks({ address: "" })).toEqual({ mapUrl: "", mapEmbedUrl: "" });
    expect(resolveLocationMapLinks({ address: " \n\t " })).toEqual({ mapUrl: "", mapEmbedUrl: "" });
  });

  test("preserva ambas as ligações personalizadas sem as substituir pela morada", () => {
    const mapUrl = "https://maps.app.goo.gl/exemplo";
    const mapEmbedUrl = "https://www.google.com/maps/embed?pb=exemplo";
    expect(resolveLocationMapLinks({ address, mapUrl: ` ${mapUrl} `, mapEmbedUrl: ` ${mapEmbedUrl} ` }))
      .toEqual({ mapUrl, mapEmbedUrl });
  });

  test("um link personalizado de abertura não impede o mapa incorporado automático", () => {
    const mapUrl = "https://maps.app.goo.gl/exemplo";
    expect(resolveLocationMapLinks({ address, mapUrl }))
      .toEqual({ mapUrl, mapEmbedUrl: automaticEmbedUrl });
  });

  test("um mapa incorporado personalizado não impede o link de abertura automático", () => {
    const mapEmbedUrl = "https://www.google.com/maps/embed?pb=exemplo";
    expect(resolveLocationMapLinks({ address, mapEmbedUrl }))
      .toEqual({ mapUrl: automaticMapUrl, mapEmbedUrl });
  });

  test("alterar a morada atualiza ambas as ligações automáticas", () => {
    const initial = resolveLocationMapLinks({ address });
    const changedAddress = "Avenida dos Aliados, 100, 4000-064 Porto";
    const changed = resolveLocationMapLinks({ address: changedAddress });

    expect(changed.mapUrl).not.toBe(initial.mapUrl);
    expect(changed.mapEmbedUrl).not.toBe(initial.mapEmbedUrl);
    expect(new URL(changed.mapUrl).searchParams.get("query")).toBe(changedAddress);
    expect(new URL(changed.mapEmbedUrl).searchParams.get("q")).toBe(changedAddress);
  });
});

test.describe("validação das ligações opcionais dos mapas", () => {
  test("criar apenas com nome e morada não exige nenhum link", () => {
    const parsed = locationInputSchema.parse({ name: "Loja de demonstração", address });
    expect(parsed.mapUrl).toBe("");
    expect(parsed.mapEmbedUrl).toBe("");
  });

  test("editar permite limpar os links personalizados para regressar ao modo automático", () => {
    expect(locationUpdateSchema.parse({ mapUrl: "  ", mapEmbedUrl: "  " }))
      .toEqual({ mapUrl: "", mapEmbedUrl: "" });
  });

  for (const mapEmbedUrl of [
    automaticEmbedUrl,
    "https://www.google.com/maps?output=embed&q=Lisboa",
    "https://google.com/maps?q=Porto&output=embed",
    "https://www.google.com/maps/?q=Lisboa&output=embed",
    "https://www.google.com/maps/embed?pb=exemplo",
    "https://www.google.com/maps/embed/v1/place?key=example&q=Lisboa",
  ]) {
    test(`aceita um mapa Google incorporado válido: ${mapEmbedUrl}`, () => {
      expect(locationUpdateSchema.safeParse({ mapEmbedUrl }).success).toBe(true);
    });
  }

  for (const mapEmbedUrl of [
    "https://example.com/maps/embed?pb=exemplo",
    "https://google.com.example.com/maps/embed?pb=exemplo",
    "https://evilgoogle.com/maps/embed?pb=exemplo",
    "https://www.google.com/maps?q=Lisboa",
    "https://www.google.com/maps?output=search&q=Lisboa",
    "https://www.google.com/maps?output=embed",
    "https://www.google.com/maps?output=embed&q=",
    "https://www.google.com/maps?output=embed&q=%20%20",
    "https://www.google.com/maps/embedded-malicious?pb=exemplo",
    "http://www.google.com/maps/embed?pb=exemplo",
    "https://user:password@www.google.com/maps/embed?pb=exemplo",
    "javascript:alert(1)",
  ]) {
    test(`rejeita uma ligação que não seja um mapa Google incorporado seguro: ${mapEmbedUrl}`, () => {
      expect(locationUpdateSchema.safeParse({ mapEmbedUrl }).success).toBe(false);
    });
  }
});
