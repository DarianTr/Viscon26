import { Card } from "@/components/ui/primitives";

export function Unavailable({ message }: { message: string }) {
  return (
    <Card>
      <p className="font-semibold">Knowledge data isn&apos;t available right now</p>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <p className="mt-3 text-sm text-muted">
        In development, start the service with <code className="font-mono">npm run db:up</code> and{" "}
        <code className="font-mono">uv run uvicorn knowledge.api:app</code> in <code className="font-mono">services/knowledge</code>,
        or run everything with <code className="font-mono">docker compose up</code>.
      </p>
    </Card>
  );
}
