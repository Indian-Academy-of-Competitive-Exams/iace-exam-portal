import { type Branch } from '@iace/contracts';
import { Combobox, Field } from '@iace/ui';

/** One reachable branch is not a choice, so it is not offered — the heading already names it. */
export function BranchPicker({
  branches,
  value,
  onChange,
}: Readonly<{ branches: readonly Branch[]; value: string; onChange: (next: string) => void }>) {
  if (branches.length < 2) return null;

  return (
    <Field htmlFor="standing-branch" label="Branch" className="mb-4 w-64">
      {(control) => (
        <Combobox
          {...control}
          clearable={false}
          value={value}
          onChange={onChange}
          items={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
        />
      )}
    </Field>
  );
}
