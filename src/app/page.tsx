import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="panel">
        <h1>Architecture Flipbook</h1>
        <p className="mono">Static flipbook mounted to portfolio-compressed.pdf.</p>
        <div className="row" style={{ marginTop: "0.9rem" }}>
          <Link href="/viewer">Open Viewer</Link>
        </div>
      </section>
    </main>
  );
}
