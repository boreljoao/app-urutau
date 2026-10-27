import { describe, expect, it } from "vitest";
import { cidadeDoEndereco, codigoDeVisitanteValido, funil, lerCsv, linkWhatsapp, origemDaVisita, prospectosDoCsv } from "@/lib/comercial";

// Cabeçalho e linhas no formato do google-maps-scraper-kit com --full (colunas a mais são ignoradas).
const CSV_DO_ROBO = [
  "input_id,link,title,category,address,website,phone,review_count,review_rating,latitude,longitude,place_id,emails",
  `1,https://maps.google.com/?cid=1,"Clínica Sorriso, Maricá",Dentista,"R. Abreu Rangel, 120 - Centro, Maricá - RJ, 24900-000",sorriso.com.br,(21) 99876-5432,85,4.8,-22.9183,-42.8189,ChIJ111,"contato@sorriso.com.br, outro@sorriso.com.br"`,
  `2,https://maps.google.com/?cid=2,Pet Feliz,Pet shop,"Av. Central, 9 - Itaipuaçu, Maricá - RJ, 24936-000",,+55 21 3731-0000,12,4.1,-22.95,-42.98,ChIJ222,`,
  `3,https://maps.google.com/?cid=1,"Clínica Sorriso, Maricá",Dentista,"R. Abreu Rangel, 120 - Centro, Maricá - RJ, 24900-000",,,,,,,ChIJ111,`,
  `4,,,Sem nome,,,,,,,,,`,
].join("\n");

describe("leitura do CSV", () => {
  it("respeita aspas, vírgulas dentro do campo e aspas duplicadas", () => {
    expect(lerCsv('a,b\n"x, y","diz ""oi"""\n')).toEqual([["a", "b"], ["x, y", 'diz "oi"']]);
  });

  it("aceita ponto e vírgula (planilha brasileira)", () => {
    expect(lerCsv("nome;telefone\nPadaria;21999")).toEqual([["nome", "telefone"], ["Padaria", "21999"]]);
  });

  it("transforma o CSV do robô em prospectos, sem repetir o mesmo lugar", () => {
    const r = prospectosDoCsv(CSV_DO_ROBO);
    expect(r.prospectos).toHaveLength(2);
    expect(r.ignoradas).toBe(2);
    expect(r.prospectos[0]).toMatchObject({
      nome: "Clínica Sorriso, Maricá",
      telefone: "5521998765432",
      email: "contato@sorriso.com.br",
      site: "sorriso.com.br",
      categoria: "Dentista",
      cidade: "Maricá",
      latitude: -22.9183,
      longitude: -42.8189,
      nota: 4.8,
      avaliacoes: 85,
      chave: "maps:ChIJ111",
    });
    expect(r.prospectos[1]).toMatchObject({ nome: "Pet Feliz", telefone: "552137310000", email: null, site: null });
  });

  it("sem coordenadas nem place_id: fica fora do mapa e a chave vem do nome e endereço", () => {
    const r = prospectosDoCsv("title,address,phone\nÓtica Visão,\"Rua 1 - Centro, Niterói - RJ\",21999990000\n");
    expect(r.prospectos[0]).toMatchObject({ latitude: null, longitude: null, cidade: "Niterói", chave: "nome:otica visao|rua 1 - centro, niteroi - rj" });
  });

  it("arquivo sem a coluna de nome não gera nada e informa as colunas lidas", () => {
    const r = prospectosDoCsv("foo,bar\n1,2");
    expect(r.prospectos).toEqual([]);
    expect(r.colunas).toEqual(["foo", "bar"]);
  });
});

describe("pequenas regras", () => {
  it("cidade do endereço do Google", () => {
    expect(cidadeDoEndereco("Av. Roberto Silveira, 50 - Flamengo, Maricá - RJ, 24900-000")).toBe("Maricá");
    expect(cidadeDoEndereco("Sem padrão")).toBeNull();
  });

  it("funil: taxa de fechamento só conta quem já decidiu", () => {
    expect(funil({ novo: 10, contatado: 4, ganho: 3, perdido: 1 })).toEqual({ abertas: 14, total: 18, ganhos: 3, perdidos: 1, taxaFechamento: 75 });
    expect(funil({ novo: 2 }).taxaFechamento).toBeNull();
  });

  it("link do WhatsApp", () => {
    expect(linkWhatsapp("5521998765432", "Oi!")).toBe("https://wa.me/5521998765432?text=Oi!");
    expect(linkWhatsapp("123")).toBeNull();
    expect(linkWhatsapp(null)).toBeNull();
  });
});

describe("origem da visita", () => {
  it("etiqueta UTM ganha do referrer e vira nome conhecido", () => {
    expect(origemDaVisita("instagram", "https://www.google.com/")).toBe("Instagram");
    expect(origemDaVisita("ig", null)).toBe("Instagram");
    expect(origemDaVisita("newsletter-outubro", null)).toBe("newsletter-outubro");
  });

  it("sem etiqueta, usa o site que mandou", () => {
    expect(origemDaVisita(null, "https://l.instagram.com/?u=https%3A%2F%2Furutau.io")).toBe("Instagram");
    expect(origemDaVisita(null, "https://www.google.com.br/")).toBe("Google");
    expect(origemDaVisita(null, "https://blog.parceiro.com.br/post")).toBe("blog.parceiro.com.br");
  });

  it("sem nada, ou vindo do próprio site, é Direto", () => {
    expect(origemDaVisita(null, null)).toBe("Direto");
    expect(origemDaVisita(undefined, "https://urutau.io/#gestao")).toBe("Direto");
    expect(origemDaVisita(undefined, "não é url")).toBe("Direto");
  });

  it("código do visitante: só o formato que o site gera", () => {
    expect(codigoDeVisitanteValido("3f2a9c1e-8b7d-4e21-9a0b-1c2d3e4f5a6b")).toBe(true);
    expect(codigoDeVisitanteValido("<script>")).toBe(false);
    expect(codigoDeVisitanteValido("curto")).toBe(false);
    expect(codigoDeVisitanteValido(42)).toBe(false);
  });
});
