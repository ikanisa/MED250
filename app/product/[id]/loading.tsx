export default function ProductLoading() {
  return <main className="product-route-loading" role="status" aria-live="polite" aria-busy="true">
    <section className="product-route-loading-shell">
      <div className="product-route-loading-media" aria-hidden="true"><span /></div>
      <div className="product-route-loading-copy">
        <small>MED+250</small>
        <h1>Opening product details…</h1>
        <p>Preparing current product information and images.</p>
        <div aria-hidden="true"><span /><span /><span /></div>
      </div>
    </section>
  </main>;
}
