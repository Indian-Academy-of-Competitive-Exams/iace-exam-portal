/** The exam's own question page, locked to itself: nothing else loads, no window opens, and a crashed page comes back. */
import { useState, type RefObject } from 'react';
import { useWindowDimensions } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { QUESTION_PAGE_HTML } from '../../../webview/dist/question-page';

/** An inline HTML source loads at about:blank on both platforms, and nothing else may load. */
const PAGE_URL = 'about:blank';
const PAGE = { html: QUESTION_PAGE_HTML };
// `*` sends every URL to the refusal below; a narrower list hands the rest to Linking.openURL instead.
const EVERY_ORIGIN = ['*'];
const onlyThePage = (request: WebViewNavigation): boolean => request.url === PAGE_URL;

export function QuestionPageView({
  ref,
  onMessage,
  onPageLost,
}: Readonly<{
  ref: RefObject<WebView | null>;
  onMessage: (event: WebViewMessageEvent) => void;
  /** Either crash: the page comes back empty and says READY again, so what it showed must be sent again. */
  onPageLost: () => void;
}>) {
  const { fontScale } = useWindowDimensions();
  const [pageKey, setPageKey] = useState(0);

  return (
    <WebView
      key={pageKey}
      ref={ref}
      source={PAGE}
      originWhitelist={EVERY_ORIGIN}
      onShouldStartLoadWithRequest={onlyThePage}
      setSupportMultipleWindows={false}
      textZoom={Math.round(fontScale * 100)}
      onMessage={onMessage}
      onRenderProcessGone={() => {
        onPageLost();
        setPageKey((key) => key + 1);
      }}
      onContentProcessDidTerminate={() => {
        onPageLost();
        ref.current?.reload();
      }}
    />
  );
}
