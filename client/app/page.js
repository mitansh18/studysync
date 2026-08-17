export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <main className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          StudySync
        </h1>
        <p className="mt-3 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Real-time collaborative study platform.
        </p>

        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Tailwind CSS check
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            If this card has a border, rounded corners, padding, and a shadow,
            Tailwind utility classes are being applied correctly.
          </p>

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Framework
              </dt>
              <dd className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
                Next.js
              </dd>
            </div>
            <div className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Router
              </dt>
              <dd className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
                App Router
              </dd>
            </div>
            <div className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Styling
              </dt>
              <dd className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
                Tailwind CSS
              </dd>
            </div>
          </dl>

          <button
            type="button"
            className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Styled button
          </button>
        </div>

        <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Frontend setup complete
        </p>
      </main>
    </div>
  );
}
