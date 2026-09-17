/**
 * One reviewed question, drawn by the exam's own page in a WebView that stays
 * mounted as the student moves between questions. Nothing here is answerable:
 * the screen goes in locked, and the page posts nothing this view acts on.
 */
/// <reference types="nativewind/types" />
import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { type LanguageCode, type LanguageMode } from '@iace/contracts';
import { QUESTION_PAGE_HTML } from '../../../webview/dist/question-page';
import { showScript } from '../exam/question-protocol';
import { Skeleton } from '../ui/skeleton';
import { reviewScreen, type ReviewedQuestion } from './review-protocol';

/** An inline HTML source loads at about:blank on both platforms, and nothing else may load. */
const PAGE_URL = 'about:blank';
const PAGE = { html: QUESTION_PAGE_HTML };
const EVERY_ORIGIN = ['*'];
const onlyThePage = (request: WebViewNavigation): boolean => request.url === PAGE_URL;

export interface ReviewContentProps {
  question: ReviewedQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
}

export function ReviewContent({ question, languages, languageMode }: Readonly<ReviewContentProps>) {
  const web = useRef<WebView>(null);
  const { fontScale } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [pageKey, setPageKey] = useState(0);
  const script = showScript(reviewScreen({ question, languages, languageMode }));

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(script);
  }, [script, ready]);

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
        onMessage={() => setReady(true)}
        onRenderProcessGone={() => {
          setReady(false);
          setPageKey((key) => key + 1);
        }}
        onContentProcessDidTerminate={() => web.current?.reload()}
      />
      {ready ? null : <ReviewSkeleton />}
    </View>
  );
}

function ReviewSkeleton() {
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
