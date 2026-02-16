import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="nt-card max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 inline-flex rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          404
        </div>
        <h1 className="nt-title-display text-3xl text-[var(--foreground)] sm:text-4xl">
          This page is not available.
        </h1>
        <p className="mt-3 text-sm font-medium text-[var(--muted)]">
          The link may be outdated, or the page may have been moved.
        </p>
        <div className="mt-6">
          <Link href="/" className="nt-btn nt-btn-accent">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
