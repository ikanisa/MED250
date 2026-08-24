import { marketplaceMessage } from "../lib/marketplace-messages";

export default function Loading() {
  return <main className="state-page state-loading" aria-live="polite" aria-busy="true"><div><span>{marketplaceMessage("inventory.89663747d7bc")}</span><h1>{marketplaceMessage("inventory.7b580d07d3ed")}</h1><p>{marketplaceMessage("inventory.697e2082d670")}</p><i aria-hidden="true" /></div></main>;
}
