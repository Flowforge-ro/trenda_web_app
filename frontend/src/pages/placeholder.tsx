export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">În curând</p>
      </header>
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white text-sm text-muted-foreground">
        Conținut indisponibil momentan
      </div>
    </div>
  );
}
