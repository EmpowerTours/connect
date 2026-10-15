import type { OrgType } from "../src/lib/constants";

/**
 * Seed directory. ONLY public facts: name, type, HQ country (ISO-2, left empty
 * when HQ/domicile is ambiguous), official website, and name aliases used for
 * news matching. Chains are filled ONLY where the chain is the org's own
 * network or the fact is cited in the background research note. Everything
 * else is intentionally empty for the user to research.
 */
export interface SeedOrg {
  name: string;
  type: OrgType;
  country: string;
  website: string;
  aliases?: string[];
  chainsInUse?: string[];
  notes?: string;
}

export const SEED_ORGS: SeedOrg[] = [
  // Foundations / L1-L2 ecosystems
  { name: "Monad Foundation", type: "foundation", country: "", website: "https://www.monad.xyz", aliases: ["Monad"], chainsInUse: ["Monad"] },
  { name: "Ethereum Foundation", type: "foundation", country: "CH", website: "https://ethereum.foundation", chainsInUse: ["Ethereum"] },
  { name: "Solana Foundation", type: "foundation", country: "CH", website: "https://solana.org", chainsInUse: ["Solana"] },
  { name: "Stellar Development Foundation", type: "foundation", country: "US", website: "https://stellar.org", aliases: ["Stellar"], chainsInUse: ["Stellar"] },
  { name: "Arbitrum Foundation", type: "foundation", country: "", website: "https://arbitrum.foundation", aliases: ["Arbitrum"], chainsInUse: ["Arbitrum"] },
  { name: "Optimism Foundation", type: "foundation", country: "", website: "https://www.optimism.io", chainsInUse: ["OP Mainnet"] },
  { name: "Aptos Foundation", type: "foundation", country: "", website: "https://aptosfoundation.org", aliases: ["Aptos"], chainsInUse: ["Aptos"] },
  { name: "Sui Foundation", type: "foundation", country: "", website: "https://sui.io", chainsInUse: ["Sui"] },
  { name: "Avalanche Foundation", type: "foundation", country: "", website: "https://www.avax.network", aliases: ["Avalanche"], chainsInUse: ["Avalanche"] },

  // Banks
  { name: "JPMorgan Chase", type: "bank", country: "US", website: "https://www.jpmorganchase.com", aliases: ["JPMorgan", "J.P. Morgan", "JPM"] },
  { name: "Citi", type: "bank", country: "US", website: "https://www.citigroup.com", aliases: ["Citigroup", "Citibank"] },
  { name: "Goldman Sachs", type: "bank", country: "US", website: "https://www.goldmansachs.com" },
  { name: "HSBC", type: "bank", country: "GB", website: "https://www.hsbc.com" },
  { name: "BBVA", type: "bank", country: "ES", website: "https://www.bbva.com", aliases: ["BBVA México"] },
  { name: "Santander", type: "bank", country: "ES", website: "https://www.santander.com", aliases: ["Banco Santander"] },
  { name: "Banorte", type: "bank", country: "MX", website: "https://www.banorte.com", aliases: ["Grupo Financiero Banorte"] },
  { name: "DBS Bank", type: "bank", country: "SG", website: "https://www.dbs.com", aliases: ["DBS"] },

  // Exchanges
  { name: "Coinbase", type: "exchange", country: "US", website: "https://www.coinbase.com" },
  { name: "Kraken", type: "exchange", country: "US", website: "https://www.kraken.com" },
  { name: "Binance", type: "exchange", country: "", website: "https://www.binance.com" },
  {
    name: "Bitso",
    type: "exchange",
    country: "MX",
    website: "https://bitso.com",
    aliases: ["Juno", "MXNB"],
    notes: "Public: Bitso/Juno issue MXNB, a peso stablecoin minted against SPEI deposits (source: bitso.com/business/products/mxnb-stablecoin).",
  },
  { name: "Mercado Bitcoin", type: "exchange", country: "BR", website: "https://www.mercadobitcoin.com.br" },
  { name: "Ripio", type: "exchange", country: "AR", website: "https://www.ripio.com" },

  // Custodians
  { name: "Anchorage Digital", type: "custodian", country: "US", website: "https://www.anchorage.com", aliases: ["Anchorage"] },
  { name: "BNY", type: "custodian", country: "US", website: "https://www.bny.com", aliases: ["BNY Mellon", "Bank of New York"] },
  { name: "State Street", type: "custodian", country: "US", website: "https://www.statestreet.com" },
  { name: "Fireblocks", type: "custodian", country: "US", website: "https://www.fireblocks.com" },

  // Asset managers
  { name: "BlackRock", type: "asset_manager", country: "US", website: "https://www.blackrock.com" },
  { name: "Franklin Templeton", type: "asset_manager", country: "US", website: "https://www.franklintempleton.com" },
  { name: "Fidelity Investments", type: "asset_manager", country: "US", website: "https://www.fidelity.com", aliases: ["Fidelity"] },
  { name: "WisdomTree", type: "asset_manager", country: "US", website: "https://www.wisdomtree.com" },

  // Market infrastructure
  { name: "CME Group", type: "market_infra", country: "US", website: "https://www.cmegroup.com", aliases: ["CME"] },
  { name: "Intercontinental Exchange", type: "market_infra", country: "US", website: "https://www.ice.com", aliases: ["ICE", "NYSE"] },
  { name: "DTCC", type: "market_infra", country: "US", website: "https://www.dtcc.com" },
  { name: "Nasdaq", type: "market_infra", country: "US", website: "https://www.nasdaq.com" },
  { name: "Swift", type: "market_infra", country: "BE", website: "https://www.swift.com", aliases: ["SWIFT"] },
  { name: "Euroclear", type: "market_infra", country: "BE", website: "https://www.euroclear.com" },

  // Fintech / payment rails
  {
    name: "Mercado Pago",
    type: "fintech",
    country: "",
    website: "https://www.mercadopago.com.mx",
    aliases: ["Mercado Libre", "MercadoLibre", "Meli Dólar", "Meli Dolar"],
    chainsInUse: ["Ethereum"],
    notes: "Public: Meli Dólar (MUSD) stablecoin on Ethereum, custody by Ripio (source: mercadopago.com.mx/blog/integracion-pagos-con-cripto-meli-dolar).",
  },
  { name: "Nubank", type: "fintech", country: "BR", website: "https://nubank.com.br", aliases: ["Nu Holdings", "Nu México"] },
  { name: "Ualá", type: "fintech", country: "AR", website: "https://www.uala.com.ar", aliases: ["Uala"] },
  { name: "Circle", type: "fintech", country: "US", website: "https://www.circle.com", aliases: ["USDC"] },
  { name: "Ripple", type: "fintech", country: "US", website: "https://ripple.com", aliases: ["XRPL", "RLUSD"], chainsInUse: ["XRP Ledger"] },
  { name: "Stripe", type: "fintech", country: "US", website: "https://stripe.com" },

  // Consultancies / advisors / associations
  { name: "Deloitte", type: "advisor", country: "", website: "https://www.deloitte.com" },
  { name: "PwC", type: "advisor", country: "", website: "https://www.pwc.com", aliases: ["PricewaterhouseCoopers"] },
  { name: "EY", type: "advisor", country: "", website: "https://www.ey.com", aliases: ["Ernst & Young"] },
  { name: "KPMG", type: "advisor", country: "", website: "https://kpmg.com" },
  { name: "Accenture", type: "advisor", country: "IE", website: "https://www.accenture.com" },
  { name: "McKinsey & Company", type: "advisor", country: "US", website: "https://www.mckinsey.com", aliases: ["McKinsey"] },
  { name: "Fintech México", type: "advisor", country: "MX", website: "https://www.fintechmexico.org", aliases: ["Fintech Mexico"], notes: "Industry association." },

  // Builders / infrastructure
  { name: "Chainlink Labs", type: "builder", country: "", website: "https://chain.link", aliases: ["Chainlink"] },
  { name: "Alchemy", type: "builder", country: "US", website: "https://www.alchemy.com" },
  { name: "Securitize", type: "builder", country: "US", website: "https://securitize.io" },
];
