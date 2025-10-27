export function MessageSkeleton() {
  return (
    <div className="flex animate-pulse items-end space-x-2">
      <div className="bg-muted h-8 w-8 rounded-full" />
      <div className="bg-muted max-w-xs space-y-2 rounded-lg p-3">
        <div className="bg-muted-foreground/20 h-4 w-32 rounded" />
      </div>
    </div>
  );
}
