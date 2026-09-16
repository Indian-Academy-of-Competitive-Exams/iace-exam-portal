/**
 * A question and its options, drawn by the web's own renderer in ONE WebView
 * that stays mounted while the student moves between questions. It is a view:
 * native state goes in whole on every change, and a tap comes back only as an
 * intent that `readPageMessage` has vouched for.
 */
import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { type ExamQuestion } from '@iace/contracts';
import { QUESTION_PAGE_HTML } from '../../../webview/dist/question-page';
import { Skeleton } from '../ui/skeleton';
import { PAGE_MESSAGE, type QuestionScreen } from './question-bridge';
import { questionScreen, readPageMessage, showScript, type ScreenInput } from './question-protocol';

/** An inline HTML source loads at about:blank on both platforms, and nothing else may load. */
const PAGE_URL = 'about:blank';
const PAGE = { html: QUESTION_PAGE_HTML };
// `*` sends every URL to the refusal below; a narrower list hands the rest to Linking.openURL instead.
const EVERY_ORIGIN = ['*'];
const onlyThePage = (request: WebViewNavigation): boolean => request.url === PAGE_URL;

/** Before the paper lands there is nothing to choose, so only the page's READY gets through. */
const NOTHING_ON_SCREEN: QuestionScreen = {
  template: '',
  bubbling: false,
  locked: false,
  selectedOptionId: null,
  stem: [],
  options: [],
};

export interface QuestionContentProps extends Omit<ScreenInput, 'question'> {
  /** Absent while the paper is on its way: the page still loads, so its cost is not the clock's. */
  question: ExamQuestion | undefined;
  onSelect: (optionId: string) => void;
  onBubble: (optionId: string, fill: number) => void;
}

export function QuestionContent({
  onSelect,
  onBubble,
  question,
  ...input
}: Readonly<QuestionContentProps>) {
  const web = useRef<WebView>(null);
  const { fontScale } = useWindowDimensions();
  // Bumped when the page says it is ready and after every intent, so the page redraws native's truth.
  const [echo, setEcho] = useState(0);
  const [pageKey, setPageKey] = useState(0);
  const screen = question ? questionScreen({ ...input, question }) : NOTHING_ON_SCREEN;
  const script = question ? showScript(screen) : null;

  useEffect(() => {
    if (echo > 0 && script) web.current?.injectJavaScript(script);
  }, [script, echo]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = readPageMessage(event.nativeEvent.data, screen);
    if (message?.type === PAGE_MESSAGE.CHOOSE) onSelect(message.optionId);
    if (message?.type === PAGE_MESSAGE.BUBBLE) onBubble(message.optionId, message.fill);
    if (message) setEcho((count) => count + 1);
  };

  return (
    <View className="flex-1">
      <WebView
        key={pageKey}
        ref={web}
        source={PAGE}
        originWhitelist={EVERY_ORIGIN}
        onShouldStartLoadWithRequest={onlyThePage}
        setSupportMultipleWindows={false}
        textZoom={Math.round(fontScale * 100)}
        onMessage={onMessage}
        onRenderProcessGone={() => setPageKey((key) => key + 1)}
        onContentProcessDidTerminate={() => web.current?.reload()}
      />
      {echo === 0 || !question ? <QuestionSkeleton /> : null}
    </View>
  );
}

function QuestionSkeleton() {
  return (
    <View className="absolute inset-0 gap-3 bg-surface p-4">
      <Skeleton className="h-5 w-full rounded-md" />
      <Skeleton className="h-5 w-2/3 rounded-md" />
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-12 rounded-lg" />
      ))}
    </View>
  );
}
