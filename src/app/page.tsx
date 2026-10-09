import { ItemsPanel } from "@/components/items-panel";

const endpoints = [
  ["GET", "/api/health", "Liveness check"],
  ["GET", "/api/items", "List items"],
  ["POST", "/api/items", "Create an item — { title }"],
  ["GET", "/api/items/:id", "Read one item"],
  ["PATCH", "/api/items/:id", "Update an item — { title?, done? }"],
  ["DELETE", "/api/items/:id", "Delete an item"],
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Viscon26</h1>
      <p className="mt-2 text-sm opacity-60">
        Next.js app with the frontend in <code>src/app</code> and the backend in{" "}
        <code>src/app/api</code>.
      </p>

      <div className="mt-10">
        <ItemsPanel />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">API</h2>
        <ul className="mt-3 font-mono text-xs">
          {endpoints.map(([method, path, description]) => (
            <li
              key={`${method} ${path}`}
              className="flex flex-wrap items-baseline gap-x-3 border-b border-black/10 py-2 last:border-0 dark:border-white/10"
            >
              <span className="w-16 font-semibold">{method}</span>
              <span>{path}</span>
              <span className="opacity-50">{description}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
