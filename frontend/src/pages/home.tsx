import { useQuery } from "@tanstack/react-query";
import { Button } from "../components/ui/button";

async function fetchHealthCheck() {
  const res = await fetch("http://localhost:3000/health");
  if (!res.ok) throw new Error("API not available");
  return res.json();
}

export function HomePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealthCheck,
    retry: false,
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold">Trenda</h1>
      <p className="text-muted-foreground">
        React + Vite + Fastify + Prisma
      </p>
      <div className="flex gap-4">
        <Button>Get Started</Button>
        <Button variant="outline">Learn More</Button>
      </div>
      <div className="mt-4 text-sm text-muted-foreground">
        {isLoading && "Checking API..."}
        {error && "API offline"}
        {data && `API: ${data.status}`}
      </div>
    </div>
  );
}
