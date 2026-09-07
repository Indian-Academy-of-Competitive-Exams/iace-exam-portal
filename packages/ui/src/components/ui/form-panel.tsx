import * as React from 'react';
import { cn } from '../../lib/utils';
import { Card } from './card';
import { Separator } from './separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

export interface FormPanelTab {
  value: string;
  label: string;
  content: React.ReactNode;
  /** A tab that saves itself: outside the fieldset and without the footer, so read-only never freezes it. */
  standalone?: boolean;
}

export interface FormPanelTabs {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly FormPanelTab[];
}

export interface FormPanelProps {
  /** Pinned above the card — a `PageHeader` and its trail. */
  header?: React.ReactNode;
  /** Pinned inside the card, below the scroll — the form's own Save and Cancel. */
  footer?: React.ReactNode;
  /** Makes the card a real `<form>`, so Enter submits and the footer button can be `type="submit"`. */
  onSubmit?: NonNullable<React.FormHTMLAttributes<HTMLFormElement>['onSubmit']>;
  /** Read-only: the same layout, every control inert. The footer stays live, so Edit is reachable. */
  disabled?: boolean;
  /** Below the fields behind a divider, OUTSIDE the fieldset — a section Edit does not own. */
  after?: React.ReactNode;
  /** Views of ONE record. The form spans every tab that is not `standalone`, under one footer. */
  tabs?: FormPanelTabs;
  children?: React.ReactNode;
  className?: string;
}

// `relative` is load-bearing: a static scroller lets an sr-only legend escape and grow the doc.
const BODY = 'relative flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6';

const FormDisabled = React.createContext(false);

/** For a control a `<fieldset disabled>` cannot reach — a contenteditable is not a form control. */
export function useFormDisabled(): boolean {
  return React.useContext(FormDisabled);
}

/** A page that is ONE thing. Replaces `PageFrame`; nesting the two would be two scrollports. */
export function FormPanel({
  header,
  footer,
  onSubmit,
  disabled,
  after,
  tabs,
  children,
  className,
}: Readonly<FormPanelProps>) {
  const inForm = (content: React.ReactNode) => (
    // A fieldset disables every control under it natively; `contents` keeps it out of the layout.
    <fieldset disabled={disabled} className="contents">
      <FormDisabled.Provider value={disabled ?? false}>{content}</FormDisabled.Provider>
    </fieldset>
  );

  const plain = (
    <div className={cn(BODY, className)}>
      {inForm(children)}
      {after ? (
        <>
          <Separator />
          {after}
        </>
      ) : null}
    </div>
  );

  const strip = tabs ? (
    <>
      {/* The rule runs the card's full width, so the strip reads as the card's own edge. */}
      <div className="shrink-0 border-b border-border px-6 pt-4">
        <TabsList className="border-b-0">
          {tabs.items.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.items.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          // A form tab stays mounted: its values and its errors outlive a look at another tab.
          forceMount={tab.standalone ? undefined : true}
          className={cn(BODY, 'pt-6', className)}
        >
          {tab.standalone ? tab.content : inForm(tab.content)}
        </TabsContent>
      ))}
    </>
  ) : null;

  const body = tabs ? (
    <Tabs
      value={tabs.value}
      onValueChange={tabs.onValueChange}
      className="flex min-h-0 flex-1 flex-col"
    >
      {strip}
    </Tabs>
  ) : (
    plain
  );

  // A tab that saves itself owns no part of the form, so the form's Save has nothing to do there.
  const onStandalone = tabs?.items.some((tab) => tab.value === tabs.value && tab.standalone);
  const foot =
    footer && !onStandalone ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
        {footer}
      </div>
    ) : null;

  return (
    <div data-page-frame className="flex min-h-0 flex-1 flex-col">
      {header ? <div className="shrink-0">{header}</div> : null}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {onSubmit ? (
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            {body}
            {foot}
          </form>
        ) : (
          <>
            {body}
            {foot}
          </>
        )}
      </Card>
    </div>
  );
}

export interface FormSectionProps {
  title: string;
  /** A value the section is summing up. Never a sentence about what the section is. */
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** One group inside the panel. A heading and spacing, never a border — see the card rule. */
export function FormSection({ title, meta, children, className }: Readonly<FormSectionProps>) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {meta ? <p className="mt-1 text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      {children}
    </section>
  );
}
