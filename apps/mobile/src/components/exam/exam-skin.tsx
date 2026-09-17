/**
 * The phone's one skin. It renders an ExamView and holds no answer, no clock and
 * no mutation: every move is a `view.*` call. It mounts before the view exists,
 * so the question renderer loads while the paper is still on its way; the
 * confirmation and the focus warning live here, as ExamShell holds them on the web.
 */
import { Fragment, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXAM_TEMPLATE, LANGUAGE_MODE, TEST_UI, type ExamQuestion } from '@iace/contracts';
import { type ExamView } from '@iace/app-kit';
import { cn } from '../../lib/cn';
import { plural } from '../../lib/plural';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Skeleton } from '../ui/skeleton';
import { ExamTimer, SectionTimer } from './exam-timer';
import { QuestionContent, type QuestionContentProps } from './question-content';
import { QuestionPalette } from './question-palette';

/** Every paper resolves to the default skin on a phone, whatever its template says. */
const MOBILE_SKIN = EXAM_TEMPLATE.DEFAULT;

/** Before the paper lands: the page loads and waits, and a tap has nothing to reach. */
const WAITING: QuestionContentProps = {
  question: undefined,
  paperQuestions: [],
  languages: [],
  languageMode: LANGUAGE_MODE.SINGLE,
  testUi: TEST_UI.CBT,
  examTemplate: MOBILE_SKIN,
  selectedOptionId: null,
  marked: false,
  onSelect: () => undefined,
  onBubble: () => undefined,
};

/** Enough repeats to reach the corners of a tall phone without measuring it. */
const WATERMARK_TILES = Array.from({ length: 24 }, (_, index) => index);

export interface ExamSkinProps {
  view: ExamView | null;
  /** The paper's full question list, all sections, so a dead zone still shows a figure not yet reached. */
  paperQuestions: readonly ExamQuestion[];
}

export function ExamSkin({ view, paperQuestions }: Readonly<ExamSkinProps>) {
  const insets = useSafeAreaInsets();
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <View
      // The class scopes the exam tokens, as `data-exam-template` does on the web.
      className="exam-template-default flex-1 bg-exam-surface"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {view ? <SittingHead view={view} onPalette={() => setPaletteOpen(true)} /> : <OpeningBar />}
      <QuestionBody view={view} paperQuestions={paperQuestions} />
      {view ? (
        <SittingFoot
          view={view}
          paletteOpen={paletteOpen}
          onClosePalette={() => setPaletteOpen(false)}
        />
      ) : null}
    </View>
  );
}

function OpeningBar() {
  return (
    <View
      accessibilityLabel="Opening your paper"
      className="flex-row items-center gap-2 border-b border-exam-border px-4 py-2"
    >
      <Skeleton className="h-11 w-20 rounded-exam-option" />
      <View className="flex-1" />
      <Skeleton className="h-11 w-40 rounded-md" />
    </View>
  );
}

function SittingHead({ view, onPalette }: Readonly<{ view: ExamView; onPalette: () => void }>) {
  return (
    <Fragment>
      <View className="flex-row flex-wrap items-center justify-between gap-2 border-b border-exam-border px-4 py-2">
        <ExamTimer clock={view.clock} onExpire={view.outOfTime} />
        <View className="flex-row gap-2">
          <Button variant="outline" onPress={onPalette}>
            Question palette
          </Button>
          <Button variant="outline" loading={view.submit.isPending} onPress={view.submit.ask}>
            Submit
          </Button>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="grow-0 border-b border-exam-border"
        contentContainerClassName="px-2"
      >
        {view.sections.map((section) => (
          <SectionTab
            key={section.id}
            name={section.name}
            active={section.id === view.sectionId}
            reachable={view.reachable.includes(section.id)}
            onOpen={() => view.openSection(section.id)}
          />
        ))}
      </ScrollView>

      {view.hasUnsaved ? (
        <Alert variant="warning" className="mx-4 mt-2">
          Your latest answers are not saved yet. They are kept on this phone and sent when the
          connection is back, but the clock does not wait.
        </Alert>
      ) : null}

      <View className="flex-row items-center gap-3 px-4 py-2">
        {view.question ? (
          <Text className="text-sm font-semibold text-exam-ink">
            {`Question ${view.questionIndex + 1} of ${view.questions.length}`}
          </Text>
        ) : null}
        {view.isSaving ? <Text className="text-xs text-exam-ink-muted">Saving…</Text> : null}
        <View className="flex-1" />
        {view.sectionSec ? (
          <SectionTimer
            key={view.sectionId}
            allowedSec={view.sectionSec}
            onExpire={view.endSection}
          />
        ) : null}
      </View>
    </Fragment>
  );
}

function SectionTab({
  name,
  active,
  reachable,
  onOpen,
}: Readonly<{ name: string; active: boolean; reachable: boolean; onOpen: () => void }>) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled: !reachable }}
      disabled={active || !reachable}
      onPress={onOpen}
      className={cn(
        'h-11 justify-center border-b-2 px-3',
        active ? 'border-exam-current' : 'border-transparent',
        !reachable && 'opacity-50',
      )}
    >
      <Text
        className={cn('text-sm', active ? 'font-semibold text-exam-ink' : 'text-exam-section-ink')}
      >
        {name}
      </Text>
    </Pressable>
  );
}

function QuestionBody({
  view,
  paperQuestions,
}: Readonly<{ view: ExamView | null; paperQuestions: readonly ExamQuestion[] }>) {
  return (
    <View className="relative flex-1">
      {/* One slot, one type in both branches: React keeps the same WebView when the paper lands. */}
      {view ? (
        <QuestionContent
          question={view.question}
          paperQuestions={paperQuestions}
          languages={view.languages}
          languageMode={view.languageMode}
          testUi={view.testUi}
          examTemplate={MOBILE_SKIN}
          selectedOptionId={view.selectedOptionId}
          marked={view.marked}
          onSelect={view.chooseOption}
          onBubble={view.bubbleAnswer}
        />
      ) : (
        <QuestionContent {...WAITING} paperQuestions={paperQuestions} />
      )}

      {view && !view.question ? (
        <View className="absolute inset-0 bg-exam-surface p-4">
          <Alert>This section is closed.</Alert>
        </View>
      ) : null}

      {view?.watermark ? <PaperWatermark text={view.watermark} /> : null}
    </View>
  );
}

/** The one thing on the paper that leads back to a person, faint enough to read through. */
function PaperWatermark({ text }: Readonly<{ text: string }>) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="pointer-events-none absolute inset-0 flex-row flex-wrap content-around justify-around overflow-hidden"
    >
      {WATERMARK_TILES.map((tile) => (
        <Text
          key={tile}
          className="w-1/3 -rotate-45 py-6 text-center text-xs text-exam-ink opacity-5"
        >
          {text}
        </Text>
      ))}
    </View>
  );
}

function SittingFoot({
  view,
  paletteOpen,
  onClosePalette,
}: Readonly<{ view: ExamView; paletteOpen: boolean; onClosePalette: () => void }>) {
  const { submit, fullscreen } = view;

  return (
    <Fragment>
      <View className="gap-2 border-t border-exam-border px-4 py-2">
        {/* On a bubble sheet the ink carries all three: a part fill flags it, a full one saves and moves. */}
        {view.testUi === TEST_UI.OMR ? (
          <Button onPress={view.nextQuestion}>Next</Button>
        ) : (
          <Fragment>
            <View className="flex-row gap-2">
              <Button variant="outline" className="flex-1" onPress={view.markAndNext}>
                Mark for review & next
              </Button>
              <Button variant="ghost" onPress={view.clearResponse}>
                Clear response
              </Button>
            </View>
            <Button onPress={view.nextQuestion}>Save & next</Button>
          </Fragment>
        )}
      </View>

      {/* iOS presents one Modal at a time, so the focus warning stands the other two down. */}
      <QuestionPalette
        view={view}
        open={paletteOpen && !fullscreen.nagging}
        onClose={onClosePalette}
      />

      <ConfirmDialog
        open={submit.asking && !fullscreen.nagging}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Submit this test?"
        description={`${plural(submit.unanswered, 'question')} unanswered and ${submit.markedForReview} marked for review. Once submitted the paper closes and nothing more can be changed.`}
        confirmLabel="Submit"
        loading={submit.isPending}
        onConfirm={submit.confirm}
        onCancel={submit.cancel}
      />

      <Modal
        transparent
        visible={fullscreen.nagging}
        animationType="fade"
        onRequestClose={fullscreen.enter}
      >
        <View className="flex-1 justify-center gap-4 bg-exam-surface p-6">
          <Alert variant="danger">
            {`${leftTheApp(fullscreen.exits)} Your paper is still running and the clock has not stopped.`}
          </Alert>
          <Button onPress={fullscreen.enter}>Return to the paper</Button>
        </View>
      </Modal>
    </Fragment>
  );
}

/** Said once without a count, because "1 times" is how a screen tells a student it is a machine. */
function leftTheApp(exits: number): string {
  return exits > 1 ? `You left the app ${exits} times.` : 'You left the app.';
}
