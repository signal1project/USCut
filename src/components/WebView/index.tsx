import {
  ForwardedRef,
  forwardRef,
  memo,
  useEffect,
  useRef,
  useState,
} from 'react';
import { generateUUID } from '../../utils';
import styles from './webView.module.scss';
// antd Spin removed — using native spinner below
import { PlatType } from '../../../commont/AccountEnum';

interface ICookieParams {
  cookies?: unknown[];
  userAgent?: string;
  proxy?: string;
  [key: string]: unknown;
}

interface AccountInfo {
  type: PlatType;
  account?: string;
  nickname?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface IWebViewRef {}

export interface IWebViewProps {
  url: string;
  cookieParams?: ICookieParams;
  // 是否开启沙盒化模式
  partition?: boolean | string;
  account?: AccountInfo;
  allowpopups?: boolean;
}

const WebView = memo(
  forwardRef(
    (
      { url, cookieParams, partition, account, allowpopups }: IWebViewProps,
      _ref: ForwardedRef<IWebViewRef>,
    ) => {
      const webviewRef = useRef<HTMLWebViewElement>(null);
      // webView id — a ref (not state) because it's only read by the unmount
      // cleanup below, which needs the current value, not a stale mount-time
      // closure (id is only known after the async 'dom-ready' handler fires)
      const webViewIdRef = useRef(-1);
      const [loading, setLoading] = useState(true);
      // 隔离ID
      const partitionId = useRef(generateUUID());

      useEffect(() => {
        console.log(cookieParams);
        console.log(JSON.stringify(cookieParams));
        setLoading(true);

        webviewRef.current?.addEventListener('dom-ready', async (_e) => {
          // 每个平台localStorage添加
          if (account) {
            let jsCode;
            if (account?.type === PlatType.Douyin) {
              jsCode = `
                localStorage.setItem('douyin_web_hide_guide', '1');
                localStorage.setItem('user_info', '{"uid":"${account.account}","nickname":"${account.nickname}","avatarUrl":"${account.avatar}"}');
                localStorage.setItem('useShortcut2', '{"Wed Mar 12 2025":false}');
              `;
            }
            // @ts-ignore
            webviewRef.current!.executeJavaScript(jsCode);
          }

          // @ts-ignore
          if (webviewRef.current?.getURL() === 'about:blank') {
            // @ts-ignore
            const id = webviewRef.current!.getWebContentsId();
            webViewIdRef.current = id;

            // @ts-ignore
            await window.ipcRenderer.invoke('ICP_ACCOUNT_CREATE_BROWSER_VIEW', {
              webViewId: id,
              cookieParams,
            });
          }
          setLoading(false);
        });

        return () => {
          window.ipcRenderer.invoke(
            'ICP_ACCOUNT_DESTROY_BROWSER_VIEW',
            webViewIdRef.current,
          );
        };
        // dom-ready listener + cleanup are wired once per webview instance by design;
        // account/cookieParams are read at listener-fire time via closure, not meant
        // to re-subscribe on every change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return (
        url && (
          <div className={styles.webview}>
            <div
              style={{ position: 'relative', width: '100%', height: '100%' }}
            >
              {loading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.4)',
                    zIndex: 10,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      border: '3px solid #34d399',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.75s linear infinite',
                    }}
                  />
                </div>
              )}
              <webview
                // @ts-ignore
                disablewebsecurity={'true'}
                ref={webviewRef}
                // @ts-ignore
                allowpopups={allowpopups ? 'true' : undefined}
                webpreferences="sandbox"
                src={loading ? 'about:blank' : url}
                style={{ width: '100%', height: '100%' }}
                partition={
                  typeof partition === 'boolean'
                    ? partition
                      ? partitionId.current
                      : undefined
                    : partition
                }
                useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0"
              ></webview>
            </div>
          </div>
        )
      );
    },
  ),
);
WebView.displayName = 'WebView';

export default WebView;
