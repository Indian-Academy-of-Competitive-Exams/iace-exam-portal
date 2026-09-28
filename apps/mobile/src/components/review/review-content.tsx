/**
 * One reviewed question, drawn by the exam's own page in a WebView that stays
 * mounted as the student moves between questions. Nothing here is answerable:
 * the screen goes in locked, and the page posts nothing this view acts on.
 */
/// <reference types="nativewind/types" />
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { type WebView } from 'react-native-webview';
import { type LanguageCode, type LanguageMode } from '@iace/contracts';
import { showScript } from '../exam/question-protocol';
import { QuestionPageView } from '../exam/question-page-view';
import { Skeleton } from '../ui/skeleton';
import { type ReviewedQuestion } from '@iace/app-kit';
import { reviewScreen } from './review-protocol';

export interface ReviewContentProps {
  question: ReviewedQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
}

export function ReviewContent({ question, languages, languageMode }: Readonly<ReviewContentProps>) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const script = showScript(reviewScreen({ question, languages, languageMode }));

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(script);
  }, [script, ready]);

  return (
    <View className="flex-1">
      <QuestionPageView
        ref={web}
        onMessage={() => setReady(true)}
        onPageLost={() => setReady(false)}
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
