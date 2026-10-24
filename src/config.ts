import { BancontactEnvironment, BancontactProduct } from '@dewall88/bancontactpro';
import type { BancontactCredentials, ProductCredentials } from '@dewall88/bancontactpro';

export const PRODUCTS = Object.values(BancontactProduct);

/** Credentials from the environment (or `.env`): BANCONTACT_<PRODUCT>_API_KEY and BANCONTACT_<PRODUCT>_PPID. Read on every call. */
export function readCredentials(env: NodeJS.ProcessEnv = process.env): BancontactCredentials {
  const products: Partial<Record<BancontactProduct, ProductCredentials>> = {};
  for (const product of PRODUCTS) {
    const prefix = `BANCONTACT_${product.toUpperCase()}`;
    const apiKey = env[`${prefix}_API_KEY`]?.trim();
    const merchantProfileId = env[`${prefix}_PPID`]?.trim();
    if (apiKey && merchantProfileId) products[product] = { apiKey, merchantProfileId };
  }

  const environment = env.BANCONTACT_ENVIRONMENT === BancontactEnvironment.Production ? BancontactEnvironment.Production : BancontactEnvironment.Preprod;
  return { environment, products };
}

export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || undefined;
}

export function parseProduct(value: string | null | undefined): BancontactProduct | undefined {
  return PRODUCTS.find((p) => p === value);
}
