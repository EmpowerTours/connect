import type { IntroDraftInput, IntroDraftResult, ScoutInput, ScoutProvider, ScoutResult } from "./types";

type Copy = { fit: string; angles: string[] };

const BY_TYPE: Record<string, { en: Copy; es: Copy }> = {
  bank: {
    en: { fit: "Banks evaluate chains on settlement finality, compliance tooling and operational risk. A pilot scoped to tokenised deposits, cross-border settlement or stablecoin on/off-ramps keeps the first step small.", angles: ["Tokenised settlement pilot with a fixed, small scope", "Compliance & permissioning story (KYC'd access, auditability)", "Introduce through their digital-assets lead or an existing advisor"] },
    es: { fit: "Los bancos evalúan cadenas por finalidad de liquidación, herramientas de cumplimiento y riesgo operativo. Un piloto acotado a depósitos tokenizados, liquidación transfronteriza o rampas de stablecoins hace que el primer paso sea pequeño.", angles: ["Piloto de liquidación tokenizada con alcance pequeño y fijo", "Historia de cumplimiento y permisos (acceso con KYC, auditabilidad)", "Entrar por su líder de activos digitales o un asesor existente"] },
  },
  exchange: {
    en: { fit: "Exchanges care about deposit/withdrawal support, liquidity and user demand. Fast, cheap EVM settlement can lower their transfer costs and open new listings.", angles: ["Native deposits/withdrawals integration", "Stablecoin liquidity and transfer-cost comparison", "Co-marketing to their users in-region"] },
    es: { fit: "A los exchanges les importan los depósitos/retiros, la liquidez y la demanda de usuarios. Una liquidación EVM rápida y barata puede bajar sus costos de transferencia y abrir nuevos listados.", angles: ["Integración nativa de depósitos y retiros", "Liquidez de stablecoins y comparación de costos de transferencia", "Co-marketing con sus usuarios en la región"] },
  },
  custodian: {
    en: { fit: "Custodians gate institutional access: once a chain is supported in custody, their clients can participate. Support for the chain's assets and staking is usually the ask.", angles: ["Custody support for native asset and stablecoins", "Institutional client demand evidence", "Security / audit documentation pack"] },
    es: { fit: "Los custodios controlan el acceso institucional: cuando una cadena tiene soporte en custodia, sus clientes pueden participar. Normalmente se pide soporte de los activos y staking.", angles: ["Soporte de custodia para el activo nativo y stablecoins", "Evidencia de demanda de clientes institucionales", "Paquete de seguridad y auditorías"] },
  },
  asset_manager: {
    en: { fit: "Asset managers choose chains for tokenised funds based on distribution, transfer-agent support and investor access. Distribution to new onchain users is the main lever.", angles: ["Tokenised fund distribution to onchain users", "Transfer-agent and compliance compatibility", "Collateral use of fund tokens in DeFi"] },
    es: { fit: "Las gestoras eligen cadenas para fondos tokenizados por distribución, soporte de agente de transferencias y acceso de inversionistas. La distribución a nuevos usuarios onchain es la palanca principal.", angles: ["Distribución de fondos tokenizados a usuarios onchain", "Compatibilidad con agente de transferencias y cumplimiento", "Uso de tokens de fondos como colateral en DeFi"] },
  },
  market_infra: {
    en: { fit: "Market infrastructure moves slowly and through working groups. Aim for a research collaboration or sandbox participation rather than an integration ask.", angles: ["Joint research / sandbox participation", "Throughput and finality benchmarks", "Engage via the consultancies already advising them"] },
    es: { fit: "La infraestructura de mercado avanza lento y a través de grupos de trabajo. Conviene buscar una colaboración de investigación o un sandbox en lugar de pedir una integración.", angles: ["Investigación conjunta / participación en sandbox", "Benchmarks de rendimiento y finalidad", "Entrar por las consultoras que ya los asesoran"] },
  },
  fintech: {
    en: { fit: "Fintechs and payment rails move fastest. Lower transfer costs, stablecoin rails and instant settlement map directly onto their unit economics.", angles: ["Stablecoin payments / remittance corridor pilot", "Cost-per-transfer comparison", "Developer support and grants for the integration"] },
    es: { fit: "Las fintechs y rieles de pago se mueven más rápido. Menores costos de transferencia, rieles de stablecoins y liquidación instantánea impactan directo en su economía unitaria.", angles: ["Piloto de pagos / corredor de remesas con stablecoins", "Comparación de costo por transferencia", "Soporte técnico y grants para la integración"] },
  },
  foundation: {
    en: { fit: "Other foundations are partners as often as competitors: shared tooling, bridges, and co-hosted institutional events are common ground.", angles: ["Interop / bridge collaboration", "Co-hosted institutional roundtable", "Shared research on institutional adoption"] },
    es: { fit: "Otras fundaciones son tanto socias como competidoras: herramientas compartidas, puentes y eventos institucionales en conjunto son terreno común.", angles: ["Colaboración en interoperabilidad / puentes", "Mesa redonda institucional en conjunto", "Investigación compartida sobre adopción institucional"] },
  },
  advisor: {
    en: { fit: "Advisors and consultancies shape which chains their clients shortlist. Being in their briefing materials can matter more than direct outreach.", angles: ["Technical briefing for their digital-assets practice", "Joint client workshop", "Provide a neutral evaluation pack they can reuse"] },
    es: { fit: "Asesores y consultoras influyen en qué cadenas evalúan sus clientes. Estar en sus materiales puede pesar más que el contacto directo.", angles: ["Briefing técnico para su práctica de activos digitales", "Taller conjunto con clientes", "Entregar un paquete de evaluación neutral que puedan reutilizar"] },
  },
  builder: {
    en: { fit: "Builders and infrastructure providers integrate when there's developer demand and support. Grants, co-marketing and early technical access are the usual levers.", angles: ["Integration support and grants", "Co-marketing launch", "Early access to performance features"] },
    es: { fit: "Builders y proveedores de infraestructura integran cuando hay demanda de desarrolladores y soporte. Grants, co-marketing y acceso técnico temprano son las palancas habituales.", angles: ["Soporte de integración y grants", "Lanzamiento con co-marketing", "Acceso temprano a funciones de rendimiento"] },
  },
};

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? "";
}

/** Deterministic, offline provider. Uses only the facts in the input. */
export class MockScoutProvider implements ScoutProvider {
  readonly name = "mock";

  async generate(input: ScoutInput): Promise<ScoutResult> {
    const es = input.locale === "es";
    const copy = (BY_TYPE[input.org.type] ?? BY_TYPE.builder)[es ? "es" : "en"];
    const { org, deal, sender } = input;
    const voice = sender.voice.toLowerCase();
    const formal = /formal|usted/.test(voice);
    const short = /short|brief|direct|corto|breve|directo/.test(voice);

    const facts: string[] = [];
    if (org.chainsInUse.length) facts.push(es ? `Usa públicamente: ${org.chainsInUse.join(", ")}.` : `Publicly uses: ${org.chainsInUse.join(", ")}.`);
    const competing = [...new Set([...(deal?.competingChains ?? []), ...org.chainsEvaluating])];
    if (competing.length) facts.push(es ? `Evaluando también: ${competing.join(", ")}.` : `Also evaluating: ${competing.join(", ")}.`);
    if (org.notes) facts.push(es ? `En el expediente: ${org.notes}` : `On file: ${org.notes}`);
    if (deal?.useCase) facts.push(es ? `Caso de uso: ${deal.useCase}.` : `Use case: ${deal.useCase}.`);
    if (input.signals.length) facts.push(es ? `Señal reciente: "${input.signals[0].title}".` : `Recent signal: "${input.signals[0].title}".`);
    if (!facts.length) facts.push(es ? "Aún no hay datos verificados en el perfil; investiga antes de enviar." : "No verified facts on file yet — research before sending.");

    const fit = `${copy.fit} ${facts.join(" ")}`;

    const champion = deal?.contacts.find((c) => c.isChampion) ?? deal?.contacts[0];
    const greetName = champion ? firstName(champion.name) : "";
    const greeting = es
      ? formal ? `Estimado/a ${greetName || "equipo de " + org.name}:` : `Hola ${greetName || "equipo de " + org.name},`
      : formal ? `Dear ${greetName || org.name + " team"},` : `Hi ${greetName || org.name + " team"},`;

    const me = [sender.name, sender.role && sender.orgName ? `${sender.role}, ${sender.orgName}` : sender.role || sender.orgName]
      .filter(Boolean)
      .join(es ? " — " : " — ");
    const hook = input.signals[0]
      ? es ? `Vi la noticia "${input.signals[0].title}" y me pareció relevante.` : `I saw "${input.signals[0].title}" and it seemed relevant.`
      : es ? `Estoy mapeando cómo las instituciones en ${org.region ? "su región" : "el mercado"} eligen infraestructura onchain.` : `I'm mapping how institutions${org.region ? " in your region" : ""} are choosing onchain infrastructure.`;
    const ask = es
      ? `¿Tendría sentido una llamada de 20 minutos para explorar ${copy.angles[0].toLowerCase()}?`
      : `Would a 20-minute call to explore ${copy.angles[0].charAt(0).toLowerCase() + copy.angles[0].slice(1)} make sense?`;
    const middle = short
      ? ""
      : es
        ? `\n\nAlgunas ideas concretas:\n- ${copy.angles.join("\n- ")}`
        : `\n\nA few concrete ideas:\n- ${copy.angles.join("\n- ")}`;
    const signoff = es ? (formal ? "Saludos cordiales," : "Saludos,") : formal ? "Kind regards," : "Best,";

    const draft = `${greeting}\n\n${hook}${middle}\n\n${ask}\n\n${signoff}\n${me || sender.name}`;
    const subject = es ? `${org.name} × ${sender.orgName || "nosotros"}: ${copy.angles[0]}` : `${org.name} × ${sender.orgName || "us"}: ${copy.angles[0]}`;

    return { provider: this.name, fit, angles: copy.angles, subject, draft };
  }

  async draftIntro(input: IntroDraftInput): Promise<IntroDraftResult> {
    const es = input.locale === "es";
    const { requester, connector, target } = input;
    const voice = requester.voice.toLowerCase();
    const short = /short|brief|direct|corto|breve|directo/.test(voice);
    const c = firstName(connector.name) || connector.name;
    const tFirst = firstName(target.name) || target.name;
    const targetDesc = [target.headline, target.orgName].filter(Boolean).join(es ? " en " : " at ");
    const reason = input.reason.trim() || (es ? "explorar una posible colaboración" : "explore a possible collaboration");
    const topics = input.sharedTopics.length ? input.sharedTopics.slice(0, 3).join(", ") : "";
    const lines = es
      ? [
          `Hola ${c},`,
          "",
          `¿Te sentirías cómodo/a presentándome con ${tFirst}${targetDesc ? ` (${targetDesc})` : ""}? Te cuento el motivo: ${reason.replace(/^./, (x) => x.toLowerCase()).replace(/[.\s]+$/, "")}.`,
          ...(topics && !short ? ["", `Ambos estamos siguiendo ${topics}, así que creo que la conversación sería útil para los dos.`] : []),
          "",
          "Si te parece bien, puedo enviarte un párrafo corto para reenviar. Y si no es buen momento, sin problema.",
          "",
          "¡Gracias!",
          requester.name,
        ]
      : [
          `Hi ${c},`,
          "",
          `Would you be comfortable introducing me to ${tFirst}${targetDesc ? ` (${targetDesc})` : ""}? Here's why I'm asking: ${reason.replace(/^./, (x) => x.toLowerCase()).replace(/[.\s]+$/, "")}.`,
          ...(topics && !short ? ["", `We're both following ${topics}, so I think it'd be a useful conversation for both sides.`] : []),
          "",
          "Happy to send a short forwardable blurb. And no worries at all if the timing isn't right.",
          "",
          "Thanks!",
          requester.name,
        ];
    return { provider: this.name, message: lines.join("\n") };
  }
}
