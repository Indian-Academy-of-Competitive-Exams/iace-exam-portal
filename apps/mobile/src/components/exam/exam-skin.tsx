/**
 * The phone's one skin. It renders an ExamView and holds no answer, no clock and
 * no mutation: every move is a `view.*` call. It mounts before the view exists,
 * so the question renderer loads while the paper is still on its way; the
 * confirmation and the focus warning live here, as ExamShell holds them on the web.
 */
import { Fragment, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { type LucideIcon } from 'lucide-react-native';
import Calculator from 'lucide-react-native/icons/calculator';
import FileText from 'lucide-react-native/icons/file-text';
import Info from 'lucide-react-native/icons/info';
import Pause from 'lucide-react-native/icons/pause';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import { useUnstableNativeVariable } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkState } from 'expo-network';
import { EXAM_TEMPLATE, LANGUAGE_MODE, TEST_UI, type ExamQuestion } from '@iace/contracts';
import {
  answersByKeyboard,
  PAPER_LOCK,
  PAUSE_SAYS,
  sectionTally,
  submittingSays,
  TIMER_KIND,
  usePause,
  type ExamView,
} from '@iace/app-kit';
import { cn } from '../../lib/cn';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Skeleton } from '../ui/skeleton';
import { ExamTimer, SectionTimer } from './exam-timer';
import { QuestionContent, type QuestionContentProps } from './question-content';
import { CalculatorSheet, PaperSheet, RulesSheet } from './exam-sheets';
import { PaperWatermark } from './paper-watermark';
import { QuestionPalette } from './question-palette';
import Send from 'lucide-react-native/icons/send';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import Flag from 'lucide-react-native/icons/flag';
import Eraser from 'lucide-react-native/icons/eraser';

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

export interface ExamSkinProps {
  view: ExamView | null;
  /** The paper's full question list, all sections, so a dead zone still shows a figure not yet reached. */
  paperQuestions: readonly ExamQuestion[];
  calculatorEnabled: boolean;
  /** Leaves the paper to be come back to; the server gives the time away back when it is reopened. */
  onPause: () => Promise<boolean>;
}

export function ExamSkin({
  view,
  paperQuestions,
  calculatorEnabled,
  onPause,
}: Readonly<ExamSkinProps>) {
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const pause = usePause(onPause);
  const offline = network.isConnected === false || network.isInternetReachable === false;

  return (
    <View
      // The class scopes the exam tokens, as `data-exam-template` does on the web.
      className="exam-template-default flex-1 bg-exam-surface"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {view ? (
        <SittingHead
          view={view}
          onPalette={() => setPaletteOpen(true)}
          onRules={() => setRulesOpen(true)}
          onPaper={() => setPaperOpen(true)}
          onCalculator={calculatorEnabled ? () => setCalculating(true) : undefined}
          onPause={pause.ask}
        />
      ) : (
        <OpeningBar />
      )}
      {view && (view.hasUnsaved || offline) ? (
        <Alert variant="warning" className="mx-4 mt-2">
          {offline
            ? 'Your connection is offline. You can continue the test; answers will sync when it returns. Keep this app open.'
            : 'Your answers have not reached the server yet. They will be retried automatically. Keep this app open.'}
        </Alert>
      ) : null}
      <QuestionBody view={view} paperQuestions={paperQuestions} />
      {view ? (
        <SittingFoot
          view={view}
          paletteOpen={paletteOpen}
          rulesOpen={rulesOpen}
          onCloseRules={() => setRulesOpen(false)}
          paperOpen={paperOpen}
          onClosePaper={() => setPaperOpen(false)}
          calculating={calculating}
          onCloseCalculator={() => setCalculating(false)}
          onClosePalette={() => setPaletteOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        // iOS presents one Modal at a time, so the focus warning stands this one down.
        open={pause.asking && view !== null && !view.fullscreen.nagging}
        title={PAUSE_SAYS.title}
        description={pause.says}
        confirmLabel={PAUSE_SAYS.confirm}
        icon={Pause}
        loading={pause.pending}
        onConfirm={pause.confirm}
        onCancel={pause.cancel}
      />
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

function SittingClock({ view: { timer } }: Readonly<{ view: ExamView }>) {
  return timer.kind === TIMER_KIND.SECTION ? (
    <SectionTimer key={timer.key} allowedSec={timer.allowedSec} onExpire={timer.onExpire} />
  ) : (
    <ExamTimer clock={timer.clock} onExpire={timer.onExpire} />
  );
}

function SittingHead({
  view,
  onPalette,
  onRules,
  onPaper,
  onCalculator,
  onPause,
}: Readonly<{
  view: ExamView;
  onPalette: () => void;
  onRules: () => void;
  onPaper: () => void;
  onCalculator: (() => void) | undefined;
  onPause: () => void;
}>) {
  return (
    <Fragment>
      <View className="flex-row items-center gap-1 border-b border-exam-border pl-4 pr-2">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-semibold text-exam-ink">
          {view.title}
        </Text>
        <HeadIcon icon={FileText} label="Question paper" onPress={onPaper} />
        <HeadIcon icon={Info} label="Instructions" onPress={onRules} />
        {onCalculator ? (
          <HeadIcon icon={Calculator} label="Calculator" onPress={onCalculator} />
        ) : null}
        <HeadIcon icon={Pause} label="Pause" disabled={view.locked !== null} onPress={onPause} />
      </View>

      <View className="flex-row items-center justify-between gap-2 border-b border-exam-border px-4 py-2">
        <SittingClock view={view} />
        <View className="flex-row gap-2">
          <Button variant="outline" icon={LayoutGrid} onPress={onPalette}>
            Palette
          </Button>
          <Button
            variant="outline"
            icon={Send}
            loading={view.submit.isPending}
            disabled={view.locked !== null}
            onPress={view.submit.ask}
          >
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
            tally={sectionTally(view.sectionCounts(section.id))}
            active={section.id === view.sectionId}
            reachable={view.locked === null && view.reachable.includes(section.id)}
            onOpen={() => view.openSection(section.id)}
          />
        ))}
      </ScrollView>

      <View className="flex-row items-center gap-3 px-4 py-2">
        {view.question ? (
          <Text className="text-sm font-semibold text-exam-ink">
            {`Question ${view.questionIndex + 1} of ${view.questions.length}`}
          </Text>
        ) : null}
        {view.isSaving ? <Text className="text-xs text-exam-ink-muted">Saving…</Text> : null}
        {view.locked === PAPER_LOCK.WAITING ? (
          <Text className="text-xs text-exam-ink-muted">Opening your paper…</Text>
        ) : null}
      </View>
    </Fragment>
  );
}

function HeadIcon({
  icon: Icon,
  label,
  disabled,
  onPress,
}: Readonly<{ icon: LucideIcon; label: string; disabled?: boolean; onPress: () => void }>) {
  const ink = useUnstableNativeVariable('--foreground');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      className={cn('h-11 w-11 items-center justify-center', disabled && 'opacity-50')}
    >
      <Icon size={20} color={typeof ink === 'string' ? ink : undefined} />
    </Pressable>
  );
}

function SectionTab({
  name,
  tally,
  active,
  reachable,
  onOpen,
}: Readonly<{
  name: string;
  tally: string;
  active: boolean;
  reachable: boolean;
  onOpen: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled: !reachable }}
      disabled={active || !reachable}
      onPress={onOpen}
      className={cn(
        'min-h-11 justify-center border-b-2 px-3 py-1',
        active ? 'border-exam-current' : 'border-transparent',
        !reachable && 'opacity-50',
      )}
    >
      <Text
        className={cn('text-sm', active ? 'font-semibold text-exam-ink' : 'text-exam-section-ink')}
      >
        {name}
      </Text>
      {tally ? <Text className="text-xs text-exam-ink-muted">{tally}</Text> : null}
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

      {/* Over the page, not in it: the options are the WebView's, and it draws none of them shut. */}
      {view?.question && view.locked !== null ? (
        <View className="absolute inset-0 bg-exam-surface opacity-50" />
      ) : null}

      {view?.watermark ? <PaperWatermark text={view.watermark} /> : null}
    </View>
  );
}

function SittingFoot({
  view,
  paletteOpen,
  onClosePalette,
  rulesOpen,
  onCloseRules,
  paperOpen,
  onClosePaper,
  calculating,
  onCloseCalculator,
}: Readonly<{
  view: ExamView;
  paletteOpen: boolean;
  onClosePalette: () => void;
  rulesOpen: boolean;
  onCloseRules: () => void;
  paperOpen: boolean;
  onClosePaper: () => void;
  calculating: boolean;
  onCloseCalculator: () => void;
}>) {
  const { submit, fullscreen } = view;
  const off = view.locked !== null;

  return (
    <Fragment>
      <View className="gap-2 border-t border-exam-border px-4 py-2">
        {submit.failed ? (
          <Fragment>
            <Alert variant="danger">Could not submit this paper.</Alert>
            <Button variant="outline" icon={RotateCw} onPress={submit.retry}>
              Try again
            </Button>
          </Fragment>
        ) : null}
        {/* On a bubble sheet the ink carries all three: a part fill flags it, a full one saves and moves. */}
        {view.testUi === TEST_UI.OMR ? (
          <Button disabled={off} icon={ArrowRight} onPress={view.nextQuestion}>
            Next
          </Button>
        ) : (
          <Fragment>
            <View className="flex-row gap-2">
              {view.forwardOnly ? null : (
                <Button
                  variant="outline"
                  className="flex-1"
                  icon={Flag}
                  disabled={off}
                  onPress={view.markAndNext}
                >
                  Mark for review & next
                </Button>
              )}
              <Button
                variant="ghost"
                icon={Eraser}
                disabled={off || answersByKeyboard(view.question)}
                onPress={view.clearResponse}
              >
                Clear response
              </Button>
            </View>
            <Button disabled={off} icon={ArrowRight} onPress={view.nextQuestion}>
              Save & next
            </Button>
          </Fragment>
        )}
      </View>

      {/* iOS presents one Modal at a time, so the focus warning stands the others down. */}
      <QuestionPalette
        view={view}
        open={paletteOpen && !fullscreen.nagging}
        onClose={onClosePalette}
      />

      <ConfirmDialog
        open={submit.asking && !fullscreen.nagging}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Submit this test?"
        description={submittingSays(view)}
        confirmLabel="Submit"
        icon={Send}
        loading={submit.isPending}
        onConfirm={submit.confirm}
        onCancel={submit.cancel}
      />

      <RulesSheet view={view} open={rulesOpen && !fullscreen.nagging} onClose={onCloseRules} />
      <PaperSheet view={view} open={paperOpen && !fullscreen.nagging} onClose={onClosePaper} />
      <CalculatorSheet open={calculating && !fullscreen.nagging} onClose={onCloseCalculator} />

      <Modal
        transparent
        visible={fullscreen.nagging}
        animationType="fade"
        onRequestClose={fullscreen.ignore}
      >
        <View className="flex-1 justify-center gap-4 bg-exam-surface p-6">
          <Alert variant="danger">
            {`${leftTheApp(fullscreen.exits)} Your paper is still running and the clock has not stopped.`}
          </Alert>
          <Button icon={FileText} onPress={fullscreen.ignore}>
            Return to the paper
          </Button>
        </View>
      </Modal>
    </Fragment>
  );
}

/** Said once without a count, because "1 times" is how a screen tells a student it is a machine. */
function leftTheApp(exits: number): string {
  return exits > 1 ? `You left the app ${exits} times.` : 'You left the app.';
}
