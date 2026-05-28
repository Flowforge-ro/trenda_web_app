import { Button } from "../components/ui/button";
import { LogIn } from "lucide-react";
import { API_BASE } from "../lib/api";

export function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Trendo</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to continue
          </p>
        </div>

        <Button
          className="w-full gap-2"
          size="lg"
          onClick={() => {
            window.location.href = `${API_BASE}/auth/microsoft`;
          }}
        >
          <LogIn className="h-4 w-4" />
          Sign in with Microsoft
        </Button>
      </div>
    </div>
  );
}