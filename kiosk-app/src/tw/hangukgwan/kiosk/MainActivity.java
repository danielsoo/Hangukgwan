package tw.hangukgwan.kiosk;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 한국관 POS - a single-screen shell around the existing admin web page.
 *
 * The whole reason this app exists is the printing path. Everything the staff
 * see is the same web page they already use; what changes is what happens when
 * that page asks for a kitchen ticket:
 *
 *   Chrome:    page -> "rawbt:" link -> [BLOCKED unless a human just tapped]
 *   this app:  page -> intercepted here -> TCP socket -> printer
 *
 * Chrome refuses to launch another app from a JavaScript timer (its own
 * anti-abuse rule, documented at developer.chrome.com/docs/android/intents),
 * and the new-order auto print runs from exactly such a timer - the 4-second
 * order poll. That is why the manual print button worked and auto print never
 * did. Here the ticket never leaves the app: shouldOverrideUrlLoading() below
 * catches the same "rawbt:base64,..." URL the page already emits, decodes it,
 * and writes the bytes to the printer's own TCP port. No gesture rule, no
 * RawBT app, no code-page translation in between.
 *
 * Deliberately built with framework APIs only (no AndroidX, no Gradle) so it
 * can be compiled with just aapt2 + javac + d8 and sideloaded onto the one
 * tablet that needs it.
 */
public class MainActivity extends Activity {

    private static final String TAG = "HangukgwanPOS";

    private static final String PREFS = "hangukgwan_kiosk";
    private static final String KEY_URL = "admin_url";
    private static final String KEY_PRINTER_IP = "printer_ip";
    private static final String KEY_PRINTER_PORT = "printer_port";
    private static final int DEFAULT_PORT = 9100;

    private static final int REQ_FILE_CHOOSER = 1001;

    private FrameLayout root;
    private WebView web;
    private View settingsOverlay;
    private ValueCallback<Uri[]> pendingFileCallback;
    private final Handler ui = new Handler(Looper.getMainLooper());

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // A kitchen tablet that sleeps stops polling for orders and stops
        // printing, so keep the screen alive for as long as this app is in
        // front. (Staff can still lock the tablet by hand.)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new TouchWatchingLayout(this);
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);
        applySystemBarInsets();

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        configureWebView();

        String url = adminUrl();
        if (url.length() == 0) {
            showSettings(true);
        } else {
            web.loadUrl(url);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Session cookie lives here - flush it so a restart doesn't log out.
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        if (settingsOverlay != null) {
            hideSettings();
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    /**
     * From Android 15 (API 35) on, an app that targets 35 or higher is drawn
     * behind the status and navigation bars whether it asks to be or not — and
     * this app has to target 36, since that is what Play now requires of new
     * apps. Left alone, the order board's own header would sit underneath the
     * status bar clock. So pad the root by whatever the system bars cover, plus
     * the keyboard when it is up, which keeps the address field on the settings
     * screen visible while it is being typed into.
     */
    private void applySystemBarInsets() {
        // Every screen in this app is light, so ask for dark system-bar icons.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(light, light);
            }
        }
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int left;
                int top;
                int right;
                int bottom;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                            | WindowInsets.Type.displayCutout()
                            | WindowInsets.Type.ime());
                    left = bars.left;
                    top = bars.top;
                    right = bars.right;
                    bottom = bars.bottom;
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                v.setPadding(left, top, right, bottom);
                return insets;
            }
        });
    }

    // ---------------------------------------------------------------- webview

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // The admin page keeps its 알림음 / 자동 인쇄 toggles in localStorage, so
        // DOM storage has to be on or those settings reset on every launch.
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // The new-order beep is played from a timer, not a tap; without this
        // WebView silently refuses to start the audio.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " HangukgwanKiosk/1.0");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        WebView.setWebContentsDebuggingEnabled(true);

        web.addJavascriptInterface(new PrintBridge(), "HangukgwanPrint");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl() == null ? null : request.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    showLoadError(error == null ? "" : String.valueOf(error.getDescription()));
                }
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showLoadError(description);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                          android.os.Message resultMsg) {
                // The page's last-resort browser-print path calls window.open().
                // Denying it makes window.open() return null, which the page
                // already handles by flagging the order as "인쇄 실패" instead of
                // navigating away from the order board. Real printing never
                // reaches this path anyway - it goes through the printer socket.
                return false;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                // Menu photo upload in the admin page is a plain <input type=file>;
                // without this it silently does nothing inside a WebView.
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    toast("파일 선택기를 열 수 없습니다");
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "web: " + m.message() + " @" + m.lineNumber());
                return true;
            }
        });
    }

    /**
     * Returns true when this app has taken responsibility for the URL and the
     * WebView should not try to load it.
     */
    private boolean handleUrl(String url) {
        if (url == null) {
            return false;
        }
        String lower = url.toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            return false; // ordinary page navigation
        }
        if (lower.startsWith("rawbt:")) {
            // This is the print job the admin page emits today. Same payload
            // format RawBT uses ("base64,...." or plain text) - we just print
            // it ourselves instead of handing it to another app.
            printPayload(url.substring("rawbt:".length()));
            return true;
        }
        // Anything else (tel:, mailto:, intent: ...) goes to whatever app
        // handles it. Unlike Chrome there is no gesture rule here, but these
        // only ever come from a real tap anyway.
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "no app for " + url, e);
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingFileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ---------------------------------------------------------------- printing

    /** Decodes a "base64,...." or plain-text payload and sends it to the printer. */
    private void printPayload(String payload) {
        byte[] bytes = decodePayload(payload);
        if (bytes == null || bytes.length == 0) {
            toast("인쇄할 내용이 비어 있습니다");
            return;
        }
        sendToPrinter(bytes, false);
    }

    private byte[] decodePayload(String payload) {
        if (payload == null) {
            return null;
        }
        try {
            // WebView may percent-encode parts of a custom-scheme URL; base64
            // itself never contains '%', so decoding first is always safe.
            String decoded = Uri.decode(payload);
            if (decoded.startsWith("base64,")) {
                return Base64.decode(decoded.substring("base64,".length()), Base64.DEFAULT);
            }
            return decoded.getBytes("UTF-8");
        } catch (Exception e) {
            Log.w(TAG, "bad print payload", e);
            return null;
        }
    }

    /**
     * @param announceSuccess true for a manual test print, where silence would
     *                        leave the user guessing. Real tickets stay quiet
     *                        on success - the paper is the confirmation - but
     *                        always report a failure, since a ticket that never
     *                        printed must not be missed in a busy kitchen.
     */
    private void sendToPrinter(byte[] bytes, final boolean announceSuccess) {
        final String ip = printerIp();
        final int port = printerPort();
        if (ip.length() == 0) {
            toast("설정에서 프린터 IP를 먼저 입력해주세요");
            return;
        }
        PrinterClient.printAsync(ip, port, bytes,
                new PrintResultToast(announceSuccess ? "인쇄 전송 완료" : null));
    }

    /**
     * Reports the outcome of a print job. A named class rather than the
     * anonymous one this started as: d8 crashes dexing an anonymous class
     * declared inside another anonymous class, which is what the settings
     * screen's test button would otherwise produce.
     *
     * @param successMessage null keeps quiet on success - for real tickets the
     *                       paper coming out is the confirmation, and a toast
     *                       per order would just cover the board. Failures are
     *                       always shown.
     */
    private class PrintResultToast implements PrinterClient.Callback {
        private final String successMessage;

        PrintResultToast(String successMessage) {
            this.successMessage = successMessage;
        }

        @Override
        public void onResult(boolean ok, String message) {
            if (!ok) {
                toast(message);
            } else if (successMessage != null) {
                toast(successMessage);
            }
        }
    }

    /**
     * Exposed to the page as window.HangukgwanPrint. The page can use this
     * directly instead of the "rawbt:" link - it is the same print path, but it
     * can report back whether the bytes were queued, and it skips the URL
     * round-trip entirely.
     *
     * Note: these methods run on WebView's JavaScript bridge thread, not the UI
     * thread, so everything they touch is either thread-safe or posted to the
     * UI thread.
     */
    private class PrintBridge {
        @JavascriptInterface
        public boolean available() {
            return printerIp().length() > 0;
        }

        @JavascriptInterface
        public String target() {
            return printerIp() + ":" + printerPort();
        }

        @JavascriptInterface
        public String printBase64(String base64) {
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception e) {
                return "error: base64";
            }
            if (bytes.length == 0) {
                return "error: empty";
            }
            if (printerIp().length() == 0) {
                return "error: no printer configured";
            }
            sendToPrinter(bytes, false);
            return "queued";
        }
    }

    // ---------------------------------------------------------------- settings

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String adminUrl() {
        return prefs().getString(KEY_URL, "").trim();
    }

    private String printerIp() {
        return prefs().getString(KEY_PRINTER_IP, "").trim();
    }

    private int printerPort() {
        return prefs().getInt(KEY_PRINTER_PORT, DEFAULT_PORT);
    }

    private void showLoadError(String description) {
        toast("페이지를 불러오지 못했습니다: " + description);
    }

    private void hideSettings() {
        if (settingsOverlay != null) {
            root.removeView(settingsOverlay);
            settingsOverlay = null;
        }
    }

    /** @param firstRun when true there is nothing to go back to, so no cancel button. */
    private void showSettings(final boolean firstRun) {
        if (settingsOverlay != null) {
            return;
        }
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.setClickable(true); // swallow taps so they don't reach the page

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        box.setPadding(pad, pad, pad, pad);
        scroll.addView(box);

        box.addView(heading("한국관 POS 설정"));
        box.addView(note("관리자 페이지 주소와 주방 프린터 정보를 입력해주세요. "
                + "설정을 다시 열려면 화면을 손가락 세 개로 길게 누르세요."));

        box.addView(label("관리자 페이지 주소"));
        final EditText urlInput = input(adminUrl().length() > 0 ? adminUrl() : "https://",
                InputType.TYPE_TEXT_VARIATION_URI);
        box.addView(urlInput);

        box.addView(label("프린터 IP 주소"));
        final EditText ipInput = input(printerIp(), InputType.TYPE_CLASS_TEXT);
        ipInput.setHint("예: 192.168.1.50");
        box.addView(ipInput);

        box.addView(label("프린터 포트"));
        final EditText portInput = input(String.valueOf(printerPort()), InputType.TYPE_CLASS_NUMBER);
        box.addView(portInput);

        Button testBtn = button("프린터 테스트 인쇄");
        testBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String ip = ipInput.getText().toString().trim();
                int port = parsePort(portInput.getText().toString());
                if (ip.length() == 0) {
                    toast("프린터 IP를 입력해주세요");
                    return;
                }
                // Test against what is typed right now, not what was saved -
                // the whole point is to try a value before committing to it.
                PrinterClient.printAsync(ip, port, PrinterClient.testTicket(),
                        new PrintResultToast("테스트 인쇄를 보냈습니다"));
            }
        });
        box.addView(testBtn);

        Button saveBtn = button("저장하고 시작");
        saveBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String url = urlInput.getText().toString().trim();
                if (url.length() == 0 || !(url.startsWith("http://") || url.startsWith("https://"))) {
                    toast("주소는 https:// 로 시작해야 합니다");
                    return;
                }
                prefs().edit()
                        .putString(KEY_URL, url)
                        .putString(KEY_PRINTER_IP, ipInput.getText().toString().trim())
                        .putInt(KEY_PRINTER_PORT, parsePort(portInput.getText().toString()))
                        .apply();
                hideSettings();
                web.loadUrl(url);
                toast("저장되었습니다");
            }
        });
        box.addView(saveBtn);

        if (!firstRun) {
            Button cancelBtn = button("취소");
            cancelBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    hideSettings();
                }
            });
            box.addView(cancelBtn);
        }

        settingsOverlay = scroll;
        root.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private int parsePort(String raw) {
        try {
            int p = Integer.parseInt(raw.trim());
            if (p > 0 && p < 65536) {
                return p;
            }
        } catch (Exception ignored) {
        }
        return DEFAULT_PORT;
    }

    // ---------------------------------------------------------------- small ui helpers

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value,
                getResources().getDisplayMetrics());
    }

    private TextView heading(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(24);
        t.setTextColor(Color.parseColor("#111111"));
        t.setPadding(0, 0, 0, dp(8));
        return t;
    }

    private TextView note(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(14);
        t.setTextColor(Color.parseColor("#666666"));
        t.setPadding(0, 0, 0, dp(16));
        return t;
    }

    private TextView label(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(15);
        t.setTextColor(Color.parseColor("#333333"));
        t.setPadding(0, dp(12), 0, dp(4));
        return t;
    }

    private EditText input(String value, int inputType) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setSingleLine(true);
        e.setInputType(InputType.TYPE_CLASS_TEXT | inputType);
        e.setTextSize(17);
        return e;
    }

    private Button button(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(16);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        b.setLayoutParams(lp);
        return b;
    }

    private void toast(final String message) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            }
        });
    }

    /**
     * Watches for a three-finger long press to reopen the settings screen.
     * It only observes - every touch still reaches the page underneath - so
     * there is no invisible dead zone on the order board, and no realistic way
     * for staff to open this by accident mid-service.
     */
    private class TouchWatchingLayout extends FrameLayout {
        private static final long HOLD_MS = 900;
        private long threeFingerStart = 0;

        TouchWatchingLayout(Context context) {
            super(context);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent ev) {
            if (settingsOverlay == null) {
                int fingers = ev.getPointerCount();
                int action = ev.getActionMasked();
                if (fingers >= 3 && action != MotionEvent.ACTION_UP
                        && action != MotionEvent.ACTION_CANCEL) {
                    if (threeFingerStart == 0) {
                        threeFingerStart = System.currentTimeMillis();
                    } else if (System.currentTimeMillis() - threeFingerStart > HOLD_MS) {
                        threeFingerStart = 0;
                        showSettings(false);
                    }
                } else if (fingers < 3) {
                    threeFingerStart = 0;
                }
            }
            return super.dispatchTouchEvent(ev);
        }
    }
}
