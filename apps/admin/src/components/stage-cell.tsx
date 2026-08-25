/** The stage a record hangs off, in the column after the record's own name. */
export function StageCell({
  stage,
}: Readonly<{ stage: { examCode: string; name: string } | null }>) {
  if (!stage) return <span className="text-muted-foreground">Any stage</span>;

  return (
    <span className="flex flex-col">
      <span className="font-mono text-sm">{stage.examCode}</span>
      <span className="text-xs text-muted-foreground">{stage.name}</span>
    </span>
  );
}
