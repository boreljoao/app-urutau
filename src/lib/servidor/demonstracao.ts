/**
 * Empresas de demonstração para levar à prospecção: uma por ramo (carros, varejo, autônomo),
 * com 13 meses de vendas e despesas, folha, clientes, conversas no WhatsApp e o atendente
 * configurado. Os nomes são inventados e nenhuma marca real aparece.
 *
 * Roda de dentro do app (painel Urutau → Clientes → Demonstrações), então funciona em produção
 * sem acesso direto ao banco. Recriar apaga a empresa anterior do mesmo nome e gera tudo de novo
 * com as datas de hoje, para a demonstração nunca parecer parada.
 */
import { and, eq, inArray, min } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { criarPadroesDaEmpresa } from "@/db/padroes";
import {
  agentesWhatsapp,
  categoriasDespesa,
  clientes,
  conversas,
  despesas,
  empresaUsuarios,
  empresas,
  folhaMensal,
  fontesReceita,
  funcionarios,
  mensagensWhatsapp,
  receitasHistoricas,
  vendas,
  type ChaveCategoria,
  type Empresa,
} from "@/db/schema";
import { CUSTO_META_MENSAGEM_MICROS, PREFIXO_NUMERO_DEMONSTRACAO } from "@/lib/atendimento";
import { type Data, diasNoMes, hoje, mesAtual, mesDe, somarDias, somarMeses, ultimosMeses } from "@/lib/datas";
import { prepararEmpresa } from "./automaticos";
import { impostoDoMes } from "./fiscal";
import { sincronizarFolha } from "./folha";

export type Ramo = "carros" | "varejo" | "autonomo";
/** A conta que entra nas empresas de demonstração: só elas, nenhum cliente de verdade. */
export const EMAIL_DEMONSTRACAO = "demonstracao@urutau.io";
export const RAMOS: Ramo[] = ["carros", "varejo", "autonomo"];

type Autor = "cliente" | "agente" | "humano" | "sistema";
type Acoes = { nome: string; resumo: string }[];
/** [minutos atrás, autor, texto, ações do agente] */
type Linha = [number, Autor, string, Acoes?];

interface Conversa {
  cliente: string;
  status?: "agente" | "humano" | "encerrada";
  intencao?: string;
  resumo?: string;
  motivoHumano?: string;
  naoLidas?: number;
  linhas: Linha[];
}

interface Demonstracao {
  rotulo: string;
  descricao: string;
  /** O número que aparece como conectado (fictício). */
  numero: string;
  empresa: Omit<typeof empresas.$inferInsert, "id">;
  /** Por fonte (o nome vem do perfil): faixa do mês em reais e quantos lançamentos. */
  fontes: Record<string, { mensal: [number, number]; lancamentos: number; pagamento: "pix" | "credito" | "boleto" | "transferencia"; prazo: number; comCliente?: boolean; itens: string[] }>;
  despesasFixas: [ChaveCategoria, string, number, number][];
  mercadorias?: { pct: number; descricao: string };
  proLabore: number;
  funcionarios: Omit<typeof funcionarios.$inferInsert, "empresaId" | "folhaDesde">[];
  crescimento: number;
  clientes: { nome: string; telefone: string; origem: "whatsapp" | "site" | "balcao" | "indicacao" | "manual"; observacao?: string }[];
  agente: { nome: string; tom: string; conhecimento: string; quandoChamarHumano: string };
  conversas: Conversa[];
  /** Vendas que o atendente registrou sozinho e esperam o check do dono. */
  doWhatsapp: { cliente: string; descricao: string; valor: number; fonte: string; status: "recebido" | "a_receber" }[];
}

const reais = (r: number) => Math.round(r * 100);
const tel = (n: string) => `55${n}`;

export const DEMONSTRACOES: Record<Ramo, Demonstracao> = {
  carros: {
    rotulo: "Carros",
    numero: "+55 21 3333-0101",
    descricao: "Revenda de seminovos com estoque, financiamento e test drive pelo WhatsApp.",
    empresa: { nome: "Avenida Seminovos", perfil: "revenda_veiculos", atividade: "ambos", cidade: "Niterói", uf: "RJ", regime: "simples", anexoComercio: "I", anexoServicos: "III", inicioAtividade: "2021-08-02" },
    fontes: {
      "Venda de veículos": {
        mensal: [210_000, 280_000], lancamentos: 5, pagamento: "transferencia", prazo: 3, comCliente: true,
        itens: ["Jeep Compass Longitude 2019", "Hyundai Creta Pulse 2021", "VW T-Cross Comfortline 2020", "Toyota Corolla GLi 2019", "Chevrolet Onix LT 2020", "Hyundai HB20 Vision 2021", "Fiat Toro Freedom 2020", "Honda Civic EXL 2018", "Renault Kwid Zen 2022", "Fiat Argo Drive 2021"],
      },
      "Comissão de financiamento": { mensal: [7_000, 10_500], lancamentos: 3, pagamento: "transferencia", prazo: 20, itens: ["Comissão do banco (financiamentos do mês)"] },
      "Despachante e documentação": { mensal: [1_800, 3_000], lancamentos: 5, pagamento: "pix", prazo: 0, comCliente: true, itens: ["Transferência e vistoria", "Emplacamento", "Laudo cautelar"] },
    },
    despesasFixas: [
      ["contas_fixas", "Aluguel do pátio", 8_200, 10],
      ["contas_fixas", "Energia, água e internet", 950, 15],
      ["contas_fixas", "Contabilidade", 1_300, 10],
      ["marketing", "Anúncios (portais de carro e Instagram)", 2_600, 20],
      ["outras", "Preparação e polimento dos carros", 1_900, 25],
      ["juros_tarifas", "Tarifas bancárias", 160, 5],
    ],
    mercadorias: { pct: 72, descricao: "Compra de veículos para revenda" },
    proLabore: 9_000,
    funcionarios: [
      { nome: "Thiago Ramos", cargo: "Vendedor", salarioBrutoCentavos: reais(2_800), admissao: "2022-03-01", vtCentavos: reais(180), vrCentavos: reais(450) },
      { nome: "Camila Duarte", cargo: "Vendedora", salarioBrutoCentavos: reais(2_800), admissao: "2023-09-04", vtCentavos: reais(180), vrCentavos: reais(450) },
      { nome: "Sérgio Lopes", cargo: "Preparador", salarioBrutoCentavos: reais(2_000), admissao: "2022-01-10", vtCentavos: reais(180) },
    ],
    crescimento: 1.2,
    clientes: [
      { nome: "Rafael Moura", telefone: tel("21998761234"), origem: "whatsapp", observacao: "Procura SUV até R$ 100 mil. Tem um Onix 2019 para a troca." },
      { nome: "Patrícia Gomes", telefone: tel("21987654321"), origem: "whatsapp", observacao: "Quer financiar em 48x. Prefere automático." },
      { nome: "João Victor Alves", telefone: tel("21912345678"), origem: "whatsapp" },
      { nome: "Carla Nunes", telefone: tel("21966660002"), origem: "whatsapp" },
      { nome: "Marcos Pereira", telefone: tel("21955550001"), origem: "site" },
      { nome: "Fernanda Lima", telefone: tel("21994445566"), origem: "indicacao", observacao: "Indicada pelo Rafael." },
      { nome: "Lucas Andrade", telefone: tel("21991112233"), origem: "site" },
      { nome: "Beatriz Campos", telefone: tel("21993334455"), origem: "balcao" },
      { nome: "Eduardo Faria", telefone: tel("21996667788"), origem: "whatsapp" },
      { nome: "Renata Souza", telefone: tel("21992223344"), origem: "indicacao" },
    ],
    agente: {
      nome: "Duda",
      tom: "simpática, direta, trata por você e fala de carro com segurança",
      conhecimento: `AVENIDA SEMINOVOS
Seminovos revisados, com laudo cautelar e garantia de 3 meses no motor e câmbio. Av. Feliciano Sodré, 820, Centro, Niterói.

CARROS DISPONÍVEIS (preço final, documentação inclusa)
- Jeep Compass Longitude 2020, automático, 58 mil km, prata: R$ 112.900
- Toyota Corolla XEi 2.0 2020, automático, 61 mil km, branco: R$ 109.900
- Volkswagen T-Cross Highline 2021, automático, 52 mil km, cinza: R$ 104.900
- Fiat Toro Volcano diesel 4x4 2021, automática, 74 mil km, branca: R$ 139.900
- Hyundai HB20 Comfort Plus turbo 2024, automático, 18 mil km, prata: R$ 94.900
- Hyundai Creta Prestige 2.0 2019, automático, 64 mil km, bronze: R$ 89.900
- Hyundai HB20 Comfort 1.0 2020, manual, 61 mil km, branco: R$ 64.500
- Chevrolet Onix LT 1.0 2019, manual, 66 mil km, branco: R$ 62.900

FINANCIAMENTO
Entrada a partir de 20%, em até 60x, com os principais bancos. O carro usado pode ser a entrada. O site tem um simulador com taxa de 1,69% ao mês (estimativa). Para aprovar com o banco precisa de nome completo e CPF: chame alguém da loja.

RESERVA
Sinal de R$ 2.000 no Pix segura o carro por até 3 dias e entra no valor do carro.

TROCA
Aceitamos carro e moto na troca. A avaliação é presencial, leva uns 20 minutos e o valor sai na hora. Quitamos o financiamento do carro do cliente, se tiver. Fotos e quilometragem pelo WhatsApp dão uma prévia do valor.

TEST DRIVE
Com hora marcada e CNH em mãos.

HORÁRIO
Segunda a sexta, 9h às 18h. Sábado, 9h às 14h. A 5 minutos da estação das barcas, com estacionamento para clientes.`,
      quandoChamarHumano: "Simulação de financiamento, proposta de troca com valor, desconto acima de R$ 2 mil, reclamação.",
    },
    conversas: [
      {
        cliente: "Rafael Moura",
        intencao: "comprar",
        resumo: "SUV até R$ 110 mil, tem Onix 2019 na troca; visita amanhã 10h",
        linhas: [
          [42, "cliente", "Boa tarde! Vocês têm algum SUV automático até uns 110 mil?"],
          [42, "agente", "Boa tarde, Rafael! Tenho dois que cabem: o T-Cross Highline 2021, 52 mil km, por R$ 104.900, e o Compass Longitude 2020, 58 mil km, por R$ 112.900. Os dois revisados e com garantia de 3 meses. Quer as fotos de algum?", [{ nome: "anotar_atendimento", resumo: "Quer comprar: SUV automático até R$ 110 mil" }]],
          [38, "cliente", "Do T-Cross. E vocês pegam meu Onix 2019 na troca?"],
          [38, "agente", "Pegamos, sim! A avaliação é aqui na loja e leva uns 20 minutos. Quer passar amanhã para ver o T-Cross e já avaliar o Onix?"],
          [31, "cliente", "Amanhã 10h pode ser?"],
          [31, "agente", "Combinado: amanhã às 10h, T-Cross separado e avaliação do Onix. Fica na Av. Feliciano Sodré, 820. Até amanhã!", [{ nome: "salvar_cliente", resumo: "Salvou Rafael Moura" }, { nome: "anotar_atendimento", resumo: "Agendar: visita amanhã 10h, T-Cross + avaliação do Onix" }]],
        ],
      },
      {
        cliente: "Patrícia Gomes",
        status: "humano",
        intencao: "orcamento",
        resumo: "Financiar o Corolla em 48x",
        motivoHumano: "Simulação de financiamento precisa de CPF",
        naoLidas: 1,
        linhas: [
          [95, "cliente", "Oi, quanto fica o Corolla financiado em 48x?"],
          [95, "agente", "Oi, Patrícia! Para simular certinho com o banco preciso que alguém da equipe veja. Já chamei o Thiago, ele te responde em instantes.", [{ nome: "chamar_humano", resumo: "Chamou a equipe: simulação de financiamento precisa de CPF" }]],
          [95, "sistema", "O atendente chamou a equipe: simulação de financiamento precisa de CPF"],
          [70, "humano", "Oi, Patrícia! Aqui é o Thiago. Me passa seu nome completo e CPF que eu simulo agora com dois bancos."],
          [12, "cliente", "Patrícia Gomes Ferreira. O CPF eu mando por áudio, pode ser?"],
        ],
      },
      {
        cliente: "João Victor Alves",
        intencao: "agendar",
        resumo: "Test drive do Compass no sábado 11h",
        linhas: [
          [180, "cliente", "Posso fazer test drive do Compass no sábado?"],
          [180, "agente", "Pode sim, João! Sábado abrimos das 9h às 14h. Qual horário fica melhor? Só precisa trazer a CNH."],
          [176, "cliente", "11h"],
          [176, "agente", "Fechado: sábado às 11h, test drive do Compass. Te espero aqui!", [{ nome: "anotar_atendimento", resumo: "Agendar: test drive do Compass sábado 11h" }]],
        ],
      },
      {
        cliente: "Eduardo Faria",
        intencao: "comprar",
        resumo: "Reservou a Toro com sinal de R$ 2 mil",
        linhas: [
          [600, "cliente", "A Toro diesel ainda tá disponível? Quero segurar ela até sexta"],
          [600, "agente", "Está sim, Eduardo! Para reservar até sexta pedimos um sinal de R$ 2.000 no Pix, que entra no valor do carro. Quer a chave?"],
          [590, "cliente", "Manda. Já faço agora"],
          [586, "agente", "Recebi o comprovante, obrigado! A Toro fica reservada no seu nome até sexta às 18h.", [{ nome: "registrar_venda", resumo: "Registrou R$ 2.000,00: sinal de reserva da Toro Volcano" }]],
        ],
      },
      {
        cliente: "Marcos Pereira",
        status: "encerrada",
        intencao: "duvida",
        resumo: "Perguntou da garantia",
        linhas: [
          [1_500, "cliente", "A garantia cobre o ar-condicionado?"],
          [1_500, "agente", "A garantia de 3 meses cobre motor e câmbio. O ar-condicionado é revisado antes da venda, mas não entra na garantia."],
          [1_490, "cliente", "Entendi, obrigado"],
          [1_480, "sistema", "Conversa encerrada."],
        ],
      },
      { cliente: "Carla Nunes", naoLidas: 1, linhas: [[1, "cliente", "Boa tarde, o HB20 2020 ainda tá aí?"]] },
    ],
    doWhatsapp: [
      { cliente: "Eduardo Faria", descricao: "Sinal de reserva: Fiat Toro Volcano 2021", valor: 2_000, fonte: "Venda de veículos", status: "recebido" },
      { cliente: "Rafael Moura", descricao: "Transferência e vistoria: Onix 2019 (troca)", valor: 850, fonte: "Despachante e documentação", status: "recebido" },
      { cliente: "Fernanda Lima", descricao: "Entrada: HB20 2020, restante financiado em 48x", valor: 15_000, fonte: "Venda de veículos", status: "a_receber" },
    ],
  },

  varejo: {
    rotulo: "Varejo",
    numero: "+55 21 3333-0202",
    descricao: "Camisaria com loja, vendas pelo WhatsApp e site, troca e envio.",
    empresa: { nome: "Algodão Camisaria", perfil: "varejo", atividade: "comercio", cidade: "Rio de Janeiro", uf: "RJ", regime: "simples", anexoComercio: "I", inicioAtividade: "2022-10-03" },
    fontes: {
      "Loja física": { mensal: [38_000, 46_000], lancamentos: 22, pagamento: "credito", prazo: 30, itens: ["Fechamento do caixa da loja"] },
      WhatsApp: { mensal: [14_000, 19_000], lancamentos: 14, pagamento: "pix", prazo: 0, comCliente: true, itens: ["Camisas de linho (pedido no WhatsApp)", "Oxford e polo (pedido no WhatsApp)", "Kit 3 camisetas pima (WhatsApp)", "Presente: camisa listrada (WhatsApp)"] },
      Site: { mensal: [6_000, 9_500], lancamentos: 8, pagamento: "pix", prazo: 0, comCliente: true, itens: ["Pedido da loja virtual", "Pedido da loja virtual (Correios)"] },
    },
    despesasFixas: [
      ["contas_fixas", "Aluguel da loja", 6_400, 10],
      ["contas_fixas", "Energia elétrica", 780, 15],
      ["contas_fixas", "Internet e telefone", 199, 12],
      ["contas_fixas", "Contabilidade", 900, 10],
      ["contas_fixas", "Plataforma da loja virtual", 189, 5],
      ["marketing", "Anúncios no Instagram", 1_500, 20],
      ["outras", "Embalagens e etiquetas", 650, 18],
      ["outras", "Fretes e Correios", 1_100, 25],
      ["juros_tarifas", "Taxas da maquininha", 1_050, 28],
    ],
    mercadorias: { pct: 42, descricao: "Reposição de camisas (fornecedores)" },
    proLabore: 6_500,
    funcionarios: [
      { nome: "Larissa Mendes", cargo: "Vendedora", salarioBrutoCentavos: reais(2_100), admissao: "2023-02-01", vtCentavos: reais(180), vrCentavos: reais(350) },
      { nome: "Gabriel Torres", cargo: "Vendedor e estoque", salarioBrutoCentavos: reais(2_100), admissao: "2024-05-06", vtCentavos: reais(180), vrCentavos: reais(350) },
    ],
    crescimento: 1.5,
    clientes: [
      { nome: "Bruno Cardoso", telefone: tel("21981230001"), origem: "whatsapp", observacao: "Veste M, prefere linho." },
      { nome: "Aline Ribeiro", telefone: tel("21981230002"), origem: "whatsapp", observacao: "Compra presente para o marido (G)." },
      { nome: "Diego Martins", telefone: tel("21981230003"), origem: "site" },
      { nome: "Juliana Prates", telefone: tel("21981230004"), origem: "whatsapp" },
      { nome: "Henrique Bastos", telefone: tel("21981230005"), origem: "balcao" },
      { nome: "Marina Lopes", telefone: tel("21981230006"), origem: "whatsapp" },
      { nome: "Felipe Assis", telefone: tel("21981230007"), origem: "site" },
      { nome: "Tatiane Rocha", telefone: tel("21981230008"), origem: "indicacao" },
      { nome: "Rodrigo Neves", telefone: tel("21981230009"), origem: "whatsapp" },
      { nome: "Vanessa Lima", telefone: tel("21981230010"), origem: "whatsapp" },
      { nome: "Otávio Reis", telefone: tel("21981230011"), origem: "site" },
      { nome: "Paula Fontes", telefone: tel("21981230012"), origem: "balcao" },
    ],
    agente: {
      nome: "Lia",
      tom: "leve e atenciosa, fala como vendedora de loja que conhece cada peça",
      conhecimento: `ALGODÃO CAMISARIA
Camisas masculinas de algodão e linho, feitas no Brasil (ateliês de Petrópolis e Nova Friburgo, em lotes pequenos; quando uma cor acaba, a próxima leva chega em umas três semanas). Só fibra natural, sem poliéster. Rua Visconde de Pirajá, 310, loja 4, Ipanema, Rio de Janeiro.

PEÇAS E PREÇOS
- Camisa de linho manga longa (branca, areia, azul-claro, verde-oliva): R$ 289
- Camisa de linho manga curta (branca, areia, terracota): R$ 249
- Camisa oxford manga longa (branca, azul, rosa-claro): R$ 219
- Camisa de algodão listrada (azul e branca, verde e branca): R$ 199
- Polo de algodão piquet (marinho, branca, preta, verde): R$ 159
- Camiseta básica de algodão pima (6 cores): R$ 99

TAMANHOS
P, M, G, GG e XGG. Tabela de medidas: P peito 100 cm, M 106 cm, G 112 cm, GG 118 cm, XGG 124 cm. Linho tem caimento mais solto.

PAGAMENTO
Pix com 5% de desconto, ou cartão em até 4x sem juros.

ENTREGA
Rio de Janeiro capital: motoboy no mesmo dia para pedidos até 15h, R$ 15. Outras cidades: Correios, de 3 a 8 dias úteis, frete grátis acima de R$ 400.

TROCA
Troca em até 30 dias, com etiqueta, na loja ou pelos Correios. A primeira troca, com frete, é por nossa conta.

OUTROS
Embrulho para presente sem custo, com cartão escrito à mão se o cliente quiser. Pedido para empresa com bordado do logotipo a partir de 10 peças: orçamento em um dia útil (chame a equipe). Linho: lavar à mão ou no ciclo delicado e secar no cabide. Na loja, separamos peças no tamanho do cliente se ele avisar antes.

HORÁRIO DA LOJA
Segunda a sábado, 10h às 20h.`,
      quandoChamarHumano: "Pedido acima de 6 peças ou para empresa, defeito na peça, pedido de desconto além do Pix, reclamação de entrega.",
    },
    conversas: [
      {
        cliente: "Bruno Cardoso",
        intencao: "comprar",
        resumo: "2 camisas de linho M (branca e areia), motoboy hoje",
        linhas: [
          [25, "cliente", "Oi! Tem camisa de linho manga longa no M?"],
          [25, "agente", "Oi, Bruno! Tem sim, no M temos branca, areia, azul-claro e verde-oliva, R$ 289 cada. O linho tem caimento mais solto, o M fica com 106 cm de peito. Quer que eu separe alguma?", [{ nome: "anotar_atendimento", resumo: "Quer comprar: camisa de linho manga longa M" }]],
          [21, "cliente", "Quero a branca e a areia. Chega hoje? Moro em Botafogo"],
          [21, "agente", "Chega! Pedido até 15h vai de motoboy hoje, R$ 15. No Pix fica 5% de desconto: R$ 549,10 + R$ 15 = R$ 564,10. Te mando a chave?"],
          [19, "cliente", "Manda"],
          [17, "agente", "Pagamento recebido, obrigado! As duas camisas saem daqui até as 16h. Te aviso quando o motoboy sair.", [{ nome: "salvar_cliente", resumo: "Salvou Bruno Cardoso" }, { nome: "registrar_venda", resumo: "Registrou R$ 564,10: 2 camisas de linho M, entrega em Botafogo" }]],
        ],
      },
      {
        cliente: "Aline Ribeiro",
        intencao: "duvida",
        resumo: "Presente: dúvida entre G e GG",
        linhas: [
          [140, "cliente", "Boa tarde, quero dar uma camisa de presente pro meu marido, ele usa G em tudo. A oxford é justa?"],
          [140, "agente", "Boa tarde, Aline! A oxford tem corte reto, nem justa nem larga. Se ele usa G em tudo, o G (112 cm de peito) deve ficar ótimo. E se não servir, a troca em 30 dias é por nossa conta. Quer em qual cor? Temos branca, azul e rosa-claro."],
          [132, "cliente", "Azul! Vou passar aí amanhã"],
          [132, "agente", "Perfeito, deixo uma oxford azul G separada no seu nome. A loja abre às 10h. Quer que eu embrulhe para presente?", [{ nome: "anotar_atendimento", resumo: "Quer comprar: oxford azul G para presente, retira amanhã" }]],
        ],
      },
      {
        cliente: "Juliana Prates",
        status: "humano",
        intencao: "orcamento",
        resumo: "15 polos para a equipe da empresa",
        motivoHumano: "Pedido para empresa acima de 6 peças",
        naoLidas: 1,
        linhas: [
          [300, "cliente", "Olá, vocês fazem pedido para empresa? Preciso de 15 polos marinho com bordado"],
          [300, "agente", "Olá, Juliana! Fazemos, sim. Para pedido de empresa com bordado, quem passa o orçamento é a Larissa, da loja. Já chamei ela, te responde ainda hoje.", [{ nome: "chamar_humano", resumo: "Chamou a equipe: pedido para empresa acima de 6 peças" }]],
          [300, "sistema", "O atendente chamou a equipe: pedido para empresa acima de 6 peças"],
          [60, "cliente", "Ok, aguardo! Precisamos até dia 20"],
        ],
      },
      {
        cliente: "Rodrigo Neves",
        intencao: "comprar",
        resumo: "Polo preta GG pelos Correios para Juiz de Fora",
        linhas: [
          [1_300, "cliente", "Vocês mandam pra Juiz de Fora? Queria a polo preta GG"],
          [1_300, "agente", "Mandamos, Rodrigo! Pelos Correios chega de 3 a 8 dias úteis. A polo sai R$ 159; o frete fica grátis acima de R$ 400. Quer só a polo ou mais alguma peça?"],
          [1_290, "cliente", "Só ela mesmo, pago no pix"],
          [1_288, "agente", "Combinado! No Pix fica R$ 151,05 + frete R$ 22,90. Assim que o pagamento cair, te mando o código de rastreio.", [{ nome: "registrar_venda", resumo: "Registrou R$ 173,95: polo preta GG, Correios" }]],
        ],
      },
      { cliente: "Vanessa Lima", naoLidas: 1, linhas: [[2, "cliente", "Oi, a camisa listrada verde tem no P?"]] },
    ],
    doWhatsapp: [
      { cliente: "Bruno Cardoso", descricao: "2 camisas de linho M (branca e areia), motoboy", valor: 564.1, fonte: "WhatsApp", status: "recebido" },
      { cliente: "Rodrigo Neves", descricao: "Polo preta GG, envio pelos Correios", valor: 173.95, fonte: "WhatsApp", status: "a_receber" },
    ],
  },

  autonomo: {
    rotulo: "Autônomo",
    numero: "+55 21 3333-0303",
    descricao: "Psicóloga com consultório: sessões, pacotes e agenda pelo WhatsApp.",
    empresa: { nome: "Helena Prado Psicologia", perfil: "consultorio", atividade: "servicos", cidade: "Niterói", uf: "RJ", regime: "simples", anexoServicos: "V", sujeitoFatorR: true, inicioAtividade: "2020-03-02" },
    fontes: {
      "Sessões": { mensal: [11_500, 14_500], lancamentos: 18, pagamento: "pix", prazo: 0, comCliente: true, itens: ["Sessão individual (presencial)", "Sessão individual (online)"] },
      Pacotes: { mensal: [3_200, 5_000], lancamentos: 4, pagamento: "pix", prazo: 0, comCliente: true, itens: ["Pacote de 4 sessões do mês"] },
    },
    despesasFixas: [
      ["contas_fixas", "Aluguel da sala (meio período)", 1_800, 10],
      ["contas_fixas", "Plataforma de prontuário e videochamada", 129, 5],
      ["contas_fixas", "Contabilidade", 450, 10],
      ["contas_fixas", "Anuidade do conselho (parcela)", 55, 15],
      ["marketing", "Anúncios e Google Meu Negócio", 400, 20],
      ["outras", "Supervisão clínica", 600, 25],
    ],
    proLabore: 6_000,
    funcionarios: [],
    crescimento: 1,
    clientes: [
      { nome: "Ana Beatriz Costa", telefone: tel("21975550001"), origem: "whatsapp", observacao: "Terças, 19h, online." },
      { nome: "Gustavo Henrique", telefone: tel("21975550002"), origem: "indicacao", observacao: "Quinzenal, presencial." },
      { nome: "Priscila Moraes", telefone: tel("21975550003"), origem: "site" },
      { nome: "Leonardo Dias", telefone: tel("21975550004"), origem: "whatsapp" },
      { nome: "Camila Ferraz", telefone: tel("21975550005"), origem: "whatsapp" },
      { nome: "Roberta Sá", telefone: tel("21975550006"), origem: "indicacao" },
      { nome: "Mateus Oliveira", telefone: tel("21975550007"), origem: "site" },
      { nome: "Isabela Torres", telefone: tel("21975550008"), origem: "whatsapp" },
      { nome: "Fábio Mendes", telefone: tel("21975550009"), origem: "manual" },
    ],
    agente: {
      nome: "Assistente da Helena",
      tom: "acolhedora, calma e discreta; nunca dá orientação clínica, só cuida da agenda e das dúvidas práticas",
      conhecimento: `HELENA PRADO PSICOLOGIA
Psicóloga clínica, abordagem cognitivo-comportamental. Atende adultos e adolescentes a partir de 14 anos. Consultório na Rua Gavião Peixoto, 125, sala 708, Icaraí, Niterói, e online por videochamada.

VALORES
- Sessão individual (50 minutos): R$ 220
- Pacote de 4 sessões no mês: R$ 800 (pago no início do mês)
- Primeira conversa de 15 minutos, por videochamada: sem custo

CONVÊNIO
Não atende por convênio direto. Emite recibo para pedir reembolso ao plano de saúde.

HORÁRIOS
Segunda a quinta, 8h às 12h e 16h às 21h. Sexta, 8h às 12h. Horários livres nos próximos dias: segunda 20h, terça 17h, quarta 9h, quinta 20h e sexta 11h. O consultório fica a duas quadras da praia de Icaraí, em prédio com portaria e elevador.

REMARCAÇÃO
Remarcar ou cancelar com até 24h de antecedência, sem custo. Menos que isso, a sessão é cobrada.

COMO FUNCIONA
Sessões de 50 minutos, em geral uma vez por semana no mesmo horário. Objetivos combinados no início e revistos a cada dois meses. Adolescentes a partir de 14 anos: a primeira conversa é com o responsável. Sigilo garantido. Online precisa de lugar reservado e fone de ouvido.

PAGAMENTO
Pix ou transferência, no dia da sessão.

IMPORTANTE
Em crise ou risco, orientar a ligar para o CVV (188) ou SAMU (192) e chamar a Helena.`,
      quandoChamarHumano: "Qualquer assunto clínico ou emocional, crise ou risco, pedido de laudo ou relatório, pedido de desconto.",
    },
    conversas: [
      {
        cliente: "Camila Ferraz",
        intencao: "agendar",
        resumo: "Primeira sessão, quarta 9h, presencial",
        linhas: [
          [50, "cliente", "Oi, boa tarde. Queria saber como faço pra começar terapia com a Helena"],
          [50, "agente", "Boa tarde, Camila! Que bom que você procurou. A Helena atende presencial em Icaraí e online. Se quiser, dá para começar com uma conversa de 15 minutos sem custo, ou já marcar a primeira sessão (50 minutos, R$ 220). Nos próximos dias há horário na terça 17h, quarta 9h e quinta 20h."],
          [44, "cliente", "Quarta 9h presencial. Aceita convênio?"],
          [44, "agente", "Marquei quarta às 9h, presencial, na Rua Gavião Peixoto, 125, sala 708. Convênio direto não, mas a Helena emite recibo para você pedir reembolso ao seu plano. Qualquer coisa, é só chamar aqui.", [{ nome: "salvar_cliente", resumo: "Salvou Camila Ferraz" }, { nome: "anotar_atendimento", resumo: "Agendar: primeira sessão quarta 9h, presencial" }]],
        ],
      },
      {
        cliente: "Ana Beatriz Costa",
        intencao: "agendar",
        resumo: "Remarcou terça 19h para quinta 20h",
        linhas: [
          [200, "cliente", "Oi! Vou precisar remarcar a de terça, tive um imprevisto no trabalho"],
          [200, "agente", "Oi, Ana! Sem problema, avisando com antecedência não há custo. Tenho quinta às 20h, online como sempre. Serve?"],
          [195, "cliente", "Serve sim, obrigada!"],
          [195, "agente", "Pronto: sua sessão foi para quinta às 20h, online. O link é o mesmo de sempre.", [{ nome: "anotar_atendimento", resumo: "Agendar: remarcou de terça 19h para quinta 20h" }]],
        ],
      },
      {
        cliente: "Leonardo Dias",
        status: "humano",
        intencao: "outro",
        resumo: "Pediu relatório para o trabalho",
        motivoHumano: "Pedido de relatório psicológico",
        naoLidas: 1,
        linhas: [
          [400, "cliente", "Boa noite, a Helena consegue fazer um relatório pro RH da minha empresa?"],
          [400, "agente", "Boa noite, Leonardo. Relatórios a própria Helena precisa avaliar. Já deixei seu pedido com ela, e ela te responde pessoalmente.", [{ nome: "chamar_humano", resumo: "Chamou a equipe: pedido de relatório psicológico" }]],
          [400, "sistema", "O atendente chamou a equipe: pedido de relatório psicológico"],
        ],
      },
      {
        cliente: "Gustavo Henrique",
        intencao: "comprar",
        resumo: "Fechou o pacote de 4 sessões do mês",
        linhas: [
          [1_400, "cliente", "Quero fechar o pacote do mês, como funciona?"],
          [1_400, "agente", "São 4 sessões no mês por R$ 800, pagas no início do mês (a sessão avulsa sai R$ 220). Pode ser no Pix. Te mando a chave?"],
          [1_395, "cliente", "Pode mandar, já pago"],
          [1_390, "agente", "Pagamento recebido, obrigado, Gustavo! Seu pacote do mês está confirmado, nos mesmos horários de sempre.", [{ nome: "registrar_venda", resumo: "Registrou R$ 800,00: pacote de 4 sessões do mês" }]],
        ],
      },
      { cliente: "Isabela Torres", naoLidas: 1, linhas: [[3, "cliente", "Oi, ela atende adolescente? Minha filha tem 15 anos"]] },
    ],
    doWhatsapp: [
      { cliente: "Gustavo Henrique", descricao: "Pacote de 4 sessões do mês", valor: 800, fonte: "Pacotes", status: "recebido" },
      { cliente: "Ana Beatriz Costa", descricao: "Sessão individual (online)", valor: 220, fonte: "Sessões", status: "recebido" },
    ],
  },
};

/** Sorteio com semente: a mesma demonstração gera sempre números parecidos. */
function sorteio(semente: number) {
  return () => {
    semente |= 0;
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apaga a demonstração anterior do mesmo nome (tudo sai em cascata). */
export async function apagarDemonstracao(db: BancoDeDados, ramo: Ramo) {
  await db.delete(empresas).where(eq(empresas.nome, DEMONSTRACOES[ramo].empresa.nome));
}

export async function existentes(db: BancoDeDados) {
  const nomes = RAMOS.map((r) => DEMONSTRACOES[r].empresa.nome);
  // A empresa nasce com data de 13 meses atrás; os clientes guardam quando a demonstração foi gerada.
  const linhas = await db
    .select({ id: empresas.id, nome: empresas.nome, criadoEm: min(clientes.criadoEm) })
    .from(empresas)
    .leftJoin(clientes, eq(clientes.empresaId, empresas.id))
    .where(inArray(empresas.nome, nomes))
    .groupBy(empresas.id);
  return Object.fromEntries(RAMOS.map((r) => [r, linhas.find((l) => l.nome === DEMONSTRACOES[r].empresa.nome) ?? null])) as Record<
    Ramo,
    { id: string; nome: string; criadoEm: Date | null } | null
  >;
}

/** Cria (ou recria) a empresa de demonstração do ramo, com o usuário `donoId` como dono. */
export async function criarDemonstracao(db: BancoDeDados, ramo: Ramo, donoId: string): Promise<Empresa> {
  const x = DEMONSTRACOES[ramo];
  const aleatorio = sorteio(RAMOS.indexOf(ramo) + 20261030);
  const entre = (min: number, max: number) => min + Math.floor(aleatorio() * (max - min + 1));
  const hojeData = hoje();
  const mesHoje = mesAtual();
  const pago = (v: Data) => (v <= hojeData ? { status: "pago" as const, pagoEm: v } : { status: "a_pagar" as const, pagoEm: null });

  await apagarDemonstracao(db, ramo);
  const e = await db.transaction(async (tx) => {
    const [nova] = await tx.insert(empresas).values({ ...x.empresa, criadoEm: new Date(`${somarMeses(mesHoje, -13)}-01T12:00:00Z`) }).returning();
    await criarPadroesDaEmpresa(tx, nova.id, nova.atividade, nova.perfil);
    await tx.insert(empresaUsuarios).values({ empresaId: nova.id, usuarioId: donoId, papel: "dono" });
    return nova;
  });

  const fontes = await db.select().from(fontesReceita).where(eq(fontesReceita.empresaId, e.id));
  const fonte = (nome: string) => fontes.find((f) => f.nome === nome)!;
  const cats = await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.empresaId, e.id));
  const cat = (c: ChaveCategoria) => cats.find((k) => k.chaveSistema === c)!.id;

  const lista = await db
    .insert(clientes)
    .values(x.clientes.map((c) => ({ ...c, observacao: c.observacao ?? "", empresaId: e.id, criadoPor: donoId })))
    .returning({ id: clientes.id, nome: clientes.nome, telefone: clientes.telefone });
  const cliente = (nome: string) => lista.find((c) => c.nome === nome)!;

  // ── 13 meses de vendas e despesas ─────────────────────────────────────────
  const meses = ultimosMeses(mesHoje, 13);
  const novasVendas: (typeof vendas.$inferInsert)[] = [];
  const novasDespesas: (typeof despesas.$inferInsert)[] = [];
  let k = 0;
  meses.forEach((mes, i) => {
    const fator = (1 + x.crescimento / 100) ** i * (mes.endsWith("-12") ? 1.25 : mes.endsWith("-01") || mes.endsWith("-02") ? 0.88 : 1);
    const ultimoDia = mes === mesHoje ? Number(hojeData.slice(8)) : diasNoMes(mes);
    let mercadoria = 0;
    for (const [nome, f] of Object.entries(x.fontes)) {
      for (let j = 0; j < f.lancamentos; j++) {
        const dia = Math.min(ultimoDia, 1 + Math.floor(((j + 0.5) * 28) / f.lancamentos));
        const data = `${mes}-${String(dia).padStart(2, "0")}`;
        const valor = Math.round((entre(reais(f.mensal[0]), reais(f.mensal[1])) / f.lancamentos) * fator);
        if (fonte(nome).natureza === "comercio") mercadoria += valor;
        const receber = somarDias(data, f.prazo);
        novasVendas.push({
          empresaId: e.id,
          data,
          valorCentavos: valor,
          descricao: f.itens[(i * f.lancamentos + j) % f.itens.length],
          fonteReceitaId: fonte(nome).id,
          formaPagamento: f.pagamento,
          status: receber <= hojeData ? "recebido" : "a_receber",
          dataRecebimento: receber,
          clienteId: f.comCliente ? lista[k++ % lista.length].id : null,
          criadoPor: donoId,
        });
      }
    }
    const d = (dia: number) => `${mes}-${String(Math.min(dia, diasNoMes(mes))).padStart(2, "0")}`;
    for (const [chave, descricao, valor, dia] of x.despesasFixas) {
      // A energia do mês passado ficou sem pagar: aparece como conta atrasada no painel.
      const esquecida = mes === somarMeses(mesHoje, -1) && /energia/i.test(descricao);
      const v = Math.round(reais(valor) * (chave === "contas_fixas" ? 1 : 0.85 + aleatorio() * 0.3));
      novasDespesas.push({ empresaId: e.id, data: d(1), valorCentavos: v, descricao, categoriaId: cat(chave), vencimento: d(dia), ...(esquecida ? { status: "a_pagar" as const, pagoEm: null } : pago(d(dia))), criadoPor: donoId });
    }
    novasDespesas.push({ empresaId: e.id, data: d(1), valorCentavos: reais(x.proLabore), descricao: "Pró-labore", categoriaId: cat("pro_labore"), vencimento: d(5), ...pago(d(5)), criadoPor: donoId });
    if (x.mercadorias && mercadoria)
      novasDespesas.push({ empresaId: e.id, data: d(6), valorCentavos: Math.round((mercadoria * x.mercadorias.pct) / 100), descricao: x.mercadorias.descricao, categoriaId: cat("mercadorias"), vencimento: d(15), ...pago(d(15)), criadoPor: donoId });
  });

  // Vendas que o atendente registrou e esperam o check do dono.
  for (const v of x.doWhatsapp)
    novasVendas.push({
      empresaId: e.id,
      data: hojeData,
      valorCentavos: reais(v.valor),
      descricao: v.descricao,
      fonteReceitaId: fonte(v.fonte).id,
      formaPagamento: "pix",
      status: v.status,
      dataRecebimento: v.status === "a_receber" ? somarDias(hojeData, 2) : hojeData,
      clienteId: cliente(v.cliente).id,
      origem: "whatsapp",
      conferidoEm: null,
      criadoPor: null,
    });
  for (let i = 0; i < novasVendas.length; i += 500) await db.insert(vendas).values(novasVendas.slice(i, i + 500));
  for (let i = 0; i < novasDespesas.length; i += 500) await db.insert(despesas).values(novasDespesas.slice(i, i + 500));

  // ── Faturamento antes do app (para o imposto sair na faixa certa) ────────
  const inicio = mesDe(x.empresa.inicioAtividade!);
  const anteriores: (typeof receitasHistoricas.$inferInsert)[] = [];
  for (let m = somarMeses(meses[0], -12); m < meses[0]; m = somarMeses(m, 1))
    if (m >= inicio)
      anteriores.push({
        empresaId: e.id,
        competencia: m,
        receitaCentavos: Math.round(Object.values(x.fontes).reduce((t, f) => t + entre(reais(f.mensal[0]), reais(f.mensal[1])), 0) * 0.85),
        folhaCentavos: reais(x.proLabore) + x.funcionarios.reduce((t, f) => t + (f.salarioBrutoCentavos ?? 0), 0),
      });
  if (anteriores.length) await db.insert(receitasHistoricas).values(anteriores);

  // ── Folha ──────────────────────────────────────────────────────────────────
  if (x.funcionarios.length) {
    await db.insert(funcionarios).values(x.funcionarios.map((f) => ({ ...f, empresaId: e.id, folhaDesde: meses[0] })));
    await sincronizarFolha(db, e, mesHoje, mesHoje);
    const linhas = await db.select().from(folhaMensal).where(eq(folhaMensal.empresaId, e.id));
    for (const l of linhas.filter((l) => l.vencimento <= hojeData))
      await db.update(folhaMensal).set({ status: "pago", pagoEm: l.vencimento }).where(eq(folhaMensal.id, l.id));
  }

  // ── Impostos: a guia de cada mês é o imposto estimado do mês anterior ─────
  for (const mes of meses.slice(1).filter((m) => m < mesHoje)) {
    const { imposto } = await impostoDoMes(db, e, somarMeses(mes, -1));
    if (imposto.total)
      await db.insert(despesas).values({ empresaId: e.id, data: `${mes}-20`, valorCentavos: imposto.total, descricao: "DAS do Simples Nacional (mês anterior)", categoriaId: cat("impostos"), vencimento: `${mes}-20`, ...pago(`${mes}-20`), criadoPor: donoId });
  }
  await prepararEmpresa(db, e, mesHoje, mesHoje);
  const guias = await db.select().from(despesas).where(and(eq(despesas.empresaId, e.id), eq(despesas.origem, "imposto")));
  for (const g of guias.filter((g) => g.vencimento < hojeData))
    await db.update(despesas).set({ status: "pago", pagoEm: g.vencimento }).where(eq(despesas.id, g.id));

  // ── Atendente e conversas no WhatsApp ───────────────────────────────────────
  await db.insert(agentesWhatsapp).values({
    empresaId: e.id,
    ...x.agente,
    modo: "automatico",
    phoneNumberId: `${PREFIXO_NUMERO_DEMONSTRACAO}${ramo}`,
    numeroExibicao: x.numero,
    tokenCifrado: "demonstracao",
  });
  const agora = Date.now();
  const em = (min: number) => new Date(agora - min * 60_000);
  for (const c of x.conversas) {
    const cli = cliente(c.cliente);
    const entradas = c.linhas.filter((l) => l[1] === "cliente").map((l) => l[0]);
    const [conv] = await db
      .insert(conversas)
      .values({
        empresaId: e.id,
        canal: "whatsapp",
        telefone: cli.telefone!,
        nome: cli.nome,
        clienteId: cli.id,
        status: c.status ?? "agente",
        intencao: c.intencao,
        resumo: c.resumo,
        motivoHumano: c.motivoHumano,
        naoLidas: c.naoLidas ?? 0,
        ultimaEntradaEm: entradas.length ? em(Math.min(...entradas)) : null,
        ultimaMensagemEm: em(Math.min(...c.linhas.map((l) => l[0]))),
      })
      .returning({ id: conversas.id });
    await db.insert(mensagensWhatsapp).values(
      c.linhas.map(([min, autor, texto, acoes], n) => ({
        conversaId: conv.id,
        empresaId: e.id,
        autor,
        texto,
        status: autor === "cliente" ? ("recebida" as const) : ("lida" as const),
        // A resposta sai alguns segundos depois da pergunta do mesmo minuto.
        criadoEm: new Date(em(min).getTime() + (autor === "cliente" ? 0 : 4_000 + n * 300)),
        acoes: acoes ?? null,
        ...(autor === "agente"
          ? { tokensEntrada: 1_500, tokensSaida: 260, tokensCache: 3_400, custoMicrosUsd: 4_200 + CUSTO_META_MENSAGEM_MICROS, tempoRespostaMs: 2_400 + ((n * 1_300) % 4_000) }
          : autor === "humano"
            ? { custoMicrosUsd: CUSTO_META_MENSAGEM_MICROS }
            : {}),
      })),
    );
  }
  return e;
}
