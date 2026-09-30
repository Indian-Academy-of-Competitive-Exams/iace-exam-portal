import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { type AppMutationMeta } from '../src';
import { saveBlob } from './save-blob';

/** What Import sends: the plan is always there, the file only when that is where it came from. */
interface Staged<TPlan> {
  file: File | null;
  plan: TPlan;
}

/** The blank sheet every import screen offers before a file exists. */
export interface ImportTemplate {
  fetch: () => Promise<Blob>;
  filename: string;
}

export interface ImportScreenState<TPlan, TResult> {
  file: File | null;
  plan: TPlan | null;
  result: TResult | undefined;
  isPreviewing: boolean;
  isCommitting: boolean;
  /** How many rows Import would write — the button counts these and is enabled by them. */
  writes: number;
  canCommit: boolean;
  choose: (file: File | undefined) => void;
  /** For a plan that came from somewhere other than an upload; clears with both arguments null. */
  stage: (file: File | null, plan?: TPlan | null) => void;
  commit: () => void;
  downloadTemplate: () => void;
  isDownloadingTemplate: boolean;
}

/** Preview, then commit: a plan outliving the file it described commits rows nobody previewed. */
export function useImportScreen<TPlan, TResult>(options: {
  preview: (file: File) => Promise<TPlan>;
  commit: (file: File | null, plan: TPlan) => Promise<TResult>;
  writes: (plan: TPlan) => number;
  template: ImportTemplate;
  success?: string | ((result: TResult) => string);
  onCommitted?: (result: TResult) => void;
}): ImportScreenState<TPlan, TResult> {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<TPlan | null>(null);

  const announce = announcing(options.success);

  const commit = useMutation({
    meta: announce === undefined ? undefined : { success: announce },
    mutationFn: (staged: Staged<TPlan>) => options.commit(staged.file, staged.plan),
    onSuccess: options.onCommitted,
  });

  const preview = useMutation({
    mutationFn: options.preview,
    onSuccess: setPlan,
  });

  const template = useMutation({
    mutationFn: options.template.fetch,
    onSuccess: (blob) => saveBlob(blob, options.template.filename),
  });

  const stage = (next: File | null, staged: TPlan | null = null) => {
    setFile(next);
    setPlan(staged);
    commit.reset();
    preview.reset();
  };

  /** Choosing a file previews it at once — that is why they chose it. */
  const choose = (next: File | undefined) => {
    if (!next) return;
    stage(next);
    preview.mutate(next);
  };

  const writes = plan === null ? 0 : options.writes(plan);

  return {
    file,
    plan,
    result: commit.data,
    isPreviewing: preview.isPending,
    isCommitting: commit.isPending,
    writes,
    // A committed run stays on screen to be read, but pressing Import again would write it twice.
    canCommit: plan !== null && writes > 0 && !commit.isSuccess,
    choose,
    stage,
    commit: () => {
      if (plan !== null) commit.mutate({ file, plan });
    },
    downloadTemplate: () => template.mutate(),
    isDownloadingTemplate: template.isPending,
  };
}

/** The one cast the result type costs: `meta` is read back as `unknown`, so no screen has to cast its own. */
function announcing<TResult>(
  success: string | ((result: TResult) => string) | undefined,
): AppMutationMeta['success'] {
  if (typeof success !== 'function') return success;
  return (data: unknown) => success(data as TResult);
}
